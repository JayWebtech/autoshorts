use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::models::{
    Candidate, CandidateDraft, Clip, ClipCopy, ClipEdit, Project, ProjectDetail, Transcript,
};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path).context("opening SQLite database")?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT,
                source_path TEXT NOT NULL,
                source_duration REAL,
                status TEXT NOT NULL,
                transcription_mode TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transcripts (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                engine TEXT NOT NULL,
                raw_json TEXT NOT NULL,
                language TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS candidates (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                start_sec REAL NOT NULL,
                end_sec REAL NOT NULL,
                score REAL NOT NULL,
                hook TEXT NOT NULL,
                rationale TEXT NOT NULL,
                rank INTEGER NOT NULL,
                selected INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS clips (
                id TEXT PRIMARY KEY,
                candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                output_path TEXT,
                face_track_json TEXT,
                caption_ass_path TEXT,
                render_log TEXT
            );

            CREATE TABLE IF NOT EXISTS clip_copy (
                id TEXT PRIMARY KEY,
                clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                hook_text TEXT,
                caption_text TEXT,
                hashtags TEXT
            );

            CREATE TABLE IF NOT EXISTS schedule_entries (
                id TEXT PRIMARY KEY,
                clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                scheduled_for TEXT,
                status TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS clip_edits (
                candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
                aspect_ratio TEXT NOT NULL,
                crop_x REAL NOT NULL,
                crop_y REAL NOT NULL,
                captions_json TEXT NOT NULL,
                caption_style TEXT,
                updated_at TEXT NOT NULL
            );
            ",
        )?;
        let _ = conn.execute("ALTER TABLE projects ADD COLUMN name TEXT", []);
        let _ = conn.execute("ALTER TABLE projects ADD COLUMN caption_style TEXT", []);
        // Fine-grained caption look (colour, font, position) edited per clip.
        let _ = conn.execute("ALTER TABLE clip_edits ADD COLUMN caption_override_json TEXT", []);
        // Automatic tight-cut settings (silence removal + pacing).
        let _ = conn.execute("ALTER TABLE clip_edits ADD COLUMN auto_edit_json TEXT", []);
        // No ffmpeg process survives an app restart, so any clip still marked
        // `cutting` was interrupted. Reset it instead of showing a render that
        // can never finish.
        let _ = conn.execute("UPDATE clips SET status = 'pending' WHERE status = 'cutting'", []);
        Ok(())
    }

    pub fn create_project(
        &self,
        source_path: &str,
        transcription_mode: &str,
        caption_style: &str,
        source_duration: Option<f64>,
    ) -> Result<Project> {
        let now = Utc::now().to_rfc3339();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            name: None,
            source_path: source_path.to_string(),
            source_duration,
            status: "ingest".to_string(),
            transcription_mode: transcription_mode.to_string(),
            caption_style: Some(caption_style.to_string()),
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "INSERT INTO projects (id, name, source_path, source_duration, status, transcription_mode, caption_style, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                project.id,
                project.name,
                project.source_path,
                project.source_duration,
                project.status,
                project.transcription_mode,
                project.caption_style,
                project.created_at,
                project.updated_at
            ],
        )?;

        Ok(project)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, source_path, source_duration, status, transcription_mode, created_at, updated_at, caption_style
             FROM projects ORDER BY updated_at DESC",
        )?;

        let rows = stmt.query_map([], project_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get_project(&self, project_id: &str) -> Result<Project> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT id, name, source_path, source_duration, status, transcription_mode, created_at, updated_at, caption_style
             FROM projects WHERE id = ?1",
            params![project_id],
            project_from_row,
        )
        .map_err(Into::into)
    }

    pub fn project_detail(&self, project_id: &str) -> Result<ProjectDetail> {
        let project = self.get_project(project_id)?;
        let transcript = self.latest_transcript(project_id)?;
        let candidates = self.list_candidates(project_id)?;
        let clips = self.list_clips_for_project(project_id)?;
        let copy = self.list_copy_for_project(project_id)?;
        let clip_edits = self.list_clip_edits(project_id)?;

        Ok(ProjectDetail {
            project,
            transcript,
            candidates,
            clips,
            copy,
            clip_edits,
        })
    }

    pub fn update_project_status(
        &self,
        project_id: &str,
        status: &str,
        source_duration: Option<f64>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "UPDATE projects SET status = ?1, source_duration = COALESCE(?2, source_duration), updated_at = ?3 WHERE id = ?4",
            params![status, source_duration, now, project_id],
        )?;
        Ok(())
    }

    pub fn save_transcript(
        &self,
        project_id: &str,
        engine: &str,
        raw_json: &str,
        language: Option<&str>,
    ) -> Result<Transcript> {
        let transcript = Transcript {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            engine: engine.to_string(),
            raw_json: raw_json.to_string(),
            language: language.map(ToOwned::to_owned),
            created_at: Utc::now().to_rfc3339(),
        };

        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "DELETE FROM transcripts WHERE project_id = ?1",
            params![project_id],
        )?;
        conn.execute(
            "INSERT INTO transcripts (id, project_id, engine, raw_json, language, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                transcript.id,
                transcript.project_id,
                transcript.engine,
                transcript.raw_json,
                transcript.language,
                transcript.created_at
            ],
        )?;
        Ok(transcript)
    }

    pub fn latest_transcript(&self, project_id: &str) -> Result<Option<Transcript>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT id, project_id, engine, raw_json, language, created_at
             FROM transcripts WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![project_id],
            |row| {
                Ok(Transcript {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    engine: row.get(2)?,
                    raw_json: row.get(3)?,
                    language: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn replace_candidates(
        &self,
        project_id: &str,
        drafts: &[CandidateDraft],
    ) -> Result<Vec<Candidate>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "DELETE FROM candidates WHERE project_id = ?1",
            params![project_id],
        )?;

        let selected_cutoff = drafts.len().min(6).max(3).min(drafts.len());
        let mut candidates = Vec::with_capacity(drafts.len());

        for (index, draft) in drafts.iter().enumerate() {
            let candidate = Candidate {
                id: Uuid::new_v4().to_string(),
                project_id: project_id.to_string(),
                start_sec: draft.start,
                end_sec: draft.end,
                score: draft.score,
                hook: draft.hook.clone(),
                rationale: draft.rationale.clone(),
                rank: (index + 1) as i64,
                selected: index < selected_cutoff,
            };

            conn.execute(
                "INSERT INTO candidates (id, project_id, start_sec, end_sec, score, hook, rationale, rank, selected)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    &candidate.id,
                    &candidate.project_id,
                    candidate.start_sec,
                    candidate.end_sec,
                    candidate.score,
                    &candidate.hook,
                    &candidate.rationale,
                    candidate.rank,
                    if candidate.selected { 1 } else { 0 }
                ],
            )?;

            conn.execute(
                "INSERT INTO clips (id, candidate_id, status) VALUES (?1, ?2, 'pending')",
                params![Uuid::new_v4().to_string(), &candidate.id],
            )?;

            candidates.push(candidate);
        }

        Ok(candidates)
    }

    pub fn list_candidates(&self, project_id: &str) -> Result<Vec<Candidate>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, project_id, start_sec, end_sec, score, hook, rationale, rank, selected
             FROM candidates WHERE project_id = ?1 ORDER BY rank ASC",
        )?;
        let rows = stmt.query_map(params![project_id], candidate_from_row)?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    pub fn get_candidate_with_project(&self, candidate_id: &str) -> Result<(Candidate, Project)> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.query_row(
            "SELECT
                candidates.id, candidates.project_id, candidates.start_sec, candidates.end_sec,
                candidates.score, candidates.hook, candidates.rationale, candidates.rank, candidates.selected,
                projects.id, projects.name, projects.source_path, projects.source_duration, projects.status,
                projects.transcription_mode, projects.created_at, projects.updated_at, projects.caption_style
             FROM candidates
             INNER JOIN projects ON projects.id = candidates.project_id
             WHERE candidates.id = ?1",
            params![candidate_id],
            |row| {
                let selected: i64 = row.get(8)?;
                let candidate = Candidate {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    start_sec: row.get(2)?,
                    end_sec: row.get(3)?,
                    score: row.get(4)?,
                    hook: row.get(5)?,
                    rationale: row.get(6)?,
                    rank: row.get(7)?,
                    selected: selected == 1,
                };
                let project = Project {
                    id: row.get(9)?,
                    name: row.get(10)?,
                    source_path: row.get(11)?,
                    source_duration: row.get(12)?,
                    status: row.get(13)?,
                    transcription_mode: row.get(14)?,
                    created_at: row.get(15)?,
                    updated_at: row.get(16)?,
                    caption_style: row.get(17)?,
                };
                Ok((candidate, project))
            },
        )
        .map_err(Into::into)
    }

    pub fn update_clip_for_candidate(
        &self,
        candidate_id: &str,
        status: &str,
        output_path: Option<&str>,
        caption_ass_path: Option<&str>,
        render_log: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "UPDATE clips
             SET status = ?1,
                 output_path = COALESCE(?2, output_path),
                 caption_ass_path = COALESCE(?3, caption_ass_path),
                 render_log = COALESCE(?4, render_log)
             WHERE candidate_id = ?5",
            params![status, output_path, caption_ass_path, render_log, candidate_id],
        )?;
        Ok(())
    }

    pub fn set_selected_clip_count(
        &self,
        project_id: &str,
        count: usize,
    ) -> Result<Vec<Candidate>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "UPDATE candidates SET selected = CASE WHEN rank <= ?1 THEN 1 ELSE 0 END WHERE project_id = ?2",
            params![count as i64, project_id],
        )?;
        drop(conn);
        self.list_candidates(project_id)
    }

    /// Move a candidate's clip window, keeping its rank/score untouched.
    ///
    /// The editor lets the user stretch a moment when the transcript cut lands
    /// mid-sentence; only the two timestamps change here.
    pub fn update_candidate_range(
        &self,
        candidate_id: &str,
        start_sec: f64,
        end_sec: f64,
    ) -> Result<Candidate> {
        let start = if start_sec.is_finite() {
            start_sec.max(0.0)
        } else {
            0.0
        };
        let end = if end_sec.is_finite() { end_sec } else { start };
        let end = end.max(start + 0.1);
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "UPDATE candidates SET start_sec = ?1, end_sec = ?2 WHERE id = ?3",
            params![start, end, candidate_id],
        )?;
        let candidate = conn.query_row(
            "SELECT id, project_id, start_sec, end_sec, score, hook, rationale, rank, selected
             FROM candidates WHERE id = ?1",
            params![candidate_id],
            candidate_from_row,
        )?;
        Ok(candidate)
    }

    fn list_clips_for_project(&self, project_id: &str) -> Result<Vec<Clip>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT clips.id, clips.candidate_id, clips.status, clips.output_path, clips.face_track_json, clips.caption_ass_path, clips.render_log
             FROM clips
             INNER JOIN candidates ON candidates.id = clips.candidate_id
             WHERE candidates.project_id = ?1
             ORDER BY candidates.rank ASC",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(Clip {
                id: row.get(0)?,
                candidate_id: row.get(1)?,
                status: row.get(2)?,
                output_path: row.get(3)?,
                face_track_json: row.get(4)?,
                caption_ass_path: row.get(5)?,
                render_log: row.get(6)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    fn list_copy_for_project(&self, project_id: &str) -> Result<Vec<ClipCopy>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT clip_copy.id, clip_copy.clip_id, clip_copy.platform, clip_copy.hook_text, clip_copy.caption_text, clip_copy.hashtags
             FROM clip_copy
             INNER JOIN clips ON clips.id = clip_copy.clip_id
             INNER JOIN candidates ON candidates.id = clips.candidate_id
             WHERE candidates.project_id = ?1",
        )?;
        let rows = stmt.query_map(params![project_id], |row| {
            Ok(ClipCopy {
                id: row.get(0)?,
                clip_id: row.get(1)?,
                platform: row.get(2)?,
                hook_text: row.get(3)?,
                caption_text: row.get(4)?,
                hashtags: row.get(5)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(Into::into)
    }

    /// Saved clip edit for a candidate, if the user ever changed its framing.
    pub fn clip_edit(&self, candidate_id: &str) -> Result<Option<ClipEdit>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let edit = conn
            .query_row(
                "SELECT candidate_id, aspect_ratio, crop_x, crop_y, captions_json, caption_style,
                        caption_override_json, auto_edit_json
                 FROM clip_edits WHERE candidate_id = ?1",
                params![candidate_id],
                clip_edit_from_row,
            )
            .optional()?;
        Ok(edit.map(ClipEdit::sanitized))
    }

    /// Upsert the edit for its own `candidate_id`, storing the sanitized value.
    pub fn save_clip_edit(&self, edit: &ClipEdit) -> Result<ClipEdit> {
        let stored = edit.clone().sanitized();
        let captions_json = serde_json::to_string(&stored.captions)?;
        let override_json = match stored.caption_override.as_ref() {
            Some(value) => Some(serde_json::to_string(value)?),
            None => None,
        };
        let auto_edit_json = match stored.auto_edit.as_ref() {
            Some(value) => Some(serde_json::to_string(value)?),
            None => None,
        };
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute(
            "INSERT INTO clip_edits
                (candidate_id, aspect_ratio, crop_x, crop_y, captions_json, caption_style,
                 caption_override_json, auto_edit_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(candidate_id) DO UPDATE SET
                aspect_ratio = excluded.aspect_ratio,
                crop_x = excluded.crop_x,
                crop_y = excluded.crop_y,
                captions_json = excluded.captions_json,
                caption_style = excluded.caption_style,
                caption_override_json = excluded.caption_override_json,
                auto_edit_json = excluded.auto_edit_json,
                updated_at = excluded.updated_at",
            params![
                stored.candidate_id,
                stored.aspect_ratio,
                stored.crop_x,
                stored.crop_y,
                captions_json,
                stored.caption_style,
                override_json,
                auto_edit_json,
                now
            ],
        )?;
        Ok(stored)
    }

    /// Every saved edit belonging to a project, ordered like the candidates.
    pub fn list_clip_edits(&self, project_id: &str) -> Result<Vec<ClipEdit>> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT clip_edits.candidate_id, clip_edits.aspect_ratio, clip_edits.crop_x,
                    clip_edits.crop_y, clip_edits.captions_json, clip_edits.caption_style,
                    clip_edits.caption_override_json, clip_edits.auto_edit_json
             FROM clip_edits
             INNER JOIN candidates ON candidates.id = clip_edits.candidate_id
             WHERE candidates.project_id = ?1
             ORDER BY candidates.rank ASC",
        )?;
        let rows = stmt.query_map(params![project_id], clip_edit_from_row)?;
        let edits = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(edits.into_iter().map(ClipEdit::sanitized).collect())
    }

    pub fn delete_project(&self, project_id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])?;
        Ok(())
    }

    pub fn rename_project(&self, project_id: &str, name: &str) -> Result<()> {
        let conn = self.conn.lock().expect("database mutex poisoned");
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, project_id],
        )?;
        Ok(())
    }
}

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        source_path: row.get(2)?,
        source_duration: row.get(3)?,
        status: row.get(4)?,
        transcription_mode: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        caption_style: row.get(8)?,
    })
}

fn clip_edit_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipEdit> {
    let captions_json: String = row.get(4)?;
    let override_json: Option<String> = row.get(6)?;
    let auto_edit_json: Option<String> = row.get(7)?;
    Ok(ClipEdit {
        candidate_id: row.get(0)?,
        aspect_ratio: row.get(1)?,
        crop_x: row.get(2)?,
        crop_y: row.get(3)?,
        captions: serde_json::from_str(&captions_json).unwrap_or_default(),
        caption_style: row.get(5)?,
        caption_override: override_json.and_then(|json| serde_json::from_str(&json).ok()),
        auto_edit: auto_edit_json.and_then(|json| serde_json::from_str(&json).ok()),
    })
}

fn candidate_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Candidate> {
    let selected: i64 = row.get(8)?;
    Ok(Candidate {
        id: row.get(0)?,
        project_id: row.get(1)?,
        start_sec: row.get(2)?,
        end_sec: row.get(3)?,
        score: row.get(4)?,
        hook: row.get(5)?,
        rationale: row.get(6)?,
        rank: row.get(7)?,
        selected: selected == 1,
    })
}
