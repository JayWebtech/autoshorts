//! Automatic "tight cut" editing: silence removal and pacing boosts.
//!
//! The strategy is two-pass on purpose. `ffmpeg`'s `silenceremove` filter edits
//! audio only, which would desync captions and prevent jump cuts. Instead this
//! module detects silence once, builds an explicit cut list
//! ([`AutoEditPlan`]), and the renderer replays that list with
//! `trim`/`atrim` + `concat`. Because the plan is data, captions can be
//! remapped onto the compressed timeline ([`remap_cues`]) and the same plan can
//! be previewed in the UI before spending render time.

use std::process::Command;

use anyhow::{anyhow, Context, Result};

use crate::models::{AutoEditSettings, CaptionCue, TranscriptWord};

/// Shortest piece of video worth keeping; shorter leftovers are merged.
const MIN_SEGMENT_SEC: f64 = 0.12;

/// Absorbs float noise such as `1.4 - 1.0 = 0.3999999999999999` so an exactly
/// threshold-sized gap is not silently dropped.
const TIMING_EPSILON: f64 = 1e-6;

/// One span of the source timeline kept in the output, optionally retimed.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderSegment {
    pub start: f64,
    pub end: f64,
    /// Playback rate. 1.0 = realtime, >1 = faster (shorter on output).
    pub speed: f64,
    /// Extra punch-in zoom applied after the crop; 1.0 keeps the framing.
    pub zoom: f64,
}

impl RenderSegment {
    pub fn output_len(&self) -> f64 {
        if self.speed <= 0.0 {
            0.0
        } else {
            (self.end - self.start).max(0.0) / self.speed
        }
    }
}

/// Cut list for one clip: source spans, in order, plus output timing.
#[derive(Debug, Clone, PartialEq)]
pub struct AutoEditPlan {
    pub segments: Vec<RenderSegment>,
    pub source_start: f64,
    pub source_end: f64,
    pub output_duration: f64,
    /// Seconds of source material removed from the clip.
    pub removed_sec: f64,
    /// Number of silence gaps found (before padding/refinement).
    pub silence_count: usize,
}

impl AutoEditPlan {
    /// True when the plan changes nothing and the simple render path applies.
    pub fn is_noop(&self) -> bool {
        self.segments.len() <= 1
            && self
                .segments
                .first()
                .map(|segment| (segment.speed - 1.0).abs() < 1e-3)
                .unwrap_or(true)
    }

    /// Output timestamp of a source timestamp, or `None` when it was cut.
    pub fn map_time(&self, source_time: f64) -> Option<f64> {
        let mut cursor = 0.0;
        for segment in &self.segments {
            if source_time < segment.start {
                return None;
            }
            if source_time <= segment.end {
                let offset = (source_time - segment.start) / segment.speed.max(1e-6);
                return Some(cursor + offset);
            }
            cursor += segment.output_len();
        }
        None
    }
}

/// Ask ffmpeg where the quiet stretches are inside `start_sec..end_sec`.
///
/// `silencedetect` reports on stderr, so the whole log is captured and parsed.
/// Times are shifted by the seek offset, returning absolute source seconds.
pub fn detect_silences(
    source_path: &str,
    start_sec: f64,
    end_sec: f64,
    threshold_db: f64,
    min_silence_sec: f64,
) -> Result<Vec<(f64, f64)>> {
    let duration = (end_sec - start_sec).max(0.1);
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-nostats", "-vn"])
        .args(["-ss", &format!("{start_sec:.3}")])
        .args(["-t", &format!("{duration:.3}")])
        .args(["-i", source_path])
        .args([
            "-af",
            &format!("silencedetect=noise={threshold_db:.1}dB:d={min_silence_sec:.2}"),
            "-f",
            "null",
            "-",
        ])
        .output()
        .context("running ffmpeg silencedetect")?;

    if !output.status.success() {
        return Err(anyhow!(
            "ffmpeg silencedetect failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(parse_silence_gaps(
        &String::from_utf8_lossy(&output.stderr),
        start_sec,
        end_sec,
    ))
}

/// Parse `silence_start`/`silence_end` log lines into absolute gaps.
fn parse_silence_gaps(stderr: &str, offset: f64, window_end: f64) -> Vec<(f64, f64)> {
    let mut gaps: Vec<(f64, f64)> = Vec::new();
    let mut open: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(index) = line.find("silence_start:") {
            let value = line[index + "silence_start:".len()..].trim();
            if let Some(seconds) = value
                .split_whitespace()
                .next()
                .and_then(|token| token.parse::<f64>().ok())
            {
                // A repeated start without an end would otherwise swallow the
                // previous gap; keep the earliest one.
                let start = offset + seconds;
                open = Some(open.map_or(start, |existing| existing.min(start)));
            }
        } else if let Some(index) = line.find("silence_end:") {
            let value = line[index + "silence_end:".len()..].trim();
            let seconds = value
                .split('|')
                .next()
                .unwrap_or_default()
                .trim()
                .parse::<f64>()
                .ok();
            if let (Some(start), Some(end)) = (open.take(), seconds) {
                let end = offset + end;
                if end > start {
                    gaps.push((start, end));
                }
            }
        }
    }

    // Silence that runs until the end of the window never gets a `silence_end`.
    if let Some(start) = open {
        if window_end > start {
            gaps.push((start, window_end));
        }
    }

    gaps
}

/// Detect silence and turn it into a cut list in one call.
pub fn build_plan(
    source_path: &str,
    start_sec: f64,
    end_sec: f64,
    settings: &AutoEditSettings,
    words: &[TranscriptWord],
) -> Result<AutoEditPlan> {
    if end_sec <= start_sec {
        return Err(anyhow!("invalid clip window"));
    }
    let settings = settings.clone().sanitized();
    let silences = detect_silences(
        source_path,
        start_sec,
        end_sec,
        settings.silence_threshold_db,
        settings.min_silence_sec,
    )?;
    Ok(plan_from_silences(
        start_sec,
        end_sec,
        &silences,
        words,
        &settings,
    ))
}

/// Pure cut-list builder: silence gaps + transcript + settings -> plan.
///
/// Detection by audio is the source of truth, but the transcript refines it:
/// a gap that overlaps a spoken word is not a real pause (breath, soft voice),
/// so only the silent remainder of that gap becomes a cut.
pub fn plan_from_silences(
    source_start: f64,
    source_end: f64,
    silences: &[(f64, f64)],
    words: &[TranscriptWord],
    settings: &AutoEditSettings,
) -> AutoEditPlan {
    let window = (source_end - source_start).max(0.0);
    let fallback = AutoEditPlan {
        segments: vec![RenderSegment {
            start: source_start,
            end: source_end,
            speed: 1.0,
            zoom: 1.0,
        }],
        source_start,
        source_end,
        output_duration: window,
        removed_sec: 0.0,
        silence_count: 0,
    };
    if window <= 0.0 {
        return AutoEditPlan {
            segments: Vec::new(),
            output_duration: 0.0,
            ..fallback
        };
    }

    // Speech map from the transcript, used to protect spoken material.
    let mut speech: Vec<(f64, f64)> = words
        .iter()
        .filter(|word| word.end > source_start && word.start < source_end && word.end > word.start)
        .map(|word| (word.start.max(source_start), word.end.min(source_end)))
        .collect();
    merge_intervals(&mut speech);

    let mut gaps: Vec<(f64, f64)> = silences
        .iter()
        .map(|(start, end)| (start.max(source_start), end.min(source_end)))
        .filter(|(start, end)| end > start)
        .collect();
    merge_intervals(&mut gaps);
    let silence_count = gaps.len();

    // Silence that survives the transcript, shrunk by the padding the user
    // wants to keep on each side of a cut.
    let mut cuts: Vec<(f64, f64)> = Vec::new();
    for gap in &gaps {
        if gap.1 - gap.0 + TIMING_EPSILON < settings.min_silence_sec {
            continue;
        }
        for piece in subtract_intervals(*gap, &speech) {
            if piece.1 - piece.0 + TIMING_EPSILON < settings.min_silence_sec {
                continue;
            }
            let start = piece.0 + settings.padding_sec;
            let end = piece.1 - settings.padding_sec;
            if end - start >= MIN_SEGMENT_SEC {
                cuts.push((start, end));
            }
        }
    }
    merge_intervals(&mut cuts);

    // Walk the window, alternating speech and silence spans.
    let mut segments: Vec<RenderSegment> = Vec::new();
    let mut cursor = source_start;
    for (cut_start, cut_end) in &cuts {
        if cut_start - cursor >= MIN_SEGMENT_SEC {
            segments.push(RenderSegment {
                start: cursor,
                end: *cut_start,
                speed: 1.0,
                zoom: 1.0,
            });
        }
        if settings.keeps_silence() {
            segments.push(RenderSegment {
                start: *cut_start,
                end: *cut_end,
                speed: settings.silence_speed,
                zoom: 1.0,
            });
        }
        cursor = *cut_end;
    }
    if source_end - cursor >= MIN_SEGMENT_SEC {
        segments.push(RenderSegment {
            start: cursor,
            end: source_end,
            speed: 1.0,
            zoom: 1.0,
        });
    }

    // Punch-in alternates on realtime (speech) segments only: the first one
    // keeps the framing the user picked in the editor, the next one is tighter.
    if settings.punch_in_zoom > 1.0 {
        let mut speech_index = 0usize;
        for segment in &mut segments {
            if (segment.speed - 1.0).abs() > 1e-3 {
                continue;
            }
            if speech_index % 2 == 1 {
                segment.zoom = settings.punch_in_zoom;
            }
            speech_index += 1;
        }
    }

    // A single cut in the middle of a long take leaves three tiny segments;
    // merging neighbours of the same speed keeps the filter graph short.
    let mut merged: Vec<RenderSegment> = Vec::new();
    for segment in segments {
        match merged.last_mut() {
            Some(last)
                if (last.speed - segment.speed).abs() < 1e-3
                    && (last.zoom - segment.zoom).abs() < 1e-3
                    && segment.start - last.end < 1e-3 =>
            {
                last.end = segment.end;
            }
            _ => merged.push(segment),
        }
    }
    merged.retain(|segment| segment.end - segment.start >= MIN_SEGMENT_SEC);

    if merged.is_empty() {
        return fallback;
    }

    let output_duration: f64 = merged.iter().map(RenderSegment::output_len).sum();
    AutoEditPlan {
        segments: merged,
        source_start,
        source_end,
        output_duration,
        removed_sec: (window - output_duration).max(0.0),
        silence_count,
    }
}

/// Rewrite caption cues from source time onto the compressed output timeline.
///
/// Cues are returned 0-based (the rendered clip starts at zero) so the ASS
/// builder can be called with a `0.0..output_duration` window. A cue split by a
/// cut becomes one cue per surviving side.
pub fn remap_cues(cues: &[CaptionCue], plan: &AutoEditPlan) -> Vec<CaptionCue> {
    let mut remapped: Vec<CaptionCue> = Vec::new();
    let mut output_cursor = 0.0;

    for segment in &plan.segments {
        let speed = segment.speed.max(1e-6);
        for cue in cues {
            let start = cue.start.max(segment.start);
            let end = cue.end.min(segment.end);
            if end - start < 0.05 {
                continue;
            }
            let text = cue.text.trim();
            if text.is_empty() {
                continue;
            }
            let mapped_start = output_cursor + (start - segment.start) / speed;
            let mapped_end = output_cursor + (end - segment.start) / speed;
            if mapped_end - mapped_start < 0.05 {
                continue;
            }
            remapped.push(CaptionCue {
                start: mapped_start,
                end: mapped_end,
                text: text.to_string(),
            });
        }
        output_cursor += segment.output_len();
    }

    remapped.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    remapped
}

/// Merge overlapping or touching intervals, in place, sorted by start.
fn merge_intervals(intervals: &mut Vec<(f64, f64)>) {
    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut merged: Vec<(f64, f64)> = Vec::with_capacity(intervals.len());
    for (start, end) in intervals.drain(..) {
        match merged.last_mut() {
            Some(last) if start <= last.1 + 1e-6 => {
                if end > last.1 {
                    last.1 = end;
                }
            }
            _ => merged.push((start, end)),
        }
    }
    *intervals = merged;
}

/// `interval` minus every span in `holes`, preserving order.
fn subtract_intervals(interval: (f64, f64), holes: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut pieces = vec![interval];
    for hole in holes {
        let mut next: Vec<(f64, f64)> = Vec::new();
        for (start, end) in pieces {
            if hole.1 <= start || hole.0 >= end {
                next.push((start, end));
                continue;
            }
            if hole.0 > start {
                next.push((start, hole.0));
            }
            if hole.1 < end {
                next.push((hole.1, end));
            }
        }
        pieces = next;
    }
    pieces.retain(|(start, end)| end > start);
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AutoEditSettings {
        AutoEditSettings {
            enabled: true,
            silence_threshold_db: -32.0,
            min_silence_sec: 0.4,
            padding_sec: 0.05,
            silence_mode: "cut".to_string(),
            silence_speed: 1.5,
            punch_in_zoom: 1.0,
        }
    }

    fn word(text: &str, start: f64, end: f64) -> TranscriptWord {
        TranscriptWord {
            text: text.to_string(),
            start,
            end,
            speaker: None,
        }
    }

    #[test]
    fn parses_silence_start_and_end_pairs() {
        let log = "[silencedetect @ 0x1] silence_start: 1.0\n\
                   [silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 1.5\n";
        assert_eq!(parse_silence_gaps(log, 0.0, 10.0), vec![(1.0, 2.5)]);
        assert_eq!(parse_silence_gaps(log, 4.0, 10.0), vec![(5.0, 6.5)]);
    }

    #[test]
    fn closes_unterminated_silence_at_window_end() {
        let log = "[silencedetect @ 0x1] silence_start: 8.0\n";
        assert_eq!(parse_silence_gaps(log, 0.0, 10.0), vec![(8.0, 10.0)]);
    }

    #[test]
    fn cut_mode_removes_silence_and_keeps_speech() {
        let words = vec![word("oi", 0.2, 1.0), word("tudo", 3.0, 4.0)];
        let plan = plan_from_silences(0.0, 5.0, &[(1.2, 2.8)], &words, &settings());

        assert_eq!(plan.silence_count, 1);
        // 1.6s of silence minus 2 * 0.05 padding = 1.5s removed.
        assert!((plan.removed_sec - 1.5).abs() < 1e-6, "{plan:?}");
        assert!((plan.output_duration - 3.5).abs() < 1e-6, "{plan:?}");
        assert_eq!(plan.segments.len(), 2);
        assert!(plan.segments.iter().all(|segment| (segment.speed - 1.0).abs() < 1e-9));
    }

    #[test]
    fn transcript_protects_spoken_words_inside_a_gap() {
        // Quiet voice registered as silence, but the word is clearly spoken.
        let words = vec![word("baixo", 1.4, 1.8)];
        let plan = plan_from_silences(0.0, 4.0, &[(1.0, 2.0)], &words, &settings());

        // Only the 0.4s before the word is long enough to cut; the 0.2s tail
        // after it is shorter than `min_silence_sec` and stays.
        assert_eq!(plan.segments.len(), 2, "{plan:?}");
        assert!(plan
            .segments
            .iter()
            .any(|segment| segment.start <= 1.4 && segment.end >= 1.8));
    }

    #[test]
    fn speed_mode_keeps_silence_but_retimes_it() {
        let mut settings = settings();
        settings.silence_mode = "speed".to_string();
        settings.silence_speed = 2.0;
        let plan = plan_from_silences(0.0, 4.0, &[(1.0, 2.0)], &[], &settings);

        assert_eq!(plan.segments.len(), 3, "{plan:?}");
        assert!((plan.segments[1].speed - 2.0).abs() < 1e-9);
        // 1.05 + 0.9/2 + 2.05 -> the 0.9s silence plays in 0.45s.
        assert!((plan.output_duration - 3.55).abs() < 1e-6, "{plan:?}");
        assert!((plan.removed_sec - 0.45).abs() < 1e-6, "{plan:?}");
    }

    #[test]
    fn short_gaps_are_left_alone() {
        let plan = plan_from_silences(0.0, 3.0, &[(1.0, 1.2)], &[], &settings());
        assert!(plan.is_noop(), "{plan:?}");
        assert!((plan.removed_sec - 0.0).abs() < 1e-9);
    }

    #[test]
    fn remaps_cues_onto_the_compressed_timeline() {
        let plan = plan_from_silences(0.0, 5.0, &[(1.5, 3.0)], &[], &settings());
        let cues = vec![
            CaptionCue {
                start: 0.0,
                end: 1.0,
                text: "a".into(),
            },
            CaptionCue {
                start: 3.2,
                end: 4.0,
                text: "b".into(),
            },
        ];

        let remapped = remap_cues(&cues, &plan);
        assert_eq!(remapped.len(), 2, "{remapped:?}");
        assert!((remapped[0].start - 0.0).abs() < 1e-6);
        // First segment keeps 1.55s, then cue starts 0.25s into the second.
        assert!((remapped[1].start - 1.80).abs() < 1e-6, "{remapped:?}");
    }

    #[test]
    fn cues_inside_a_removed_gap_disappear() {
        let plan = plan_from_silences(0.0, 5.0, &[(1.5, 3.0)], &[], &settings());
        let cues = vec![CaptionCue {
            start: 2.0,
            end: 2.6,
            text: "silence".into(),
        }];
        assert!(remap_cues(&cues, &plan).is_empty());
    }

    #[test]
    fn punch_in_alternates_on_speech_segments() {
        let mut settings = settings();
        settings.punch_in_zoom = 1.08;
        let plan = plan_from_silences(0.0, 8.0, &[(1.0, 2.0), (4.0, 5.0)], &[], &settings);

        let speech: Vec<&RenderSegment> = plan
            .segments
            .iter()
            .filter(|segment| (segment.speed - 1.0).abs() < 1e-9)
            .collect();
        assert_eq!(speech.len(), 3, "{plan:?}");
        assert!((speech[0].zoom - 1.0).abs() < 1e-9);
        assert!((speech[1].zoom - 1.08).abs() < 1e-9);
        assert!((speech[2].zoom - 1.0).abs() < 1e-9);
    }

    #[test]
    fn map_time_tracks_speed_segments() {
        let plan = AutoEditPlan {
            segments: vec![
                RenderSegment {
                    start: 0.0,
                    end: 2.0,
                    speed: 1.0,
                    zoom: 1.0,
                },
                RenderSegment {
                    start: 2.0,
                    end: 4.0,
                    speed: 2.0,
                    zoom: 1.0,
                },
            ],
            source_start: 0.0,
            source_end: 4.0,
            output_duration: 3.0,
            removed_sec: 1.0,
            silence_count: 1,
        };

        assert_eq!(plan.map_time(1.0), Some(1.0));
        assert_eq!(plan.map_time(3.0), Some(2.5));
        assert_eq!(plan.map_time(9.0), None);
    }

    #[test]
    fn subtract_intervals_splits_around_a_hole() {
        assert_eq!(
            subtract_intervals((0.0, 10.0), &[(2.0, 4.0)]),
            vec![(0.0, 2.0), (4.0, 10.0)]
        );
        assert_eq!(
            subtract_intervals((0.0, 10.0), &[(0.0, 10.0)]),
            Vec::<(f64, f64)>::new()
        );
    }
}
