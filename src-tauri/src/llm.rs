use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::models::{CandidateDraft, NormalizedTranscript, TranscriptSegment};


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
    min_seconds: f64,
    max_seconds: f64,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let dur = format!("{:.0}-{:.0}", min_seconds, max_seconds);
    let prompt = format!(
        "You are identifying the most viral moments and strongest short-form clip candidates from a long-form transcript. \
For each candidate, the clip must be self-contained, starting with an extremely engaging hook within the first 3 seconds (to capture immediate attention on social feeds), \
{dur} seconds long, and cut at clean sentence/thought boundaries. Favor highly shareable content: concrete stories, \
strong opinions, emotional turns, surprising or counter-intuitive claims, clear payoffs, and high-energy/dramatic peaks. \
Avoid rambling setup, context-dependent references, and pure filler. Return up to 10 candidates as JSON matching this schema: \
{{\"candidates\":[{{\"start\":0.0,\"end\":0.0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}\n\nTranscript:\n{segments}"
    );

    let response = reqwest::Client::new()
        .post("https://api.deepseek.com/chat/completions")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({
            "model": "deepseek-chat",
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

    let min_duration = min_clip_duration(transcript.duration, min_seconds);
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
    min_seconds: f64,
    max_seconds: f64,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);
    let dur = format!("{:.0}-{:.0}", min_seconds, max_seconds);
    let prompt = format!(
        "You are identifying the most viral moments and strongest short-form clip candidates from a long-form transcript. \
For each candidate, the clip must be self-contained, starting with an extremely engaging hook within the first 3 seconds (to capture immediate attention on social feeds), \
{dur} seconds long, and cut at clean sentence/thought boundaries. Favor highly shareable content: concrete stories, \
strong opinions, emotional turns, surprising or counter-intuitive claims, clear payoffs, and high-energy/dramatic peaks. \
Avoid rambling setup, context-dependent references, and pure filler. Return up to 10 candidates as JSON only: \
{{\"candidates\":[{{\"start\":0,\"end\":0,\"score\":0.0,\"hook\":\"...\",\"rationale\":\"...\"}}]}}\n\nTranscript:\n{segments}"
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

    let min_duration = min_clip_duration(transcript.duration, min_seconds);
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
    min_seconds: f64,
    max_seconds: f64,
) -> Result<Vec<CandidateDraft>> {
    let segments = compact_segments(&transcript.segments);

    let system_instructions = format!("You are identifying the most viral moments and strongest short-form clip candidates from a long-form transcript. \
For each candidate, the clip must be self-contained, starting with an extremely engaging hook within the first 3 seconds (to capture immediate attention on social feeds), \
{min_seconds:.0}-{max_seconds:.0} seconds long, and cut at clean sentence/thought boundaries. \
CRITICAL: Each clip candidate MUST have a duration between {min_seconds:.0} and {max_seconds:.0} seconds (i.e. 'end' minus 'start' must be between {min_seconds:.1} and {max_seconds:.1}). \
Do NOT return short clips of less than {min_seconds:.0} seconds. Combine multiple adjacent sentences to build a meaningful segment of {min_seconds:.0}-{max_seconds:.0} seconds. \
Favor highly shareable content: concrete stories, strong opinions, emotional turns, surprising or counter-intuitive claims, clear payoffs, and high-energy/dramatic peaks. \
Avoid rambling setup, context-dependent references, and pure filler. \
You MUST identify and return at least 3-5 candidates (up to 10 candidates). Do not return an empty candidates list. \
Ensure the 'start' and 'end' values correspond to actual timestamps in the transcript. Do not output 0.0 for start and end times.");

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

    let res_body: OllamaResponse = response.json().await.context("parsing local Ollama response")?;
    let min_duration = min_clip_duration(transcript.duration, min_seconds);
    parse_candidate_json(&res_body.message.content, min_duration)
}

/// Minimum acceptable clip length, relaxed for transcripts shorter than the
/// requested band so very short sources still yield candidates.
// ponytail: simple heuristic; revisit if users want a hard floor regardless of source length
fn min_clip_duration(transcript_duration: f64, min_seconds: f64) -> f64 {
    if transcript_duration < min_seconds * 2.0 {
        (transcript_duration * 0.5).max(5.0)
    } else {
        min_seconds
    }
}

pub fn demo_candidates(transcript: &NormalizedTranscript) -> Vec<CandidateDraft> {
    transcript
        .segments
        .chunks(8)
        .take(10)
        .enumerate()
        .filter_map(|(index, chunk)| {
            let first = chunk.first()?;
            let last = chunk.last()?;
            let duration = last.end - first.start;
            if duration < 12.0 {
                return None;
            }

            let end = if duration > 90.0 {
                first.start + 90.0
            } else {
                last.end
            };

            Some(CandidateDraft {
                start: first.start,
                end,
                score: (0.86 - (index as f64 * 0.035)).max(0.55),
                hook: first
                    .text
                    .split_whitespace()
                    .take(12)
                    .collect::<Vec<_>>()
                    .join(" "),
                rationale: "Demo ranking generated without Claude. Use ANTHROPIC_API_KEY for production-quality moment detection.".to_string(),
            })
        })
        .collect()
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

fn parse_candidate_json(text: &str, min_duration: f64) -> Result<Vec<CandidateDraft>> {
    let trimmed = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let val: serde_json::Value = serde_json::from_str(trimmed).context("parsing candidate JSON")?;
    
    let candidates_arr = if val.is_array() {
        val.as_array().cloned()
    } else if val.is_object() {
        let mut found_arr = None;
        for key in &["candidates", "Candidates", "moments", "clips", "segments", "results"] {
            if let Some(arr) = val.get(*key).and_then(|v| v.as_array()) {
                found_arr = Some(arr.clone());
                break;
            }
        }
        if found_arr.is_none() {
            if let Some(obj) = val.as_object() {
                for (_key, value) in obj {
                    if let Some(arr) = value.as_array() {
                        found_arr = Some(arr.clone());
                        break;
                    }
                }
            }
        }
        if found_arr.is_some() {
            found_arr
        } else if val.get("start").is_some() && val.get("end").is_some() {
            Some(vec![val.clone()])
        } else {
            None
        }
    } else {
        None
    };

    let concrete_arr = candidates_arr.ok_or_else(|| {
        anyhow!(
            "Ollama output does not contain a candidates array. Raw output: {}",
            trimmed
        )
    })?;

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

        let hook = item.get("hook")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let rationale = item.get("rationale")
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
            (candidate.end - candidate.start) >= min_duration
                && !candidate.hook.trim().is_empty()
        })
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        candidates = drafts
            .into_iter()
            .filter(|candidate| {
                (candidate.end - candidate.start) >= 5.0
                    && !candidate.hook.trim().is_empty()
            })
            .collect::<Vec<_>>();
    }

    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    candidates.truncate(10);
    Ok(candidates)
}
