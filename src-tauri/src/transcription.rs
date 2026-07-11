use std::collections::BTreeSet;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use crate::models::{NormalizedTranscript, TranscriptSegment, TranscriptWord};

pub async fn transcribe_deepgram(audio_path: &str, api_key: &str) -> Result<NormalizedTranscript> {
    let bytes = tokio::fs::read(audio_path)
        .await
        .with_context(|| format!("reading audio file {audio_path}"))?;

    let response = reqwest::Client::new()
        .post("https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&punctuate=true&filler_words=true")
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", "audio/wav")
        .body(bytes)
        .send()
        .await
        .context("calling Deepgram")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!("Deepgram request failed ({status}): {body}"));
    }

    let value: Value = response.json().await.context("parsing Deepgram response")?;
    normalize_deepgram(value)
}

fn normalize_deepgram(value: Value) -> Result<NormalizedTranscript> {
    let alternative = value
        .pointer("/results/channels/0/alternatives/0")
        .ok_or_else(|| anyhow!("Deepgram response did not include an alternative transcript"))?;

    let language = value
        .pointer("/metadata/language")
        .and_then(Value::as_str)
        .unwrap_or("en")
        .to_string();

    let duration = value
        .pointer("/metadata/duration")
        .and_then(Value::as_f64)
        .unwrap_or_default();

    let raw_words = alternative
        .get("words")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Deepgram response did not include word timestamps"))?;

    let mut speakers = BTreeSet::new();
    let mut words = Vec::with_capacity(raw_words.len());

    for word in raw_words {
        let text = word
            .get("punctuated_word")
            .or_else(|| word.get("word"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }

        let speaker = word
            .get("speaker")
            .and_then(Value::as_i64)
            .map(|speaker| format!("S{}", speaker + 1));
        if let Some(speaker) = &speaker {
            speakers.insert(speaker.clone());
        }

        words.push(TranscriptWord {
            text,
            start: word
                .get("start")
                .and_then(Value::as_f64)
                .unwrap_or_default(),
            end: word.get("end").and_then(Value::as_f64).unwrap_or_default(),
            speaker,
        });
    }

    let segments = build_segments(&words);

    Ok(NormalizedTranscript {
        language,
        duration,
        speakers: speakers.into_iter().collect(),
        words,
        segments,
    })
}

pub fn build_segments(words: &[TranscriptWord]) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    let mut current: Option<TranscriptSegment> = None;

    for word in words {
        let should_break = current.as_ref().map_or(false, |segment| {
            let pause = word.start - segment.end;
            let speaker_changed = segment.speaker != word.speaker;
            let sentence_end = segment.text.ends_with(['.', '!', '?']);
            pause > 0.9 || speaker_changed || sentence_end
        });

        if should_break {
            if let Some(segment) = current.take() {
                segments.push(segment);
            }
        }

        match &mut current {
            Some(segment) => {
                segment.end = word.end;
                segment.text.push(' ');
                segment.text.push_str(&word.text);
            }
            None => {
                current = Some(TranscriptSegment {
                    start: word.start,
                    end: word.end,
                    speaker: word.speaker.clone(),
                    text: word.text.clone(),
                });
            }
        }
    }

    if let Some(segment) = current {
        segments.push(segment);
    }

    segments
}

pub fn whisper_cli_exists() -> bool {
    std::process::Command::new("whisper")
        .arg("--help")
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

pub fn whisper_python_exists() -> bool {
    std::process::Command::new("python3")
        .args(["-c", "import whisper"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

fn normalize_whisper_raw_json(raw: serde_json::Value) -> Result<NormalizedTranscript> {
    let language = raw.get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("en")
        .to_string();

    let segments_arr = raw.get("segments")
        .and_then(|v| v.as_array())
        .ok_or_else(|| anyhow!("Missing 'segments' in Whisper JSON"))?;

    let duration = segments_arr.last()
        .and_then(|s| s.get("end").and_then(|e| e.as_f64()))
        .unwrap_or(0.0);

    let mut segments = Vec::new();
    let mut words = Vec::new();

    for seg in segments_arr {
        let start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let text = seg.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

        segments.push(TranscriptSegment {
            start,
            end,
            speaker: Some("S1".to_string()),
            text,
        });

        if let Some(words_arr) = seg.get("words").and_then(|v| v.as_array()) {
            for w in words_arr {
                let word_text = w.get("word").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
                let word_start = w.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let word_end = w.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);

                words.push(TranscriptWord {
                    text: word_text,
                    start: word_start,
                    end: word_end,
                    speaker: Some("S1".to_string()),
                });
            }
        }
    }

    Ok(NormalizedTranscript {
        language,
        duration,
        speakers: vec!["S1".to_string()],
        words,
        segments,
    })
}

pub async fn transcribe_local(audio_path: &str, model_path: &str) -> Result<NormalizedTranscript> {
    let audio_path = audio_path.to_string();
    let model_path = model_path.to_string();

    if whisper_cli_exists() {
        let audio_path_buf = std::path::Path::new(&audio_path);
        let audio_dir = audio_path_buf.parent().ok_or_else(|| anyhow!("Invalid audio path parent"))?;
        let audio_stem = audio_path_buf.file_stem().ok_or_else(|| anyhow!("Invalid audio file stem"))?.to_string_lossy();
        
        let output_json_path = audio_dir.join(format!("{}.json", audio_stem));
        let output_json_path_str = output_json_path.to_string_lossy().to_string();
        let audio_dir_str = audio_dir.to_string_lossy().to_string();
        let audio_dir_clone = audio_dir.to_path_buf();
        let audio_stem_clone = audio_stem.to_string();

        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("whisper")
                .arg(&audio_path)
                .args(["--model", "base"])
                .args(["--output_format", "json"])
                .args(["--output_dir", &audio_dir_str])
                .args(["--word_timestamps", "True"])
                .output()
                .context("executing whisper CLI")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                return Err(anyhow!("Whisper CLI failed:\nStderr: {}\nStdout: {}", stderr, stdout));
            }

            let json_bytes = std::fs::read(&output_json_path_str).context("reading output transcript JSON from CLI")?;
            let raw_json: serde_json::Value = serde_json::from_slice(&json_bytes).context("parsing output transcript JSON")?;
            
            // Clean up the output JSON file
            let _ = std::fs::remove_file(&output_json_path_str);
            
            // Clean up any extra formats whisper CLI might have written (it sometimes generates them by default)
            for ext in &["txt", "srt", "vtt", "tsv"] {
                let extra_file = audio_dir_clone.join(format!("{}.{}", audio_stem_clone, ext));
                if extra_file.exists() {
                    let _ = std::fs::remove_file(extra_file);
                }
            }

            normalize_whisper_raw_json(raw_json)
        })
        .await
        .context("spawn_blocking failed")?
    } else {
        // Resolve the directory where the model lives. We'll put transcribe.py there.
        let model_dir = std::path::Path::new(&model_path)
            .parent()
            .ok_or_else(|| anyhow!("Invalid model path"))?;
        
        let script_path = model_dir.join("transcribe.py");
        if !script_path.exists() {
            let script_content = r#"import sys
import json
import whisper

def main():
    if len(sys.argv) < 3:
        print("Usage: transcribe.py <audio_path> <output_json_path> [model_name]")
        sys.exit(1)
        
    audio_path = sys.argv[1]
    output_json_path = sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base"
    
    # Load model. Automatically uses MPS on Apple Silicon if PyTorch supports it.
    model = whisper.load_model(model_name)
    
    # Transcribe with word-level timestamps
    result = model.transcribe(audio_path, word_timestamps=True)
    
    normalized = {
        "language": result.get("language", "en"),
        "duration": result.get("segments", [])[-1]["end"] if result.get("segments") else 0.0,
        "speakers": ["S1"],
        "words": [],
        "segments": []
    }
    
    for segment in result.get("segments", []):
        normalized["segments"].append({
            "start": segment["start"],
            "end": segment["end"],
            "speaker": "S1",
            "text": segment["text"].strip()
        })
        
        for word in segment.get("words", []):
            cleaned_text = word["word"].strip()
            normalized["words"].append({
                "text": cleaned_text,
                "start": word["start"],
                "end": word["end"],
                "speaker": "S1"
            })
            
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(normalized, f, indent=2, ensure_ascii=False)

if __name__ == "__main__":
    main()
"#;
            std::fs::write(&script_path, script_content).context("writing transcribe.py script")?;
        }

        let output_json_path = model_dir.join(format!("temp_transcript_{}.json", uuid::Uuid::new_v4()));
        let script_path_str = script_path.to_string_lossy().to_string();
        let output_json_path_str = output_json_path.to_string_lossy().to_string();

        tokio::task::spawn_blocking(move || {
            let output = std::process::Command::new("python3")
                .arg(&script_path_str)
                .arg(&audio_path)
                .arg(&output_json_path_str)
                .arg("base") // default model size
                .output()
                .context("executing python3 transcribe.py")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                return Err(anyhow!("Python transcription script failed:\nStderr: {}\nStdout: {}", stderr, stdout));
            }

            let json_bytes = std::fs::read(&output_json_path_str).context("reading output transcript JSON")?;
            let transcript: NormalizedTranscript = serde_json::from_slice(&json_bytes).context("parsing output transcript JSON")?;
            
            // Cleanup temp file
            let _ = std::fs::remove_file(&output_json_path_str);

            Ok(transcript)
        })
        .await
        .context("spawn_blocking failed")?
    }
}
