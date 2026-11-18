//! Integration tests for the SQLite persistence layer.
//!
//! These tests exercise the real `Database` against a temporary database file,
//! so migrations, foreign keys and cascade deletes are covered end to end.

use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use autoshorts_lib::db::Database;
use autoshorts_lib::models::{CandidateDraft, CaptionCue, CaptionStyleOverride, ClipEdit};

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Temporary directory that removes itself (and the database inside) on drop.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(label: &str) -> Self {
        let unique = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "autoshorts-tests-{}-{}-{}",
            std::process::id(),
            unique,
            label
        ));
        std::fs::create_dir_all(&path).expect("creating temp directory");
        Self { path }
    }

    fn db_path(&self) -> PathBuf {
        self.path.join("autoshorts.sqlite3")
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn open_db(dir: &TempDir) -> Database {
    Database::open(&dir.db_path()).expect("opening test database")
}

fn draft(index: usize) -> CandidateDraft {
    CandidateDraft {
        start: index as f64 * 10.0,
        end: index as f64 * 10.0 + 30.0,
        score: 1.0 - index as f64 * 0.05,
        hook: format!("hook {index}"),
        rationale: format!("rationale {index}"),
    }
}

fn drafts(count: usize) -> Vec<CandidateDraft> {
    (0..count).map(draft).collect()
}

fn table_count(path: &Path, table: &str) -> i64 {
    let conn = rusqlite::Connection::open(path).expect("opening database for assertions");
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
        .expect("counting rows")
}

#[test]
fn creates_and_reads_projects() {
    let dir = TempDir::new("projects");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", Some(120.0))
        .expect("creating project");

    assert_eq!(project.source_path, "/media/input.mp4");
    assert_eq!(project.status, "ingest");
    assert_eq!(project.transcription_mode, "local");
    assert_eq!(project.caption_style.as_deref(), Some("modern-box"));
    assert_eq!(project.source_duration, Some(120.0));

    let loaded = db.get_project(&project.id).expect("loading project");
    assert_eq!(loaded.id, project.id);
    assert_eq!(loaded.source_path, project.source_path);

    let all = db.list_projects().expect("listing projects");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, project.id);
}

#[test]
fn project_detail_starts_empty_and_tracks_transcript() {
    let dir = TempDir::new("detail");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    let detail = db.project_detail(&project.id).expect("loading detail");
    assert!(detail.transcript.is_none());
    assert!(detail.candidates.is_empty());
    assert!(detail.clips.is_empty());
    assert!(detail.copy.is_empty());

    db.save_transcript(&project.id, "whisper", "{\"segments\":[]}", Some("pt"))
        .expect("saving transcript");

    let detail = db.project_detail(&project.id).expect("loading detail");
    let transcript = detail.transcript.expect("transcript should exist");
    assert_eq!(transcript.engine, "whisper");
    assert_eq!(transcript.language.as_deref(), Some("pt"));
}

#[test]
fn saving_a_transcript_replaces_the_previous_one() {
    let dir = TempDir::new("transcripts");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    db.save_transcript(&project.id, "deepgram", "{\"v\":1}", Some("en"))
        .expect("saving first transcript");
    db.save_transcript(&project.id, "whisper", "{\"v\":2}", Some("es"))
        .expect("saving second transcript");

    let latest = db
        .latest_transcript(&project.id)
        .expect("loading latest transcript")
        .expect("transcript should exist");
    assert_eq!(latest.engine, "whisper");
    assert_eq!(latest.raw_json, "{\"v\":2}");
    assert_eq!(latest.language.as_deref(), Some("es"));
    assert_eq!(table_count(&dir.db_path(), "transcripts"), 1);
}

#[test]
fn replace_candidates_ranks_and_auto_selects_six() {
    let dir = TempDir::new("candidates");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    let created = db
        .replace_candidates(&project.id, &drafts(8))
        .expect("replacing candidates");
    assert_eq!(created.len(), 8);

    let candidates = db.list_candidates(&project.id).expect("listing candidates");
    assert_eq!(candidates.len(), 8);
    for (index, candidate) in candidates.iter().enumerate() {
        assert_eq!(candidate.rank, index as i64 + 1);
        assert_eq!(candidate.selected, index < 6);
        assert_eq!(candidate.project_id, project.id);
    }

    let detail = db.project_detail(&project.id).expect("loading detail");
    assert_eq!(detail.clips.len(), 8);
    assert!(detail.clips.iter().all(|clip| clip.status == "pending"));
}

#[test]
fn replace_candidates_is_idempotent() {
    let dir = TempDir::new("replace");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    db.replace_candidates(&project.id, &drafts(4))
        .expect("first replacement");
    db.replace_candidates(&project.id, &drafts(2))
        .expect("second replacement");

    assert_eq!(db.list_candidates(&project.id).unwrap().len(), 2);
    assert_eq!(table_count(&dir.db_path(), "candidates"), 2);
    assert_eq!(table_count(&dir.db_path(), "clips"), 2);
}

#[test]
fn selected_clip_count_toggles_selection_by_rank() {
    let dir = TempDir::new("selection");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    db.replace_candidates(&project.id, &drafts(5))
        .expect("replacing candidates");

    let selected = db
        .set_selected_clip_count(&project.id, 2)
        .expect("selecting two clips");
    assert_eq!(selected.iter().filter(|candidate| candidate.selected).count(), 2);
    assert!(selected[0].selected);
    assert!(selected[1].selected);
    assert!(!selected[2].selected);

    let selected = db
        .set_selected_clip_count(&project.id, 4)
        .expect("selecting four clips");
    assert_eq!(selected.iter().filter(|candidate| candidate.selected).count(), 4);
}

#[test]
fn clip_updates_keep_existing_paths_when_none_is_passed() {
    let dir = TempDir::new("clips");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");
    let candidate = db
        .replace_candidates(&project.id, &drafts(1))
        .expect("replacing candidates")
        .remove(0);

    db.update_clip_for_candidate(
        &candidate.id,
        "rendered",
        Some("/out/clip.mp4"),
        Some("/out/clip.ass"),
        None,
    )
    .expect("updating clip");

    db.update_clip_for_candidate(&candidate.id, "failed", None, None, Some("ffmpeg died"))
        .expect("updating clip status");

    let detail = db.project_detail(&project.id).expect("loading detail");
    let clip = &detail.clips[0];
    assert_eq!(clip.status, "failed");
    assert_eq!(clip.output_path.as_deref(), Some("/out/clip.mp4"));
    assert_eq!(clip.caption_ass_path.as_deref(), Some("/out/clip.ass"));
    assert_eq!(clip.render_log.as_deref(), Some("ffmpeg died"));
}

#[test]
fn reopening_the_database_resets_interrupted_cutting_clips() {
    let dir = TempDir::new("reopen");
    let project_id;
    let candidate_id;

    {
        let db = open_db(&dir);
        let project = db
            .create_project("/media/input.mp4", "local", "modern-box", None)
            .expect("creating project");
        let candidate = db
            .replace_candidates(&project.id, &drafts(1))
            .expect("replacing candidates")
            .remove(0);

        db.update_clip_for_candidate(&candidate.id, "cutting", None, None, None)
            .expect("marking clip as cutting");

        project_id = project.id;
        candidate_id = candidate.id;
    }

    let db = open_db(&dir);
    let detail = db.project_detail(&project_id).expect("loading detail");
    assert_eq!(detail.clips.len(), 1);
    assert_eq!(detail.clips[0].candidate_id, candidate_id);
    assert_eq!(detail.clips[0].status, "pending");
}

#[test]
fn get_candidate_with_project_joins_both_rows() {
    let dir = TempDir::new("join");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", Some(90.0))
        .expect("creating project");
    let candidate = db
        .replace_candidates(&project.id, &drafts(1))
        .expect("replacing candidates")
        .remove(0);

    let (loaded_candidate, loaded_project) = db
        .get_candidate_with_project(&candidate.id)
        .expect("loading candidate with project");
    assert_eq!(loaded_candidate.id, candidate.id);
    assert_eq!(loaded_project.id, project.id);
    assert_eq!(loaded_project.source_duration, Some(90.0));
}

#[test]
fn rename_and_status_updates_are_persisted() {
    let dir = TempDir::new("updates");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");

    db.rename_project(&project.id, "My Episode")
        .expect("renaming project");
    db.update_project_status(&project.id, "transcribing", Some(300.5))
        .expect("updating status");

    let loaded = db.get_project(&project.id).expect("loading project");
    assert_eq!(loaded.name.as_deref(), Some("My Episode"));
    assert_eq!(loaded.status, "transcribing");
    assert_eq!(loaded.source_duration, Some(300.5));

    db.update_project_status(&project.id, "ready", None)
        .expect("updating status without duration");
    let loaded = db.get_project(&project.id).expect("loading project");
    assert_eq!(loaded.status, "ready");
    assert_eq!(loaded.source_duration, Some(300.5));
}

#[test]
fn delete_project_cascades_candidates_clips_and_transcripts() {
    let dir = TempDir::new("delete");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");
    db.save_transcript(&project.id, "whisper", "{}", None)
        .expect("saving transcript");
    db.replace_candidates(&project.id, &drafts(3))
        .expect("replacing candidates");

    db.delete_project(&project.id).expect("deleting project");

    assert!(db.get_project(&project.id).is_err());
    assert!(db.list_projects().unwrap().is_empty());
    assert!(db.latest_transcript(&project.id).unwrap().is_none());
    assert!(db.list_candidates(&project.id).unwrap().is_empty());

    let path = dir.db_path();
    assert_eq!(table_count(&path, "projects"), 0);
    assert_eq!(table_count(&path, "transcripts"), 0);
    assert_eq!(table_count(&path, "candidates"), 0);
    assert_eq!(table_count(&path, "clips"), 0);
}

#[test]
fn opening_the_same_database_twice_reuses_the_schema() {
    let dir = TempDir::new("schema");
    let project_id = {
        let db = open_db(&dir);
        db.create_project("/media/input.mp4", "local", "modern-box", None)
            .expect("creating project")
            .id
    };

    let db = open_db(&dir);
    let projects = db.list_projects().expect("listing projects");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id, project_id);
}

#[test]
fn clip_edits_round_trip_with_captions() {
    let dir = TempDir::new("clip-edits");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");
    let candidate = db
        .replace_candidates(&project.id, &drafts(2))
        .expect("replacing candidates")
        .remove(0);

    assert!(db.clip_edit(&candidate.id).expect("loading edit").is_none());

    let edit = ClipEdit {
        candidate_id: candidate.id.clone(),
        aspect_ratio: "16:9".to_string(),
        crop_x: 0.25,
        crop_y: 0.75,
        captions: vec![
            CaptionCue {
                start: 1.5,
                end: 2.5,
                text: "hello there".to_string(),
            },
            CaptionCue {
                start: 3.0,
                end: 4.0,
                text: "second line".to_string(),
            },
        ],
        caption_style: Some("classic-outline".to_string()),
        caption_override: None,
        auto_edit: None,
    };

    let stored = db.save_clip_edit(&edit).expect("saving edit");
    assert_eq!(stored, edit);

    let loaded = db
        .clip_edit(&candidate.id)
        .expect("loading edit")
        .expect("edit should exist");
    assert_eq!(loaded, edit);
    assert_eq!(loaded.captions.len(), 2);
    assert_eq!(loaded.captions[0].text, "hello there");
    assert_eq!(loaded.caption_style.as_deref(), Some("classic-outline"));

    let detail = db.project_detail(&project.id).expect("loading detail");
    assert_eq!(detail.clip_edits.len(), 1);
    assert_eq!(detail.clip_edits[0], edit);

    // Upsert replaces the same row instead of adding a second one.
    let mut updated = edit.clone();
    updated.aspect_ratio = "1:1".to_string();
    updated.captions.clear();
    db.save_clip_edit(&updated).expect("updating edit");
    assert_eq!(table_count(&dir.db_path(), "clip_edits"), 1);

    let loaded = db
        .clip_edit(&candidate.id)
        .expect("loading edit")
        .expect("edit should exist");
    assert_eq!(loaded.aspect_ratio, "1:1");
    assert!(loaded.captions.is_empty());
}

#[test]
fn save_clip_edit_sanitizes_out_of_range_values() {
    let dir = TempDir::new("clip-edits-sanitize");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");
    let candidate = db
        .replace_candidates(&project.id, &drafts(1))
        .expect("replacing candidates")
        .remove(0);

    let stored = db
        .save_clip_edit(&ClipEdit {
            candidate_id: candidate.id.clone(),
            aspect_ratio: "square".to_string(),
            crop_x: -5.0,
            crop_y: 42.0,
            captions: vec![CaptionCue {
                start: 2.0,
                end: 2.0,
                text: "dropped".to_string(),
            }],
            caption_style: Some("   ".to_string()),
            caption_override: None,
            auto_edit: None,
        })
        .expect("saving edit");

    assert_eq!(stored.aspect_ratio, "1:1");
    assert_eq!(stored.crop_x, 0.0);
    assert_eq!(stored.crop_y, 1.0);
    assert!(stored.captions.is_empty());
    assert!(stored.caption_style.is_none());
}

#[test]
fn caption_override_round_trips_and_sanitizes() {
    let dir = TempDir::new("clip-edits-caption-override");
    let db = open_db(&dir);

    let project = db
        .create_project("/media/input.mp4", "local", "modern-box", None)
        .expect("creating project");
    let candidate = db
        .replace_candidates(&project.id, &drafts(1))
        .expect("replacing candidates")
        .remove(0);

    let edit = ClipEdit {
        candidate_id: candidate.id.clone(),
        aspect_ratio: "9:16".to_string(),
        crop_x: 0.5,
        crop_y: 0.5,
        captions: Vec::new(),
        caption_style: Some("modern-box".to_string()),
        caption_override: Some(CaptionStyleOverride {
            font_family: Some("Inter".to_string()),
            font_size: Some(140.0),
            text_color: Some("#FFCC00".to_string()),
            outline_color: Some("#000000".to_string()),
            box_color: Some("#112233".to_string()),
            border_style: Some(1),
            outline: Some(3.0),
            bold: Some(true),
            uppercase: Some(false),
            position: Some(0.25),
            max_width: Some(0.8),
        }),
        auto_edit: None,
    };

    let stored = db.save_clip_edit(&edit).expect("saving edit");
    assert_eq!(stored, edit);

    let loaded = db
        .clip_edit(&candidate.id)
        .expect("loading edit")
        .expect("edit should exist");
    assert_eq!(loaded.caption_override, edit.caption_override);

    // Out-of-range values are clamped instead of rejected.
    let clamped = db
        .save_clip_edit(&ClipEdit {
            caption_override: Some(CaptionStyleOverride {
                font_size: Some(900.0),
                text_color: Some("not-a-colour".to_string()),
                position: Some(-2.0),
                max_width: Some(5.0),
                border_style: Some(7),
                ..Default::default()
            }),
            ..edit
        })
        .expect("saving clamped edit");

    let over = clamped.caption_override.expect("override kept");
    assert_eq!(over.font_size, Some(200.0));
    assert_eq!(over.text_color, None);
    assert_eq!(over.position, Some(0.0));
    assert_eq!(over.max_width, Some(1.0));
    assert_eq!(over.border_style, Some(1));
}
