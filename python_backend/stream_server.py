import os
import mimetypes
import re
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading

CHUNK_SIZE = 256 * 1024  # 256 KB buffer for high-throughput local media streaming


class VideoStreamHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/stream":
            query = parse_qs(parsed.query)
            file_path = query.get("file", [None])[0]
            if not file_path or not os.path.isfile(file_path):
                self.send_error(404, "File not found")
                return

            file_size = os.path.getsize(file_path)
            content_type, _ = mimetypes.guess_type(file_path)
            content_type = content_type or "video/mp4"

            range_header = self.headers.get("Range", None)
            if range_header:
                match = re.search(r"bytes=(\d+)-(\d*)", range_header)
                if match:
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else file_size - 1
                    end = min(end, file_size - 1)
                    length = end - start + 1

                    self.send_response(206)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                    self.send_header("Content-Length", str(length))
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Connection", "keep-alive")
                    self.end_headers()

                    with open(file_path, "rb") as f:
                        f.seek(start)
                        bytes_to_send = length
                        while bytes_to_send > 0:
                            chunk_size = min(CHUNK_SIZE, bytes_to_send)
                            data = f.read(chunk_size)
                            if not data:
                                break
                            try:
                                self.wfile.write(data)
                            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                                break
                            bytes_to_send -= len(data)
                    return

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            with open(file_path, "rb") as f:
                while True:
                    data = f.read(CHUNK_SIZE)
                    if not data:
                        break
                    try:
                        self.wfile.write(data)
                    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                        break
            return

        # Serve static assets from dist/
        base_dir = Path(__file__).resolve().parent.parent
        dist_dir = base_dir / "dist"
        rel_path = parsed.path.lstrip("/")
        if not rel_path or rel_path == "":
            rel_path = "index.html"

        target_file = (dist_dir / rel_path).resolve()
        if not str(target_file).startswith(str(dist_dir.resolve())) or not target_file.is_file():
            target_file = dist_dir / "index.html"

        if target_file.is_file():
            content_type, _ = mimetypes.guess_type(str(target_file))
            if str(target_file).endswith(".js"):
                content_type = "application/javascript"
            elif str(target_file).endswith(".css"):
                content_type = "text/css"
            elif str(target_file).endswith(".html"):
                content_type = "text/html; charset=utf-8"

            self.send_response(200)
            self.send_header("Content-Type", content_type or "application/octet-stream")
            self.send_header("Content-Length", str(target_file.stat().st_size))
            if str(target_file).endswith("index.html"):
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            with open(target_file, "rb") as f:
                self.wfile.write(f.read())
            return

        self.send_error(404, "Not found")

    def log_message(self, format, *args):
        # Quiet logger
        pass


class SilentThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Suppress harmless client disconnects during HTML5 video streaming/seeking
        pass


def start_stream_server(port: int = 1422):
    try:
        server = SilentThreadingHTTPServer(("127.0.0.1", port), VideoStreamHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        print(f"Local media preview server (multithreaded 256KB buffer) running on port {port}...")
        return server
    except Exception as e:
        print(f"Preview server already running or port in use: {e}")
        return None
