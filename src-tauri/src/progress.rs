//! Unified progress reporting for every long-running pipeline step.
//!
//! Backend commands emit a single `pipeline-progress` event consumed by one
//! global progress bar in the UI. `percentage` is `None` when the step cannot
//! be measured (cloud uploads, LLM calls), which the UI renders as an
//! indeterminate bar.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const PIPELINE_PROGRESS_EVENT: &str = "pipeline-progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    /// Machine-readable stage id: import, extract, transcribe, moments, cut, youtube.
    pub stage: String,
    /// Human-readable description shown next to the bar.
    pub label: String,
    /// 0..=100, or `None` for indeterminate progress.
    pub percentage: Option<f64>,
}

/// Emit a progress update. Failures are ignored: progress reporting must never
/// abort the actual work.
pub fn emit(app: &AppHandle, stage: &str, label: impl Into<String>, percentage: Option<f64>) {
    let _ = app.emit(
        PIPELINE_PROGRESS_EVENT,
        ProgressPayload {
            stage: stage.to_string(),
            label: label.into(),
            percentage: percentage.map(|value| value.clamp(0.0, 100.0)),
        },
    );
}

/// Convenience helper for marking a stage as finished.
pub fn finish(app: &AppHandle, stage: &str, label: impl Into<String>) {
    emit(app, stage, label, Some(100.0));
}
