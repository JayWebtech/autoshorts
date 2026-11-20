//! "Sign in with PostOnce": OAuth 2.1 with PKCE and a loopback redirect (RFC 8252),
//! so users never copy an API key. PostOnce's public API accepts the resulting
//! access token in place of an API key.
//!
//! Flow: discover endpoints -> register AutoShorts once (dynamic client registration)
//! -> open the browser at the authorize URL -> catch the redirect on 127.0.0.1 ->
//! exchange the code -> store tokens in the app data folder, refreshing them as needed.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const SCOPES: &str = "accounts:read accounts:write media:read media:write posts:write";
/// Referral code sent with sign-in so a new PostOnce account is credited to AutoShorts.
const REFERRAL_CODE: &str = "AUTOSHORTS";
/// New users sign up, verify their email and answer onboarding questions first, so allow plenty of time.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(30 * 60);

static AUTH_FILE: OnceLock<PathBuf> = OnceLock::new();

fn refresh_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Called once at startup with the app data folder.
pub fn init(data_dir: PathBuf) {
    let _ = AUTH_FILE.set(data_dir.join("postonce-auth.json"));
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct StoredAuth {
    /// The PostOnce site these tokens belong to (changes when testing against another server).
    origin: String,
    client_id: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    /// Seconds since the Unix epoch.
    expires_at: Option<u64>,
}

fn load() -> StoredAuth {
    AUTH_FILE
        .get()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(auth: &StoredAuth) -> Result<(), String> {
    let path = AUTH_FILE.get().ok_or("PostOnce sign-in is not ready yet.")?;
    let text = serde_json::to_string_pretty(auth).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("Could not save your PostOnce sign-in: {e}"))
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// https://postonce.to, or the origin of POSTONCE_API_URL when testing.
fn origin() -> String {
    let base = super::postonce::base_url();
    reqwest::Url::parse(&base)
        .ok()
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_else(|| "https://postonce.to".to_string())
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("AutoShorts/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

struct Endpoints {
    authorize: String,
    token: String,
    registration: String,
    revocation: Option<String>,
}

async fn discover(origin: &str) -> Result<Endpoints, String> {
    let meta: Value = http()?
        .get(format!("{origin}/.well-known/oauth-authorization-server"))
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?
        .json()
        .await
        .map_err(|_| "PostOnce sign-in is unavailable right now.".to_string())?;
    let field = |name: &str| meta[name].as_str().map(str::to_string);
    Ok(Endpoints {
        authorize: field("authorization_endpoint").ok_or("PostOnce sign-in is unavailable right now.")?,
        token: field("token_endpoint").ok_or("PostOnce sign-in is unavailable right now.")?,
        registration: field("registration_endpoint").ok_or("PostOnce sign-in is unavailable right now.")?,
        revocation: field("revocation_endpoint"),
    })
}

async fn register(endpoints: &Endpoints) -> Result<String, String> {
    let response = http()?
        .post(&endpoints.registration)
        .json(&json!({
            "client_name": "AutoShorts",
            "application_type": "native",
            // Loopback redirects may use any port (RFC 8252), so one registration lasts.
            "redirect_uris": ["http://127.0.0.1/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
            "scope": SCOPES,
        }))
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    let body: Value = response.json().await.unwrap_or(Value::Null);
    body["client_id"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "PostOnce did not accept AutoShorts as an app. Try again later.".to_string())
}

fn random_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

fn code_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn store_tokens(auth: &mut StoredAuth, body: &Value) -> Result<(), String> {
    let access = body["access_token"]
        .as_str()
        .ok_or("PostOnce did not return a sign-in token.")?;
    auth.access_token = Some(access.to_string());
    if let Some(refresh) = body["refresh_token"].as_str() {
        auth.refresh_token = Some(refresh.to_string());
    }
    auth.expires_at = Some(now() + body["expires_in"].as_u64().unwrap_or(3600));
    save(auth)
}

/// Waits for the browser to come back to http://127.0.0.1:<port>/callback and returns the code.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    let deadline = std::time::Instant::now() + SIGN_IN_TIMEOUT;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    loop {
        if std::time::Instant::now() > deadline {
            return Err("Sign-in timed out. Click Sign in with PostOnce to try again.".to_string());
        }
        let (mut stream, _) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buffer = [0u8; 8192];
        let read = stream.read(&mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]);
        let path = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("");
        if !path.starts_with("/callback") {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
        let param = |name: &str| {
            url.query_pairs()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.to_string())
        };
        let result = if param("state").as_deref() != Some(expected_state) {
            Err("Sign-in could not be verified. Try again.".to_string())
        } else if let Some(code) = param("code") {
            Ok(code)
        } else if param("error").as_deref() == Some("access_denied") {
            Err("Sign-in was cancelled.".to_string())
        } else {
            Err("Sign-in did not finish. Try again.".to_string())
        };
        let message = match &result {
            Ok(_) => "You're signed in. You can go back to AutoShorts.",
            Err(_) => "Sign-in did not finish. Go back to AutoShorts and try again.",
        };
        let page = format!(
            "<!doctype html><meta charset=utf-8><title>AutoShorts</title><body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh\"><h2>{message}</h2></body>"
        );
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                page.len()
            )
            .as_bytes(),
        );
        return result;
    }
}

/// Opens the browser to sign in (or sign up) and waits until the user comes back.
pub async fn sign_in() -> Result<(), String> {
    let origin = origin();
    let endpoints = discover(&origin).await?;
    let mut auth = load();
    if auth.origin != origin {
        auth = StoredAuth { origin: origin.clone(), ..Default::default() };
    }
    let client_id = match auth.client_id.clone() {
        Some(id) => id,
        None => {
            let id = register(&endpoints).await?;
            auth.client_id = Some(id.clone());
            save(&auth)?;
            id
        }
    };

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Could not start sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let state = random_token();
    let verifier = random_token();
    let resource = format!("{origin}/mcp");

    let mut authorize = reqwest::Url::parse(&endpoints.authorize).map_err(|e| e.to_string())?;
    authorize
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("resource", &resource)
        .append_pair("ref", REFERRAL_CODE);
    super::postonce::open_in_browser(authorize.as_str())?;

    let expected_state = state.clone();
    let code = tokio::task::spawn_blocking(move || wait_for_code(listener, &expected_state))
        .await
        .map_err(|e| e.to_string())??;

    let response = http()?
        .post(&endpoints.token)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client_id.as_str()),
            ("code_verifier", verifier.as_str()),
            ("resource", resource.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not reach PostOnce: {e}"))?;
    let body: Value = response.json().await.unwrap_or(Value::Null);
    store_tokens(&mut auth, &body)
}

/// A valid access token if the user signed in with PostOnce, refreshing it when needed.
pub async fn access_token() -> Option<String> {
    let _guard = refresh_lock().lock().await;
    let mut auth = load();
    if auth.origin != origin() {
        return None;
    }
    let token = auth.access_token.clone()?;
    if auth.expires_at.unwrap_or(0) > now() + 60 {
        return Some(token);
    }
    let refresh = auth.refresh_token.clone()?;
    let client_id = auth.client_id.clone()?;
    let endpoints = discover(&auth.origin).await.ok()?;
    let resource = format!("{}/mcp", auth.origin);
    let response = http()
        .ok()?
        .post(&endpoints.token)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id.as_str()),
            ("resource", resource.as_str()),
        ])
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        // The sign-in expired or was revoked in PostOnce: forget it so the app asks again.
        auth.access_token = None;
        auth.refresh_token = None;
        auth.expires_at = None;
        let _ = save(&auth);
        return None;
    }
    let body: Value = response.json().await.ok()?;
    store_tokens(&mut auth, &body).ok()?;
    auth.access_token
}

pub fn is_signed_in() -> bool {
    let auth = load();
    auth.origin == origin() && auth.refresh_token.is_some()
}

/// Forgets the sign-in and asks PostOnce to revoke it.
pub async fn sign_out() -> Result<(), String> {
    let mut auth = load();
    if let (Some(refresh), Some(client_id)) = (auth.refresh_token.clone(), auth.client_id.clone()) {
        if let Ok(endpoints) = discover(&auth.origin).await {
            if let (Some(revocation), Ok(client)) = (endpoints.revocation, http()) {
                let _ = client
                    .post(revocation)
                    .form(&[("token", refresh.as_str()), ("client_id", client_id.as_str())])
                    .send()
                    .await;
            }
        }
    }
    auth.access_token = None;
    auth.refresh_token = None;
    auth.expires_at = None;
    save(&auth)
}

#[cfg(test)]
mod tests {
    use super::code_challenge;

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        assert_eq!(
            code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
