use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

use crate::models::{CandidateDraft, NormalizedTranscript, TranscriptSegment};

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";

fn candidate_prompt(segments: &str) -> String {
    format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    )
}

/// Accepts `http://host:port`, `http://host:port/v1`, or a full `.../chat/completions` URL.
pub fn normalize_chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return format!("{DEFAULT_OPENAI_BASE_URL}/chat/completions");
    }
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

/// Every URL shape worth trying for a user supplied base URL, best guess first.
///
/// A bare `http://localhost:1234` normalises to `/chat/completions`, but LM
/// Studio, vLLM, llama.cpp and Ollama all mount the route under `/v1`, so the
/// `/v1` form has to be tried first (or the request 404s).
pub fn chat_completion_urls(base_url: &str) -> Vec<String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let has_path = trimmed
        .split_once("://")
        .map(|(_, rest)| rest.contains('/'))
        .unwrap_or(false);
    if !trimmed.is_empty() && !has_path {
        return vec![
            format!("{trimmed}/v1/chat/completions"),
            format!("{trimmed}/chat/completions"),
        ];
    }
    vec![normalize_chat_completions_url(base_url)]
}

#[derive(Debug, Deserialize)]
struct AnthropicMessage {
    content: Vec<AnthropicContent>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeepseekMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct DeepseekChoice {
    message: DeepseekMessage,
}

#[derive(Debug, Deserialize)]
struct DeepseekResponse {
    choices: Vec<DeepseekChoice>,
}

pub async fn detect_candidates_with_deepseek(
    transcript: &NormalizedTranscript,
    api_key: &str,
    model_name: Option<&str>,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let default_model = "deepseek-chat".to_string();
    let model = model_name
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.trim().to_string())
        .or_else(|| std::env::var("DEEPSEEK_MODEL").ok().filter(|m| !m.trim().is_empty()))
        .unwrap_or(default_model);

    let response = reqwest::Client::new()
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "temperature": 0.2,
            "response_format": {
                "type": "json_object"
            }
        }))
        .send()
        .await
        .context("calling DeepSeek")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("DeepSeek request failed ({status}): {body}"));
    }

    let res_body: DeepseekResponse = response.json().await.context("parsing DeepSeek response")?;
    let text = res_body
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| anyhow!("DeepSeek response did not include choices content"))?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

pub async fn detect_candidates_with_gemini(
    transcript: &NormalizedTranscript,
    api_key: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-2.5-flash".to_string());
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let response = reqwest::Client::new()
        .post(&url)
        .json(&json!({
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2
            }
        }))
        .send()
        .await
        .context("calling Gemini")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Gemini request failed ({status}): {body}"));
    }

    let res_body: GeminiResponse = response.json().await.context("parsing Gemini response")?;
    let text = res_body
        .candidates
        .first()
        .and_then(|c| c.content.parts.first())
        .and_then(|p| p.text.clone())
        .ok_or_else(|| anyhow!("Gemini response did not include content text"))?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionChoice {
    #[serde(default)]
    message: Option<ChatCompletionMessage>,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionMessage {
    #[serde(default)]
    content: Option<serde_json::Value>,
    #[serde(default)]
    reasoning_content: Option<String>,
}

fn extract_completion_text(res_body: &ChatCompletionResponse) -> Option<String> {
    let choice = res_body.choices.first()?;
    if let Some(msg) = &choice.message {
        if let Some(val) = &msg.content {
            let extracted = match val {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Array(parts) => parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(""),
                serde_json::Value::Null => String::new(),
                other => other.to_string(),
            };
            if !extracted.trim().is_empty() {
                return Some(extracted);
            }
        }
        if let Some(reasoning) = msg.reasoning_content.as_ref().filter(|r| !r.trim().is_empty()) {
            return Some(reasoning.clone());
        }
    }
    choice.text.clone().filter(|t| !t.trim().is_empty())
}

fn body_snippet(body: &str) -> String {
    const MAX_CHARS: usize = 800;
    let trimmed = body.trim();
    let snippet: String = trimmed.chars().take(MAX_CHARS).collect();
    if trimmed.chars().count() > MAX_CHARS {
        format!("{snippet}…")
    } else {
        snippet
    }
}

/// Parses Server-Sent Events chunk payloads (object: `chat.completion.chunk`)
/// and concatenates the streamed deltas. Used as fallback for servers that
/// stream even when `stream: false` is requested.
fn parse_sse_stream_text(body: &str) -> Option<String> {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut saw_chunk = false;
    for line in body.lines() {
        let line = line.trim();
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() || payload == "[DONE]" {
            continue;
        }
        let Ok(chunk) = serde_json::from_str::<serde_json::Value>(payload) else {
            continue;
        };
        // Proxies interleave keep-alives and usage frames; ignore anything that is not a delta.
        if chunk.get("object").and_then(|o| o.as_str()) != Some("chat.completion.chunk") {
            continue;
        }
        saw_chunk = true;
        if let Some(delta) = chunk
            .pointer("/choices/0/delta/content")
            .and_then(|c| c.as_str())
        {
            content.push_str(delta);
        }
        if let Some(delta) = chunk
            .pointer("/choices/0/delta/reasoning_content")
            .and_then(|c| c.as_str())
        {
            reasoning.push_str(delta);
        }
        if let Some(text) = chunk.pointer("/choices/0/text").and_then(|t| t.as_str()) {
            content.push_str(text);
        }
    }
    if !saw_chunk {
        return None;
    }
    if !content.trim().is_empty() {
        Some(content)
    } else if !reasoning.trim().is_empty() {
        Some(reasoning)
    } else {
        None
    }
}

/// Reads the raw body first so parse failures can report what the server actually sent
/// (error object, `content: null`, streamed chunks, HTML from a wrong base URL, ...).
async fn read_chat_completion_text(
    response: reqwest::Response,
    provider_label: &str,
) -> Result<String> {
    let body = response
        .text()
        .await
        .with_context(|| format!("reading {provider_label} response body"))?;
    let parsed: std::result::Result<ChatCompletionResponse, _> = serde_json::from_str(&body);
    if let Ok(res_body) = &parsed {
        if let Some(text) = extract_completion_text(res_body) {
            return Ok(text);
        }
    }
    // Servers that stream anyway (Cloudflare-friendly requests, `stream` defaults) land here.
    if let Some(text) = parse_sse_stream_text(&body) {
        return Ok(text);
    }
    match parsed {
        Err(error) => Err(anyhow!(
            "parsing {provider_label} response: {} ({error})",
            body_snippet(&body)
        )),
        Ok(_) => Err(anyhow!(
            "{provider_label} response did not include choices content: {}",
            body_snippet(&body)
        )),
    }
}

fn chat_completion_payload(
    model: &str,
    prompt: &str,
    json_mode: bool,
    stream: bool,
) -> serde_json::Value {
    let mut payload = json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
        "temperature": 0.2,
        "stream": stream,
    });
    if json_mode {
        payload["response_format"] = json!({ "type": "json_object" });
    }
    payload
}

async fn send_chat_completion(
    client: &reqwest::Client,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    prompt: &str,
    json_mode: bool,
    stream: bool,
    provider_label: &str,
) -> Result<reqwest::Response> {
    let mut request = client
        .post(url)
        .json(&chat_completion_payload(model, prompt, json_mode, stream));
    if let Some(key) = api_key.map(str::trim).filter(|key| !key.is_empty()) {
        request = request.header("Authorization", format!("Bearer {key}"));
    }
    request
        .send()
        .await
        .with_context(|| format!("calling {provider_label}"))
}

/// `StatusCode` renders non-canonical codes as `524 <unknown status code>`.
fn format_status(status: reqwest::StatusCode) -> String {
    match status.canonical_reason() {
        Some(reason) => format!("{} {reason}", status.as_u16()),
        None => status.as_u16().to_string(),
    }
}

fn status_hint(status: reqwest::StatusCode) -> Option<&'static str> {
    match status.as_u16() {
        401 | 403 => Some("the API key was rejected by this endpoint."),
        404 => Some("check the Base URL path (most servers expect a `/v1` suffix)."),
        429 => Some("the provider is rate limiting; wait a moment and try again."),
        520 => Some("Cloudflare: the origin returned an unknown or empty response."),
        521 => Some("Cloudflare: the origin server is down."),
        522 => Some("Cloudflare: the connection to the origin server timed out."),
        523 => Some("Cloudflare: the origin server is unreachable."),
        524 => Some(
            "Cloudflare gave up waiting ~100s for the origin. Retrying in streaming mode usually \
             fixes this; otherwise use a faster model or a shorter video.",
        ),
        525 | 526 => Some("Cloudflare: TLS handshake with the origin server failed."),
        _ => None,
    }
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504 | 522 | 524)
}

/// Long generations send no bytes for over a minute, which is exactly what proxies
/// such as Cloudflare abort with 524. Streaming keeps the connection busy.
fn should_escalate_to_stream(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 504 | 522 | 524)
}

/// Endpoints that already answered 524 once; they need streaming from the start so the
/// next call does not burn another ~100s waiting for the proxy to give up.
static STREAMING_ENDPOINTS: std::sync::Mutex<Option<std::collections::HashSet<String>>> =
    std::sync::Mutex::new(None);

fn endpoint_needs_streaming(url: &str) -> bool {
    let guard = STREAMING_ENDPOINTS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    guard
        .as_ref()
        .is_some_and(|endpoints| endpoints.contains(url))
}

fn remember_streaming_endpoint(url: &str) {
    let mut guard = STREAMING_ENDPOINTS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    guard
        .get_or_insert_with(std::collections::HashSet::new)
        .insert(url.to_string());
}

/// Sends the request, degrading the payload shape and finally switching to streaming,
/// which is what unblocks proxies that abort long non-streaming calls.
async fn request_chat_completion(
    client: &reqwest::Client,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    prompt: &str,
    provider_label: &str,
) -> Result<reqwest::Response> {
    let mut json_mode = true;
    let mut stream = endpoint_needs_streaming(url);
    let mut attempts = 0u32;
    loop {
        attempts += 1;
        let response = send_chat_completion(
            client,
            url,
            api_key,
            model,
            prompt,
            json_mode,
            stream,
            provider_label,
        )
        .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        if matches!(status.as_u16(), 400 | 422) && json_mode {
            json_mode = false;
            continue;
        }
        if should_escalate_to_stream(status) && !stream {
            stream = true;
            remember_streaming_endpoint(url);
            continue;
        }
        if is_retryable_status(status) && attempts < 3 {
            tokio::time::sleep(Duration::from_secs(2 * u64::from(attempts))).await;
            continue;
        }
        return Ok(response);
    }
}

/// Calls any server exposing the OpenAI `POST /chat/completions` contract.
async fn detect_candidates_openai_style(
    transcript: &NormalizedTranscript,
    api_key: Option<&str>,
    model: &str,
    base_url: &str,
    provider_label: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = candidate_prompt(&segments);
    let urls = chat_completion_urls(base_url);
    // Without a timeout a wrong host that accepts TCP but never answers hangs
    // the whole pipeline with no feedback at all.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut last_failure: Option<String> = None;
    let mut accepted: Option<(String, reqwest::Response)> = None;

    for url in &urls {
        let response =
            request_chat_completion(&client, url, api_key, model, &prompt, provider_label).await?;

        // Some OpenAI-compatible servers (LM Studio, llama.cpp, vLLM) reject `response_format`, so the helper retries without it.
        // 404/405 means the route shape is wrong, not the payload: try the next one.
        if matches!(response.status().as_u16(), 404 | 405) && urls.len() > 1 {
            last_failure = Some(format!("{url} -> {}", format_status(response.status())));
            continue;
        }

        accepted = Some((url.clone(), response));
        break;
    }

    let Some((url, response)) = accepted else {
        return Err(anyhow!(
            "{provider_label}: no endpoint answered ({}). Check the Base URL.",
            last_failure.unwrap_or_else(|| urls.join(", "))
        ));
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let hint = status_hint(status)
            .map(|hint| format!(" — {hint}"))
            .unwrap_or_default();
        return Err(anyhow!(
            "{provider_label} request failed ({}) at {url}: {}{hint}",
            format_status(status),
            body_snippet(&body)
        ));
    }

    let text = read_chat_completion_text(response, provider_label).await?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

pub async fn detect_candidates_with_openai_compatible(
    transcript: &NormalizedTranscript,
    api_key: Option<&str>,
    model_name: Option<&str>,
    base_url: Option<&str>,
) -> Result<Vec<CandidateDraft>> {
    let base = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("OPENAI_BASE_URL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            anyhow!(
                "Set OPENAI_BASE_URL or provide a Base URL for the OpenAI-compatible endpoint."
            )
        })?;

    let model = model_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            std::env::var("OPENAI_COMPATIBLE_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            std::env::var("OPENAI_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .ok_or_else(|| {
            anyhow!(
                "Set OPENAI_COMPATIBLE_MODEL or provide a model name for the OpenAI-compatible endpoint."
            )
        })?;

    detect_candidates_openai_style(
        transcript,
        api_key,
        &model,
        &base,
        "OpenAI-compatible endpoint",
    )
    .await
}

pub async fn detect_candidates_with_openai(
    transcript: &NormalizedTranscript,
    api_key: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
    let base_url =
        std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| DEFAULT_OPENAI_BASE_URL.to_string());
    let url = normalize_chat_completions_url(&base_url);

    let response = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "temperature": 0.2,
            "response_format": {
                "type": "json_object"
            }
        }))
        .send()
        .await
        .context("calling OpenAI")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("OpenAI request failed ({status}): {body}"));
    }

    let text = read_chat_completion_text(response, "[OI]").await?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

pub async fn detect_candidates_with_openrouter(
    transcript: &NormalizedTranscript,
    api_key: &str,
    model_name: Option<&str>,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let default_model = "google/gemini-2.5-flash".to_string();
    let model = model_name
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.trim().to_string())
        .or_else(|| std::env::var("OPENROUTER_MODEL").ok().filter(|m| !m.trim().is_empty()))
        .unwrap_or(default_model);

    let response = reqwest::Client::new()
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "temperature": 0.2,
            "response_format": {
                "type": "json_object"
            }
        }))
        .send()
        .await
        .context("calling OpenRouter")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("OpenRouter request failed ({status}): {body}"));
    }

    let text = read_chat_completion_text(response, "OpenRouter").await?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

pub async fn detect_candidates_with_groq(
    transcript: &NormalizedTranscript,
    api_key: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let model =
        std::env::var("GROQ_MODEL").unwrap_or_else(|_| "llama-3.3-70b-versatile".to_string());

    let response = reqwest::Client::new()
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "temperature": 0.2,
            "response_format": {
                "type": "json_object"
            }
        }))
        .send()
        .await
        .context("calling Groq")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Groq request failed ({status}): {body}"));
    }

    let text = read_chat_completion_text(response, "Groq").await?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

#[derive(Debug, Serialize)]
struct ClaudeMessage<'a> {
    role: &'a str,
    content: String,
}

pub async fn detect_candidates_with_claude(
    transcript: &NormalizedTranscript,
    api_key: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let prompt = format!(
        "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection, but extract AS MANY highly viral moments as possible. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
Clips should be 30-90 seconds long, completely self-contained, cut at clean boundaries, and deliver a massive payoff (a mind-blowing fact, hilarious joke, highly controversial opinion, or deep emotional insight). \
Return up to 25 candidates as JSON matching exactly this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}

Transcript:
{segments}"
    );

    let model =
        std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-3-5-sonnet-latest".to_string());

    let response = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 1800,
            "temperature": 0.2,
            "messages": [
                ClaudeMessage {
                    role: "user",
                    content: prompt,
                }
            ]
        }))
        .send()
        .await
        .context("calling Claude")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Claude request failed ({status}): {body}"));
    }

    let message: AnthropicMessage = response.json().await.context("parsing Claude response")?;
    let text = message
        .content
        .into_iter()
        .find_map(|content| content.text)
        .ok_or_else(|| anyhow!("Claude response did not include text content"))?;

    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&text, min_duration)
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: OllamaMessage,
}

pub async fn detect_candidates_with_local_llm(
    transcript: &NormalizedTranscript,
    model_name: &str,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);

    let system_instructions = "You are an elite, world-class social media strategist with a track record of generating viral multi-million-view Shorts, TikToks, and Reels. \
Your sole objective is to identify the ABSOLUTE BEST, most highly-engaging, and trend-setting short-form clip candidates from the provided transcript. \
Do NOT pick random or mediocre segments. Be ruthless in your selection. \
Every candidate must have an insanely strong, curiosity-inducing hook in the first 3 seconds to stop the scroll. \
CRITICAL: Each clip candidate MUST have a duration between 30 and 90 seconds (i.e. 'end' minus 'start' must be between 30.0 and 90.0). \
Do NOT return short clips of less than 30 seconds. Combine multiple adjacent sentences to build a meaningful segment of 30-90 seconds. \
Favor highly shareable content: concrete stories, strong opinions, emotional turns, surprising or counter-intuitive claims, clear payoffs, and high-energy/dramatic peaks. \
You MUST identify and return at least 3-10 candidates. Do not return an empty candidates list. \
Ensure the 'start' and 'end' values correspond to actual timestamps in the transcript. Do not output 0.0 for start and end times.";

    let user_content = format!("Transcript:\n{}", segments);

    let response = reqwest::Client::new()
        .post("http://localhost:11434/api/chat")
        .json(&json!({
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": system_instructions,
                },
                {
                    "role": "user",
                    "content": user_content,
                }
            ],
            "stream": false,
            "options": {
                "temperature": 0.2
            },
            "format": {
                "type": "object",
                "properties": {
                    "candidates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "start": { "type": "number" },
                                "end": { "type": "number" },
                                "score": { "type": "number" },
                                "hook": { "type": "string" },
                                "rationale": { "type": "string" }
                            },
                            "required": ["start", "end", "score", "hook", "rationale"]
                        }
                    }
                },
                "required": ["candidates"]
            }
        }))
        .send()
        .await
        .context("calling local Ollama")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Local Ollama request failed ({status}): {body}"));
    }

    let res_body: OllamaResponse = response
        .json()
        .await
        .context("parsing local Ollama response")?;
    let min_duration = if transcript.duration < 60.0 {
        (transcript.duration * 0.5).max(5.0)
    } else {
        30.0
    };
    parse_candidate_json(&res_body.message.content, min_duration)
}

fn compact_segments(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|segment| {
            let speaker = segment.speaker.as_deref().unwrap_or("Speaker");
            format!(
                "[{:.2}-{:.2}] {}: {}",
                segment.start, segment.end, speaker, segment.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Returns the balanced `{...}` / `[...]` slice starting at the first byte of `text`,
/// skipping braces that appear inside string literals or escapes.
fn balanced_json_slice(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let opener = *bytes.first()?;
    let closer = match opener {
        b'{' => b'}',
        b'[' => b']',
        _ => return None,
    };
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, &byte) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        if byte == b'"' {
            in_string = true;
        } else if byte == opener {
            depth += 1;
        } else if byte == closer {
            depth -= 1;
            if depth == 0 {
                return Some(&text[..offset + 1]);
            }
        }
    }
    None
}

/// Parses every JSON value embedded in `text`, including ones wrapped in prose
/// (reasoning traces, "Here is the JSON:" preambles, stray markdown fences).
fn extract_json_values(text: &str) -> Vec<serde_json::Value> {
    let mut values: Vec<serde_json::Value> = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        values.push(value);
    }
    let bytes = text.as_bytes();
    for (start, &byte) in bytes.iter().enumerate() {
        if byte != b'{' && byte != b'[' {
            continue;
        }
        let Some(slice) = balanced_json_slice(&text[start..]) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(slice) {
            if !values.contains(&value) {
                values.push(value);
            }
        }
    }
    values
}

fn candidates_from_value(val: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    if val.is_array() {
        return val.as_array().cloned();
    }
    if !val.is_object() {
        return None;
    }
    for key in &[
        "candidates",
        "Candidates",
        "moments",
        "clips",
        "segments",
        "results",
    ] {
        if let Some(arr) = val.get(*key).and_then(|v| v.as_array()) {
            return Some(arr.clone());
        }
    }
    if let Some(obj) = val.as_object() {
        for value in obj.values() {
            if let Some(arr) = value.as_array() {
                return Some(arr.clone());
            }
        }
    }
    if val.get("start").is_some() && val.get("end").is_some() {
        return Some(vec![val.clone()]);
    }
    None
}

fn parse_candidate_json(text: &str, min_duration: f64) -> Result<Vec<CandidateDraft>> {
    let trimmed = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // Models served through [OI]-compatible endpoints often answer with prose or a
    // reasoning trace instead of pure JSON. Recover the embedded JSON instead of
    // failing with serde's bare "expected value at line 1 column 1".
    let values = if trimmed.is_empty() {
        Vec::new()
    } else {
        extract_json_values(trimmed)
    };

    let mut best: Option<(u8, Vec<serde_json::Value>)> = None;
    for value in &values {
        let Some(arr) = candidates_from_value(value) else {
            continue;
        };
        let score = if !arr.is_empty() && arr.iter().all(|item| item.is_object()) {
            2
        } else if !arr.is_empty() {
            1
        } else {
            0
        };
        if best.as_ref().map_or(true, |(best_score, _)| score > *best_score) {
            best = Some((score, arr));
        }
        if score == 2 {
            break;
        }
    }

    let Some((_, concrete_arr)) = best else {
        if values.is_empty() {
            let raw = if text.trim().is_empty() {
                "<empty response>".to_string()
            } else {
                body_snippet(text.trim())
            };
            return Err(anyhow!("parsing candidate JSON: {raw}"));
        }
        return Err(anyhow!(
            "model output does not contain a candidates array. Raw output: {}",
            body_snippet(trimmed)
        ));
    };

    let mut drafts = Vec::new();
    for item in &concrete_arr {
        let start = match item.get("start") {
            Some(v) => {
                if let Some(f) = v.as_f64() {
                    f
                } else if let Some(s) = v.as_str() {
                    s.parse::<f64>().unwrap_or(0.0)
                } else if let Some(i) = v.as_i64() {
                    i as f64
                } else {
                    0.0
                }
            }
            None => 0.0,
        };

        let end = match item.get("end") {
            Some(v) => {
                if let Some(f) = v.as_f64() {
                    f
                } else if let Some(s) = v.as_str() {
                    s.parse::<f64>().unwrap_or(0.0)
                } else if let Some(i) = v.as_i64() {
                    i as f64
                } else {
                    0.0
                }
            }
            None => 0.0,
        };

        let mut score = match item.get("score") {
            Some(v) => {
                if let Some(f) = v.as_f64() {
                    f
                } else if let Some(s) = v.as_str() {
                    s.parse::<f64>().unwrap_or(0.8)
                } else if let Some(i) = v.as_i64() {
                    i as f64
                } else {
                    0.8
                }
            }
            None => 0.8,
        };

        if score > 1.0 && score <= 10.0 {
            score /= 10.0;
        } else if score > 10.0 && score <= 100.0 {
            score /= 100.0;
        } else if score > 100.0 {
            score = 1.0;
        } else if score < 0.0 {
            score = 0.0;
        }

        let hook = item
            .get("hook")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let rationale = item
            .get("rationale")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        drafts.push(CandidateDraft {
            start,
            end,
            score,
            hook,
            rationale,
        });
    }

    let mut candidates = drafts
        .clone()
        .into_iter()
        .filter(|candidate| {
            (candidate.end - candidate.start) >= min_duration && !candidate.hook.trim().is_empty()
        })
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        candidates = drafts
            .into_iter()
            .filter(|candidate| {
                (candidate.end - candidate.start) >= 5.0 && !candidate.hook.trim().is_empty()
            })
            .collect::<Vec<_>>();
    }

    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    candidates.truncate(10);
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn segment(start: f64, end: f64, speaker: Option<&str>, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            start,
            end,
            speaker: speaker.map(str::to_string),
            text: text.to_string(),
        }
    }

    #[test]
    fn normalizes_chat_completions_urls() {
        assert_eq!(
            normalize_chat_completions_url(""),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("http://localhost:1234/v1"),
            "http://localhost:1234/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("http://localhost:1234/v1/"),
            "http://localhost:1234/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("https://example.com/v1/chat/completions"),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            normalize_chat_completions_url("  http://host:8080  "),
            "http://host:8080/chat/completions"
        );
    }

    #[test]
    fn bare_host_tries_the_v1_route_first() {
        assert_eq!(
            chat_completion_urls("http://localhost:1234"),
            vec![
                "http://localhost:1234/v1/chat/completions".to_string(),
                "http://localhost:1234/chat/completions".to_string(),
            ]
        );
        assert_eq!(
            chat_completion_urls("http://localhost:1234/v1"),
            vec!["http://localhost:1234/v1/chat/completions".to_string()]
        );
        assert_eq!(
            chat_completion_urls("https://api.example.com/openai/v1"),
            vec!["https://api.example.com/openai/v1/chat/completions".to_string()]
        );
    }

    #[test]
    fn compact_segments_formats_each_line() {
        let segments = vec![
            segment(0.0, 1.5, Some("S1"), "hello"),
            segment(1.5, 3.0, None, "world"),
        ];
        assert_eq!(
            compact_segments(&segments),
            "[0.00-1.50] S1: hello\n[1.50-3.00] Speaker: world"
        );
    }

    #[test]
    fn parse_candidate_json_accepts_fenced_object_and_normalizes_scores() {
        let text = r#"```json
{"candidates":[
  {"start":0,"end":40,"score":9,"hook":"A","rationale":"r"},
  {"start":50,"end":80,"score":0.95,"hook":"B","rationale":"r"},
  {"start":90,"end":95,"score":1,"hook":"C","rationale":"r"}
]}
```"#;

        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].hook, "B");
        assert_eq!(drafts[0].score, 0.95);
        assert_eq!(drafts[1].hook, "A");
        assert!((drafts[1].score - 0.9).abs() < f64::EPSILON);
    }

    #[test]
    fn parse_candidate_json_accepts_root_array() {
        let text = r#"[{"start":0,"end":45,"score":0.5,"hook":"H","rationale":"R"}]"#;
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].end, 45.0);
    }

    #[test]
    fn parse_candidate_json_accepts_single_candidate_object() {
        let text = r#"{"start":10,"end":50,"score":0.7,"hook":"H","rationale":"R"}"#;
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].start, 10.0);
    }

    #[test]
    fn parse_candidate_json_accepts_alternative_keys() {
        let text = r#"{"moments":[{"start":0,"end":35,"score":0.4,"hook":"H","rationale":"R"}]}"#;
        assert_eq!(parse_candidate_json(text, 30.0).unwrap().len(), 1);
    }

    #[test]
    fn parse_candidate_json_falls_back_to_shorter_clips() {
        let text = r#"{"candidates":[{"start":0,"end":10,"score":0.5,"hook":"H","rationale":"R"}]}"#;
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
    }

    #[test]
    fn parse_candidate_json_drops_clips_without_hooks() {
        let text = r#"{"candidates":[{"start":0,"end":40,"score":0.5,"hook":"  ","rationale":"R"}]}"#;
        assert!(parse_candidate_json(text, 30.0).unwrap().is_empty());
    }

    #[test]
    fn parse_candidate_json_clamps_and_parses_loose_scores() {
        let text = r#"{"candidates":[
            {"start":0,"end":40,"score":150,"hook":"big","rationale":""},
            {"start":0,"end":40,"score":-2,"hook":"neg","rationale":""},
            {"start":0,"end":40,"score":"8","hook":"str","rationale":""},
            {"start":"0","end":"40","hook":"missing","rationale":""}
        ]}"#;

        let drafts = parse_candidate_json(text, 30.0).unwrap();
        let by_hook = |hook: &str| drafts.iter().find(|d| d.hook == hook).cloned().unwrap();
        assert_eq!(by_hook("big").score, 1.0);
        assert_eq!(by_hook("neg").score, 0.0);
        assert_eq!(by_hook("str").score, 0.8);
        assert_eq!(by_hook("missing").score, 0.8);
        assert_eq!(by_hook("missing").end, 40.0);
    }

    #[test]
    fn parse_candidate_json_truncates_to_ten_candidates() {
        let candidates: Vec<String> = (0..12)
            .map(|i| format!(r#"{{"start":0,"end":40,"score":0.5,"hook":"h{i}","rationale":""}}"#))
            .collect();
        let text = format!(r#"{{"candidates":[{}]}}"#, candidates.join(","));
        assert_eq!(parse_candidate_json(&text, 30.0).unwrap().len(), 10);
    }

    #[test]
    fn parse_candidate_json_rejects_invalid_json() {
        assert!(parse_candidate_json("not json at all", 30.0).is_err());
        assert!(parse_candidate_json(r#"{"unrelated":true}"#, 30.0).is_err());
    }

    #[test]
    fn parse_candidate_json_rejects_empty_and_whitespace() {
        for text in ["", "   ", "\n\n\n", "```json```", "```json  ```", "```"] {
            let err = parse_candidate_json(text, 30.0).unwrap_err();
            assert!(
                err.to_string().contains("parsing candidate JSON"),
                "unexpected error for {text:?}: {err}"
            );
        }
    }

    #[test]
    fn parse_candidate_json_reports_empty_response_clearly() {
        let err = parse_candidate_json("   ", 30.0).unwrap_err();
        assert_eq!(err.to_string(), "parsing candidate JSON: <empty response>");
    }

    #[test]
    fn parse_candidate_json_reports_prose_without_json() {
        let err = parse_candidate_json("I could not find any good clips.", 30.0).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("parsing candidate JSON"));
        assert!(message.contains("I could not find any good clips."));
    }

    #[test]
    fn parse_candidate_json_recovers_json_after_prose_preamble() {
        let text = concat!(
            "Sure! Here are the best moments:\n\n",
            r#"{"candidates":[{"start":0,"end":40,"score":0.8,"hook":"H","rationale":"R"}]}"#,
            "\n\nLet me know if you need more."
        );
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].hook, "H");
    }

    #[test]
    fn parse_candidate_json_recovers_fenced_json_after_prose_preamble() {
        let text = concat!(
            "Here is the JSON you asked for:\n",
            "```json\n",
            r#"{"candidates":[{"start":10,"end":60,"score":0.6,"hook":"H","rationale":"R"}]}"#,
            "\n```"
        );
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].start, 10.0);
    }

    #[test]
    fn parse_candidate_json_ignores_stray_brackets_in_prose() {
        let text = concat!(
            "I ranked them [1] and [2] like this:\n",
            r#"{"candidates":[{"start":0,"end":45,"score":0.5,"hook":"H","rationale":"R"}]}"#
        );
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].end, 45.0);
    }

    #[test]
    fn parse_candidate_json_recovers_root_array_from_prose() {
        let text = concat!(
            "Analysis complete. Result: ",
            r#"[{"start":5,"end":50,"score":0.7,"hook":"H","rationale":"R"}]"#
        );
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].start, 5.0);
    }

    #[test]
    fn balanced_json_slice_handles_braces_inside_strings() {
        let text = r#"{"hook":"a } brace [ and { too","end":1}"#;
        assert_eq!(balanced_json_slice(text), Some(text));
        assert_eq!(balanced_json_slice("no json here"), None);
        assert_eq!(balanced_json_slice(r#"{"unbalanced":true"#), None);
    }

    #[test]
    fn parse_candidate_json_keeps_reasoning_traces_out_of_the_error() {
        // A reasoning model may emit its scratchpad before the JSON; the JSON must win.
        let text = concat!(
            "Okay, let me think. The user wants clips. {\"thinking\":true}\n",
            r#"{"candidates":[{"start":0,"end":35,"score":0.9,"hook":"H","rationale":"R"}]}"#
        );
        let drafts = parse_candidate_json(text, 30.0).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].hook, "H");
    }

    #[test]
    fn parses_sse_streamed_chunks() {
        let body = concat!(
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n",
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n",
            "data: [DONE]\n"
        );
        assert_eq!(parse_sse_stream_text(body).as_deref(), Some("Hello"));
    }

    #[test]
    fn rejects_non_chunk_sse_payloads_and_empty_streams() {
        let not_chunks = "data: {\"object\":\"chat.completion\",\"choices\":[]}\n";
        assert_eq!(parse_sse_stream_text(not_chunks), None);
        assert_eq!(parse_sse_stream_text("event: ping\n"), None);
    }

    #[test]
    fn extracts_text_from_chat_completion_variants() {
        let string_content: ChatCompletionResponse = serde_json::from_value(json!({
            "choices": [{ "message": { "content": "plain" } }]
        }))
        .unwrap();
        assert_eq!(extract_completion_text(&string_content).as_deref(), Some("plain"));

        let parts_content: ChatCompletionResponse = serde_json::from_value(json!({
            "choices": [{ "message": { "content": [{ "text": "a" }, { "text": "b" }] } }]
        }))
        .unwrap();
        assert_eq!(extract_completion_text(&parts_content).as_deref(), Some("ab"));

        let reasoning: ChatCompletionResponse = serde_json::from_value(json!({
            "choices": [{ "message": { "content": null, "reasoning_content": "thinking" } }]
        }))
        .unwrap();
        assert_eq!(extract_completion_text(&reasoning).as_deref(), Some("thinking"));

        let legacy_text: ChatCompletionResponse = serde_json::from_value(json!({
            "choices": [{ "text": "legacy" }]
        }))
        .unwrap();
        assert_eq!(extract_completion_text(&legacy_text).as_deref(), Some("legacy"));
    }

    #[test]
    fn extract_completion_text_returns_none_without_content() {
        let empty: ChatCompletionResponse = serde_json::from_value(json!({ "choices": [] })).unwrap();
        assert_eq!(extract_completion_text(&empty), None);

        let blank: ChatCompletionResponse = serde_json::from_value(json!({
            "choices": [{ "message": { "content": "   " } }]
        }))
        .unwrap();
        assert_eq!(extract_completion_text(&blank), None);
    }

    #[test]
    fn body_snippet_truncates_long_bodies() {
        let short = "  short body  ";
        assert_eq!(body_snippet(short), "short body");

        let long = "x".repeat(900);
        let snippet = body_snippet(&long);
        assert_eq!(snippet.chars().count(), 801);
        assert!(snippet.ends_with('…'));
    }

    #[test]
    fn chat_completion_payload_toggles_json_mode() {
        let with_json = chat_completion_payload("model", "prompt", true, false);
        assert_eq!(with_json["response_format"]["type"], "json_object");
        assert_eq!(with_json["stream"], false);

        let without_json = chat_completion_payload("model", "prompt", false, false);
        assert!(without_json.get("response_format").is_none());
    }

    #[test]
    fn chat_completion_payload_can_request_streaming() {
        let payload = chat_completion_payload("model", "prompt", true, true);
        assert_eq!(payload["stream"], true);
        assert_eq!(payload["response_format"]["type"], "json_object");
    }

    #[test]
    fn format_status_drops_the_unknown_reason_suffix() {
        let cloudflare = reqwest::StatusCode::from_u16(524).expect("524 is a valid code");
        assert_eq!(format_status(cloudflare), "524");
        assert_eq!(format_status(reqwest::StatusCode::NOT_FOUND), "404 Not Found");
    }

    #[test]
    fn status_hint_explains_cloudflare_timeouts() {
        let hint = status_hint(reqwest::StatusCode::from_u16(524).expect("valid")).unwrap_or("");
        assert!(hint.contains("Cloudflare"));
        assert!(hint.contains("streaming"));
        assert!(status_hint(reqwest::StatusCode::NOT_FOUND)
            .unwrap_or("")
            .contains("Base URL"));
        assert!(status_hint(reqwest::StatusCode::OK).is_none());
    }

    #[test]
    fn retries_and_stream_escalation_cover_proxy_timeouts() {
        let timeout = reqwest::StatusCode::from_u16(524).expect("valid");
        let unavailable = reqwest::StatusCode::from_u16(503).expect("valid");
        assert!(should_escalate_to_stream(timeout));
        assert!(is_retryable_status(timeout));
        assert!(is_retryable_status(unavailable));
        assert!(!should_escalate_to_stream(unavailable));
        assert!(!is_retryable_status(reqwest::StatusCode::NOT_FOUND));
        assert!(!is_retryable_status(reqwest::StatusCode::OK));
    }

    #[test]
    fn remembers_endpoints_that_need_streaming() {
        let url = "https://streaming-reminder.invalid/v1/chat/completions";
        assert!(!endpoint_needs_streaming(url));
        remember_streaming_endpoint(url);
        assert!(endpoint_needs_streaming(url));
        assert!(!endpoint_needs_streaming(
            "https://other-reminder.invalid/v1/chat/completions"
        ));
    }

    #[test]
    fn parse_sse_stream_text_skips_keepalive_frames() {
        let body = concat!(
            "event: ping\n",
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n",
            "data: {\"object\":\"usage\",\"total_tokens\":12}\n",
            "data: [DONE]\n"
        );
        assert_eq!(parse_sse_stream_text(body).as_deref(), Some("ok"));
    }

    #[test]
    fn parse_sse_stream_text_falls_back_to_reasoning_deltas() {
        let body = concat!(
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n",
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"reasoning_content\":\"ing\"}}]}\n",
            "data: [DONE]\n"
        );
        assert_eq!(parse_sse_stream_text(body).as_deref(), Some("thinking"));
    }

    #[test]
    fn parse_sse_stream_text_prefers_content_over_reasoning() {
        let body = concat!(
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"reasoning_content\":\"scratchpad\"}}]}\n",
            "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n",
            "data: [DONE]\n"
        );
        assert_eq!(parse_sse_stream_text(body).as_deref(), Some("answer"));
    }
}
