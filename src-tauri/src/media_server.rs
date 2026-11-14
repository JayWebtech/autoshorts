//! Tiny loopback HTTP server that hands media files to the webview.
//!
//! `<video src="asset://...">` does not work on Linux: WebKitGTK's media
//! pipeline fetches through GStreamer, which only understands `http(s)://`,
//! `file://` and the other standard schemes. Tauri's custom `asset://` scheme is
//! therefore never opened by the media player and playback silently stays on a
//! black frame — no `error` event, no console message.
//!
//! Serving the same bytes over `http://127.0.0.1:<port>` gives the webview a
//! normal video source, with byte-range requests and seeking working exactly
//! like on any website.
//!
//! Only files explicitly registered through [`MediaServer::url_for`] are
//! served, and the socket is bound to the loopback interface on a random port,
//! so nothing outside the app can read arbitrary paths.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type FileRegistry = Arc<Mutex<HashMap<String, PathBuf>>>;

/// Loopback file server shared by every command that needs a playable URL.
#[derive(Clone)]
pub struct MediaServer {
    port: u16,
    files: FileRegistry,
}

impl MediaServer {
    /// Bind on an ephemeral loopback port and start accepting connections.
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let port = listener.local_addr()?.port();
        let files: FileRegistry = Arc::new(Mutex::new(HashMap::new()));
        let shared = Arc::clone(&files);

        std::thread::Builder::new()
            .name("media-server".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let files = Arc::clone(&shared);
                    // One short-lived thread per request: the webview only
                    // opens a handful of connections per video.
                    let _ = std::thread::Builder::new()
                        .name("media-server-conn".into())
                        .spawn(move || {
                            let _ = serve(stream, files);
                        });
                }
            })?;

        Ok(Self { port, files })
    }

    /// Port the server listens on.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Register `path` and return the URL the webview can play it from.
    ///
    /// The URL is stable for a given path, so re-registering is cheap and the
    /// browser cache keeps working.
    pub fn url_for(&self, path: &Path) -> String {
        let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        let key = file_key(&resolved);
        if let Ok(mut files) = self.files.lock() {
            files.insert(key.clone(), resolved.clone());
        }
        let name = resolved
            .file_name()
            .map(|name| name.to_string_lossy().replace(' ', "_"))
            .unwrap_or_else(|| "media".to_string());
        format!("http://127.0.0.1:{}/media/{}/{}", self.port, key, name)
    }
}

/// Stable, filesystem-safe id for a path (FNV-1a 64 bit).
fn file_key(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn serve(stream: TcpStream, files: FileRegistry) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    stream.set_write_timeout(Some(Duration::from_secs(30)))?;
    let mut writer = stream.try_clone()?;
    let mut reader = BufReader::new(stream);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line)? == 0 {
        return Ok(());
    }

    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        let lowered = trimmed.to_ascii_lowercase();
        if let Some(value) = lowered.strip_prefix("range:") {
            range_header = Some(value.trim().to_string());
        }
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    if method == "OPTIONS" {
        return write_simple(&mut writer, "204 No Content", &cors_headers());
    }
    if method != "GET" && method != "HEAD" {
        return write_simple(&mut writer, "405 Method Not Allowed", &cors_headers());
    }

    let Some(key) = target
        .trim_start_matches('/')
        .split('/')
        .nth(1)
        .map(str::to_string)
        .filter(|key| !key.is_empty())
    else {
        return write_simple(&mut writer, "404 Not Found", &cors_headers());
    };

    let path = files
        .lock()
        .ok()
        .and_then(|files| files.get(&key).cloned());
    let Some(path) = path else {
        return write_simple(&mut writer, "404 Not Found", &cors_headers());
    };

    let mut file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(_) => return write_simple(&mut writer, "404 Not Found", &cors_headers()),
    };
    let total = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if total == 0 {
        return write_simple(&mut writer, "404 Not Found", &cors_headers());
    }

    let mime = mime_for(&path);
    let mut headers = cors_headers();
    headers.push(("Accept-Ranges".into(), "bytes".into()));
    headers.push(("Content-Type".into(), mime.into()));
    headers.push(("Cache-Control".into(), "no-store".into()));

    let requested = range_header.as_deref().and_then(|value| parse_range(value, total));
    let (status, start, length) = match requested {
        Some((start, end)) => ("206 Partial Content", start, end - start + 1),
        None => ("200 OK", 0, total),
    };

    if status.starts_with("206") {
        headers.push((
            "Content-Range".into(),
            format!("bytes {start}-{}/{total}", start + length - 1),
        ));
    }
    headers.push(("Content-Length".into(), length.to_string()));
    headers.push(("Connection".into(), "close".into()));

    let mut head = format!("HTTP/1.1 {status}\r\n");
    for (name, value) in &headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    writer.write_all(head.as_bytes())?;

    if method == "HEAD" {
        return writer.flush();
    }

    if start > 0 {
        file.seek(SeekFrom::Start(start))?;
    }
    let mut body = file.take(length);
    std::io::copy(&mut body, &mut writer)?;
    writer.flush()
}

fn cors_headers() -> Vec<(String, String)> {
    vec![
        ("Access-Control-Allow-Origin".into(), "*".into()),
        (
            "Access-Control-Allow-Headers".into(),
            "Range, Content-Type".into(),
        ),
        (
            "Access-Control-Expose-Headers".into(),
            "Content-Length, Content-Range, Accept-Ranges".into(),
        ),
    ]
}

fn write_simple(
    writer: &mut TcpStream,
    status: &str,
    headers: &[(String, String)],
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status}\r\n");
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("Content-Length: 0\r\nConnection: close\r\n\r\n");
    writer.write_all(head.as_bytes())?;
    writer.flush()
}

/// Parse a single `bytes=start-end` range, clamped to the file length.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.trim();
    let spec = spec.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (raw_start, raw_end) = spec.split_once('-')?;

    let last = total.saturating_sub(1);
    if raw_start.is_empty() {
        // Suffix range: the final N bytes.
        let wanted: u64 = raw_end.parse().ok()?;
        if wanted == 0 {
            return None;
        }
        let start = total.saturating_sub(wanted.min(total));
        return Some((start, last));
    }

    let start: u64 = raw_start.parse().ok()?;
    if start > last {
        return None;
    }
    let end = if raw_end.is_empty() {
        last
    } else {
        raw_end.parse::<u64>().ok()?.min(last)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

fn mime_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "m4a" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_range_handles_open_ended_and_suffix_requests() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // Ranges are clamped to the file length.
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        // Unsatisfiable ranges fall back to a full response.
        assert_eq!(parse_range("bytes=5000-", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn mime_for_covers_the_formats_the_app_produces() {
        assert_eq!(mime_for(Path::new("/tmp/a.webm")), "video/webm");
        assert_eq!(mime_for(Path::new("/tmp/a.MP4")), "video/mp4");
        assert_eq!(mime_for(Path::new("/tmp/a.mkv")), "video/x-matroska");
        assert_eq!(mime_for(Path::new("/tmp/a.bin")), "application/octet-stream");
    }

    #[test]
    fn file_key_is_stable_and_distinct() {
        let a = file_key(Path::new("/tmp/one.webm"));
        assert_eq!(a, file_key(Path::new("/tmp/one.webm")));
        assert_ne!(a, file_key(Path::new("/tmp/two.webm")));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn serves_registered_files_with_range_support() {
        let dir = std::env::temp_dir().join("autoshorts-media-server-test");
        std::fs::create_dir_all(&dir).expect("create dir");
        let file = dir.join("sample.webm");
        std::fs::write(&file, b"0123456789").expect("write file");

        let server = MediaServer::start().expect("start server");
        let url = server.url_for(&file);
        assert!(url.starts_with("http://127.0.0.1:"), "{url}");

        let prefix = format!("http://127.0.0.1:{}", server.port());
        let target = url.strip_prefix(&prefix).expect("url prefix").to_string();

        let response = raw_request(server.port(), &target, Some("bytes=2-5"));
        assert!(response.starts_with("HTTP/1.1 206"), "{response}");
        assert!(response.contains("Content-Range: bytes 2-5/10"), "{response}");
        assert!(response.ends_with("2345"), "{response}");

        let full = raw_request(server.port(), &target, None);
        assert!(full.starts_with("HTTP/1.1 200"), "{full}");
        assert!(full.ends_with("0123456789"), "{full}");

        let missing = raw_request(server.port(), "/media/deadbeef/x.webm", None);
        assert!(missing.starts_with("HTTP/1.1 404"), "{missing}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    fn raw_request(port: u16, target: &str, range: Option<&str>) -> String {
        use std::io::Write as _;
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let mut request = format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n");
        if let Some(range) = range {
            request.push_str(&format!("Range: {range}\r\n"));
        }
        request.push_str("\r\n");
        stream.write_all(request.as_bytes()).expect("write");
        let mut response = String::new();
        let _ = stream.read_to_string(&mut response);
        response
    }
}
