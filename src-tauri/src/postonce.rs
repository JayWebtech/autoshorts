//! Optional publishing of rendered clips through PostOnce (https://postonce.to).
//!
//! Flow from the public API docs (https://postonce.to/api/openapi.json):
//! 1. POST /v1/media/uploads -> signed upload URL
//! 2. PUT the clip bytes to that URL (no API key on this request)
//! 3. GET /v1/media/{id} -> public URL
//! 4. POST /v1/posts with an Idempotency-Key, so a retry never posts twice

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const DEFAULT_BASE_URL: &str = "https://postonce.to/api/public";

/// API calls are small; the clip upload itself has no time limit (slow connections).
const API_TIMEOUT: Duration = Duration::from_secs(60);

/// Where "Get a free API key" leads.
pub const SIGNUP_URL: &str =
    "https://postonce.to/?ref=AUTOSHORTS&utm_source=autoshorts&utm_medium=app&utm_campaign=autoshorts";

/// Opens the fixed PostOnce sign-up page in the default browser.
pub fn open_signup_page() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(SIGNUP_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open your browser: {e}. Visit {SIGNUP_URL}"))
}

fn base_url() -> String {
    std::env::var("POSTONCE_API_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostOnceAccount {
    pub id: String,
    pub platform: String,
    pub username: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostOnceResult {
    pub post_id: String,
    pub status: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("AutoShorts/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Turns a PostOnce error body (`{ "error": { "message", "hint" } }`) into one readable line.
async fn read_json(response: reqwest::Response, action: &str) -> Result<Value, String> {
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    let message = body["error"]["message"].as_str().unwrap_or("Request failed");
    let hint = body["error"]["hint"].as_str().unwrap_or("");
    let mut text = format!("PostOnce could not {action}: {}", message.trim_end_matches('.'));
    text.push('.');
    if status == reqwest::StatusCode::UNAUTHORIZED {
        text.push_str(" Check your PostOnce API key in API Settings.");
    } else if !hint.is_empty() {
        text.push(' ');
        text.push_str(hint);
    }
    Err(text)
}

/// The key from API Settings, or POSTONCE_API_KEY from the environment.
fn require_key(api_key: &str) -> Result<String, String> {
    let key = match api_key.trim() {
        "" => std::env::var("POSTONCE_API_KEY").unwrap_or_default(),
        key => key.to_string(),
    };
    if key.trim().is_empty() {
        return Err("Add your PostOnce API key in API Settings first.".to_string());
    }
    Ok(key.trim().to_string())
}

/// Connected accounts that can publish video.
pub async fn list_accounts(api_key: &str) -> Result<Vec<PostOnceAccount>, String> {
    let key = require_key(api_key)?;
    let response = client()?
        .get(format!("{}/v1/accounts", base_url()))
        .timeout(API_TIMEOUT)
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    let body = read_json(response, "load your accounts").await?;
    let accounts = body["data"].as_array().cloned().unwrap_or_default();
    Ok(accounts
        .iter()
        .filter(|account| account["status"].as_str() == Some("active"))
        .filter(|account| account["capabilities"]["destination"].as_bool() != Some(false))
        .filter(|account| account["capabilities"]["video"].as_bool() != Some(false))
        .filter_map(|account| {
            Some(PostOnceAccount {
                id: account["id"].as_str()?.to_string(),
                platform: account["platform"].as_str().unwrap_or("").to_string(),
                username: account["username"].as_str().unwrap_or("").to_string(),
                avatar_url: account["avatar_url"].as_str().map(str::to_string),
            })
        })
        .collect())
}

/// Identifies one rendered version of a clip (a re-cut changes it).
fn clip_fingerprint(clip_path: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    clip_path.hash(&mut hasher);
    if let Ok(modified) = std::fs::metadata(clip_path).and_then(|meta| meta.modified()) {
        modified.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

/// Clips already uploaded this session, so a retry sends the same media URL (and the
/// same request body) instead of uploading the file again.
fn uploaded_clips() -> &'static Mutex<HashMap<String, String>> {
    static UPLOADED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    UPLOADED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Same clip file + same post settings = same key, so retries and double clicks never duplicate.
fn idempotency_key(
    fingerprint: &str,
    caption: &str,
    account_ids: &[String],
    publish_at: Option<&str>,
) -> String {
    let mut hasher = DefaultHasher::new();
    fingerprint.hash(&mut hasher);
    caption.hash(&mut hasher);
    let mut ids = account_ids.to_vec();
    ids.sort();
    ids.hash(&mut hasher);
    publish_at.hash(&mut hasher);
    format!("autoshorts-{:016x}", hasher.finish())
}

/// Uploads the clip and returns its public URL.
async fn upload_clip(
    http: &reqwest::Client,
    base: &str,
    key: &str,
    clip_path: &Path,
) -> Result<String, String> {
    let bytes = tokio::fs::read(clip_path)
        .await
        .map_err(|e| format!("Could not read the clip file: {e}"))?;
    let filename = clip_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("clip.mp4");

    let response = http
        .post(format!("{base}/v1/media/uploads"))
        .timeout(API_TIMEOUT)
        .bearer_auth(key)
        .json(&json!({ "filename": filename, "content_type": "video/mp4" }))
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    let upload = read_json(response, "start the upload").await?;
    let media_id = upload["data"]["media_id"]
        .as_str()
        .ok_or("PostOnce did not return a media id.")?
        .to_string();
    let signed_url = upload["data"]["upload"]["signedUrl"]
        .as_str()
        .ok_or("PostOnce did not return an upload URL.")?
        .to_string();

    let put = http
        .put(&signed_url)
        .header(reqwest::header::CONTENT_TYPE, "video/mp4")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Clip upload failed: {e}"))?;
    if !put.status().is_success() {
        return Err(format!("Clip upload failed (HTTP {}).", put.status().as_u16()));
    }

    let response = http
        .get(format!("{base}/v1/media/{media_id}"))
        .timeout(API_TIMEOUT)
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    let media = read_json(response, "find the uploaded clip").await?;
    media["data"]["public_url"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "PostOnce did not return the clip URL.".to_string())
}

pub async fn post_clip(
    api_key: &str,
    clip_path: &Path,
    caption: &str,
    account_ids: &[String],
    publish_at: Option<&str>,
) -> Result<PostOnceResult, String> {
    let key = require_key(api_key)?;
    if account_ids.is_empty() {
        return Err("Pick at least one account to post to.".to_string());
    }
    let http = client()?;
    let base = base_url();
    let fingerprint = clip_fingerprint(clip_path);
    let cached = uploaded_clips()
        .lock()
        .ok()
        .and_then(|uploaded| uploaded.get(&fingerprint).cloned());
    let public_url = match cached {
        Some(url) => url,
        None => {
            let url = upload_clip(&http, &base, &key, clip_path).await?;
            if let Ok(mut uploaded) = uploaded_clips().lock() {
                uploaded.insert(fingerprint.clone(), url.clone());
            }
            url
        }
    };

    let targets: Vec<Value> = account_ids
        .iter()
        .map(|id| json!({ "account_id": id }))
        .collect();
    let mut body = json!({
        "content": caption,
        "media": [{ "url": public_url, "type": "video" }],
        "targets": targets,
    });
    if let Some(when) = publish_at {
        body["publish_at"] = json!(when);
    }
    let response = http
        .post(format!("{base}/v1/posts"))
        .timeout(API_TIMEOUT)
        .bearer_auth(&key)
        .header(
            "Idempotency-Key",
            idempotency_key(&fingerprint, caption, account_ids, publish_at),
        )
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    if response.status() == reqwest::StatusCode::CONFLICT {
        // The key covers this clip version, caption, accounts and time, so a reused key
        // means this exact post was already sent (for example before an app restart).
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if body["error"]["code"].as_str() == Some("idempotency_key_reused") {
            return Ok(PostOnceResult {
                post_id: String::new(),
                status: "already_sent".to_string(),
            });
        }
        let message = body["error"]["message"].as_str().unwrap_or("Request failed");
        return Err(format!("PostOnce could not create the post: {message}"));
    }
    let post = read_json(response, "create the post").await?;
    Ok(PostOnceResult {
        post_id: post["data"]["id"].as_str().unwrap_or("").to_string(),
        status: post["data"]["status"].as_str().unwrap_or("queued").to_string(),
    })
}
