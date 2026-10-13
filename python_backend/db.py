import os
import json
from pathlib import Path
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.migrate()

    def get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    def migrate(self):
        with self.get_conn() as conn:
            conn.executescript("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT,
                source_path TEXT NOT NULL,
                source_duration REAL,
                status TEXT NOT NULL,
                transcription_mode TEXT NOT NULL,
                caption_style TEXT,
                project_dir TEXT,
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
                description TEXT,
                rank INTEGER NOT NULL,
                selected INTEGER NOT NULL DEFAULT 0,
                dismissed INTEGER NOT NULL DEFAULT 0
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

            CREATE TABLE IF NOT EXISTS autoedits (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                output_path TEXT NOT NULL,
                format_mode TEXT NOT NULL,
                target_duration_sec REAL NOT NULL,
                actual_duration_sec REAL,
                chapters_text TEXT,
                title TEXT,
                description TEXT,
                hashtags TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schedule_entries (
                id TEXT PRIMARY KEY,
                clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                scheduled_for TEXT,
                status TEXT NOT NULL
            );
            """)

            try:
                conn.execute("ALTER TABLE candidates ADD COLUMN description TEXT;")
            except Exception:
                pass

            try:
                conn.execute("ALTER TABLE candidates ADD COLUMN hook_title TEXT;")
            except Exception:
                pass

            try:
                conn.execute("ALTER TABLE candidates ADD COLUMN virality_json TEXT;")
            except Exception:
                pass

            try:
                conn.execute("ALTER TABLE candidates ADD COLUMN dismissed INTEGER DEFAULT 0;")
            except Exception:
                pass

            try:
                conn.execute("ALTER TABLE projects ADD COLUMN project_dir TEXT;")
            except Exception:
                pass

            try:
                conn.execute("ALTER TABLE projects ADD COLUMN workflow_goal TEXT DEFAULT 'clips';")
            except Exception:
                pass

            try:
                rows = conn.execute("SELECT id, source_path, name FROM projects WHERE name IS NULL OR name = ''").fetchall()
                for r in rows:
                    stem = Path(r["source_path"]).stem
                    conn.execute("UPDATE projects SET name = ? WHERE id = ?", (stem, r["id"]))
            except Exception:
                pass

    def create_project(self, source_path: str, transcription_mode: str = "local", caption_style: str = "modern-box", source_duration: Optional[float] = None, project_dir: Optional[str] = None, workflow_goal: str = "clips") -> Dict[str, Any]:
        proj_id = str(uuid.uuid4())
        name = Path(source_path).stem
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute(
                """INSERT INTO projects (id, name, source_path, source_duration, status, transcription_mode, caption_style, project_dir, workflow_goal, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (proj_id, name, source_path, source_duration, "ingest", transcription_mode, caption_style, project_dir, workflow_goal, now, now)
            )
        return self.get_project(proj_id)

    def list_projects(self) -> List[Dict[str, Any]]:
        with self.get_conn() as conn:
            rows = conn.execute(
                "SELECT id, name, source_path, source_duration, status, transcription_mode, created_at, updated_at, caption_style, project_dir, workflow_goal FROM projects ORDER BY updated_at DESC"
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "name": r["name"],
                    "sourcePath": r["source_path"],
                    "sourceDuration": r["source_duration"],
                    "status": r["status"],
                    "transcriptionMode": r["transcription_mode"],
                    "captionStyle": r["caption_style"],
                    "projectDir": r["project_dir"],
                    "workflowGoal": r["workflow_goal"] or "clips",
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                }
                for r in rows
            ]

    def get_project(self, project_id: str) -> Dict[str, Any]:
        with self.get_conn() as conn:
            r = conn.execute(
                "SELECT id, name, source_path, source_duration, status, transcription_mode, created_at, updated_at, caption_style, project_dir, workflow_goal FROM projects WHERE id = ?",
                (project_id,)
            ).fetchone()
            if not r:
                raise ValueError(f"Project not found: {project_id}")
            return {
                "id": r["id"],
                "name": r["name"],
                "sourcePath": r["source_path"],
                "sourceDuration": r["source_duration"],
                "status": r["status"],
                "transcriptionMode": r["transcription_mode"],
                "captionStyle": r["caption_style"],
                "projectDir": r["project_dir"],
                "workflowGoal": r["workflow_goal"] or "clips",
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            }

    def update_project_workflow_goal(self, project_id: str, workflow_goal: str) -> Dict[str, Any]:
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute("UPDATE projects SET workflow_goal = ?, updated_at = ? WHERE id = ?", (workflow_goal, now, project_id))
        return self.get_project(project_id)

    def update_project_dir(self, project_id: str, project_dir: str) -> Dict[str, Any]:
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute("UPDATE projects SET project_dir = ?, updated_at = ? WHERE id = ?", (project_dir, now, project_id))
        return self.get_project(project_id)

    def update_project_status(self, project_id: str, status: str, duration: Optional[float] = None):
        now = utc_now_iso()
        with self.get_conn() as conn:
            if duration is not None:
                conn.execute(
                    "UPDATE projects SET status = ?, source_duration = ?, updated_at = ? WHERE id = ?",
                    (status, duration, now, project_id)
                )
            else:
                conn.execute(
                    "UPDATE projects SET status = ?, updated_at = ? WHERE id = ?",
                    (status, now, project_id)
                )

    def rename_project(self, project_id: str, name: str) -> Dict[str, Any]:
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?", (name, now, project_id))
        return self.get_project(project_id)

    def delete_project(self, project_id: str):
        with self.get_conn() as conn:
            conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    def relink_project(self, project_id: str, new_source_path: str, new_duration: Optional[float] = None) -> Dict[str, Any]:
        now = utc_now_iso()
        with self.get_conn() as conn:
            if new_duration is not None:
                conn.execute(
                    "UPDATE projects SET source_path = ?, source_duration = ?, updated_at = ? WHERE id = ?",
                    (new_source_path, new_duration, now, project_id)
                )
            else:
                conn.execute(
                    "UPDATE projects SET source_path = ?, updated_at = ? WHERE id = ?",
                    (new_source_path, now, project_id)
                )
        return self.get_project(project_id)

    def save_transcript(self, project_id: str, engine: str, raw_json: str, language: Optional[str] = "es") -> Dict[str, Any]:
        t_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute(
                "INSERT INTO transcripts (id, project_id, engine, raw_json, language, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (t_id, project_id, engine, raw_json, language, now)
            )
            conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
        return {
            "id": t_id,
            "projectId": project_id,
            "engine": engine,
            "rawJson": raw_json,
            "language": language,
            "createdAt": now,
        }

    def latest_transcript(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self.get_conn() as conn:
            r = conn.execute(
                "SELECT id, project_id, engine, raw_json, language, created_at FROM transcripts WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
                (project_id,)
            ).fetchone()
            if not r:
                return None
            return {
                "id": r["id"],
                "projectId": r["project_id"],
                "engine": r["engine"],
                "rawJson": r["raw_json"],
                "language": r["language"],
                "createdAt": r["created_at"],
            }

    def replace_candidates(self, project_id: str, drafts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        now = utc_now_iso()
        candidates = []
        with self.get_conn() as conn:
            conn.execute("DELETE FROM candidates WHERE project_id = ?", (project_id,))
            for idx, draft in enumerate(drafts, start=1):
                c_id = str(uuid.uuid4())
                clip_id = str(uuid.uuid4())
                selected = 1 if idx <= 3 else 0
                desc = draft.get("description") or ""
                hook_title = draft.get("hook_title") or draft.get("hookTitle") or ""
                
                # Process or infer virality breakdown
                virality = draft.get("virality")
                if not isinstance(virality, dict):
                    score_val = float(draft.get("score", 0.85))
                    total_score = max(50, min(99, int(round(score_val * 100 if score_val <= 1.0 else score_val))))
                    hook_txt = draft.get("hook", "")
                    hook_type = "pregunta" if "?" in hook_txt else "reacción" if "!" in hook_txt else "destacado"
                    virality = {
                        "hook_score": max(12, min(25, int(round((total_score / 100.0) * 25)))),
                        "engagement_score": max(12, min(25, int(round((total_score / 100.0) * 24)))),
                        "value_score": max(10, min(25, int(round((total_score / 100.0) * 22)))),
                        "shareability_score": max(12, min(25, int(round((total_score / 100.0) * 24)))),
                        "total_score": total_score,
                        "hook_type": hook_type
                    }
                virality_json = json.dumps(virality, ensure_ascii=False)

                conn.execute(
                    """INSERT INTO candidates (id, project_id, start_sec, end_sec, score, hook, rationale, description, rank, selected, hook_title, virality_json, dismissed)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
                    (c_id, project_id, draft["start"], draft["end"], draft["score"], draft["hook"], draft["rationale"], desc, idx, selected, hook_title, virality_json)
                )
                conn.execute(
                    """INSERT INTO clips (id, candidate_id, status) VALUES (?, ?, ?)""",
                    (clip_id, c_id, "draft")
                )
                candidates.append({
                    "id": c_id,
                    "projectId": project_id,
                    "startSec": draft["start"],
                    "endSec": draft["end"],
                    "score": draft["score"],
                    "hook": draft["hook"],
                    "rationale": draft["rationale"],
                    "description": desc,
                    "hookTitle": hook_title,
                    "virality": virality,
                    "rank": idx,
                    "selected": bool(selected),
                    "dismissed": False,
                })
            conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
        return candidates

    def set_selected_clip_count(self, project_id: str, count: int) -> List[Dict[str, Any]]:
        count = max(0, min(count, 500))
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute("UPDATE candidates SET selected = 0 WHERE project_id = ?", (project_id,))
            if count > 0:
                conn.execute(
                    f"UPDATE candidates SET selected = 1 WHERE id IN (SELECT id FROM candidates WHERE project_id = ? ORDER BY rank ASC LIMIT {count})",
                    (project_id,)
                )
            conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
        return self.get_candidates(project_id)

    def get_candidates(self, project_id: str) -> List[Dict[str, Any]]:
        with self.get_conn() as conn:
            rows = conn.execute(
                "SELECT id, project_id, start_sec, end_sec, score, hook, rationale, description, rank, selected, hook_title, virality_json, dismissed FROM candidates WHERE project_id = ? ORDER BY rank ASC",
                (project_id,)
            ).fetchall()
            result = []
            for r in rows:
                v_obj = None
                raw_v = r["virality_json"] if "virality_json" in r.keys() else None
                if raw_v:
                    try:
                        v_obj = json.loads(raw_v)
                    except Exception:
                        pass
                if not v_obj:
                    score_val = float(r["score"] or 0.85)
                    total_score = max(50, min(99, int(round(score_val * 100 if score_val <= 1.0 else score_val))))
                    hook_txt = r["hook"] or ""
                    hook_type = "pregunta" if "?" in hook_txt else "reacción" if "!" in hook_txt else "destacado"
                    v_obj = {
                        "hook_score": max(12, min(25, int(round((total_score / 100.0) * 25)))),
                        "engagement_score": max(12, min(25, int(round((total_score / 100.0) * 24)))),
                        "value_score": max(10, min(25, int(round((total_score / 100.0) * 22)))),
                        "shareability_score": max(12, min(25, int(round((total_score / 100.0) * 24)))),
                        "total_score": total_score,
                        "hook_type": hook_type
                    }
                result.append({
                    "id": r["id"],
                    "projectId": r["project_id"],
                    "startSec": r["start_sec"],
                    "endSec": r["end_sec"],
                    "score": r["score"],
                    "hook": r["hook"],
                    "rationale": r["rationale"],
                    "description": r["description"] or "",
                    "hookTitle": (r["hook_title"] if "hook_title" in r.keys() else "") or "",
                    "virality": v_obj,
                    "rank": r["rank"],
                    "selected": bool(r["selected"]),
                    "dismissed": bool(r["dismissed"] if "dismissed" in r.keys() else 0),
                })
            return result

    def update_candidate_description(self, candidate_id: str, description: str):
        with self.get_conn() as conn:
            conn.execute(
                "UPDATE candidates SET description = ? WHERE id = ?",
                (description, candidate_id)
            )

    def update_candidate_trim(self, candidate_id: str, start_sec: float, end_sec: float) -> Dict[str, Any]:
        start_sec = max(0.0, float(start_sec))
        end_sec = max(start_sec + 0.5, float(end_sec))
        with self.get_conn() as conn:
            conn.execute(
                "UPDATE candidates SET start_sec = ?, end_sec = ? WHERE id = ?",
                (start_sec, end_sec, candidate_id)
            )
            # Invalidate any previously cut clip for this candidate so it can be re-cut with new timings
            conn.execute(
                "UPDATE clips SET status = 'pending', output_path = NULL, caption_ass_path = NULL WHERE candidate_id = ?",
                (candidate_id,)
            )
            r = conn.execute(
                "SELECT id, project_id, start_sec, end_sec, score, hook, rationale, description, rank, selected, dismissed FROM candidates WHERE id = ?",
                (candidate_id,)
            ).fetchone()
            if not r:
                raise ValueError(f"Candidate {candidate_id} not found")
            return {
                "id": r["id"],
                "projectId": r["project_id"],
                "startSec": r["start_sec"],
                "endSec": r["end_sec"],
                "score": r["score"],
                "hook": r["hook"],
                "rationale": r["rationale"],
                "description": r["description"] or "",
                "rank": r["rank"],
                "selected": bool(r["selected"]),
                "dismissed": bool(r["dismissed"] if "dismissed" in r.keys() else 0),
            }

    def toggle_candidate_dismissed(self, candidate_id: str, dismissed: bool) -> bool:
        with self.get_conn() as conn:
            conn.execute(
                "UPDATE candidates SET dismissed = ? WHERE id = ?",
                (1 if dismissed else 0, candidate_id)
            )
        return True

    def get_clips(self, project_id: str) -> List[Dict[str, Any]]:
        with self.get_conn() as conn:
            rows = conn.execute(
                """SELECT clips.id, clips.candidate_id, clips.status, clips.output_path, clips.caption_ass_path, clips.render_log
                   FROM clips JOIN candidates ON clips.candidate_id = candidates.id
                   WHERE candidates.project_id = ?""",
                (project_id,)
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "candidateId": r["candidate_id"],
                    "status": r["status"],
                    "outputPath": r["output_path"],
                    "captionAssPath": r["caption_ass_path"],
                    "captionPath": r["caption_ass_path"],
                    "renderLog": r["render_log"],
                }
                for r in rows
            ]

    def get_project_detail(self, project_id: str) -> Dict[str, Any]:
        project = self.get_project(project_id)
        transcript = self.latest_transcript(project_id)
        candidates = self.get_candidates(project_id)
        clips = self.get_clips(project_id)
        return {
            "project": project,
            "transcript": transcript,
            "candidates": candidates,
            "clips": clips,
        }

    def get_candidate_with_project(self, candidate_id: str) -> tuple:
        with self.get_conn() as conn:
            c = conn.execute(
                "SELECT id, project_id, start_sec, end_sec, score, hook, rationale, description, rank, selected, dismissed FROM candidates WHERE id = ?",
                (candidate_id,)
            ).fetchone()
            if not c:
                raise ValueError(f"Candidate not found: {candidate_id}")
            candidate = {
                "id": c["id"],
                "projectId": c["project_id"],
                "startSec": c["start_sec"],
                "endSec": c["end_sec"],
                "score": c["score"],
                "hook": c["hook"],
                "rationale": c["rationale"],
                "description": c["description"] or "",
                "rank": c["rank"],
                "selected": bool(c["selected"]),
                "dismissed": bool(c["dismissed"] if "dismissed" in c.keys() else 0),
            }
            project = self.get_project(candidate["projectId"])
            return candidate, project

    def update_clip_for_candidate(self, candidate_id: str, status: str, output_path: Optional[str] = None, caption_path: Optional[str] = None, render_log: Optional[str] = None):
        with self.get_conn() as conn:
            conn.execute(
                """UPDATE clips SET status = ?,
                                    output_path = COALESCE(?, output_path),
                                    caption_ass_path = COALESCE(?, caption_ass_path),
                                    render_log = COALESCE(?, render_log)
                   WHERE candidate_id = ?""",
                (status, output_path, caption_path, render_log, candidate_id)
            )

    def save_autoedit(
        self,
        project_id: str,
        output_path: str,
        format_mode: str,
        target_duration_sec: float,
        actual_duration_sec: Optional[float] = None,
        chapters_text: Optional[str] = None,
        title: Optional[str] = None,
        description: Optional[str] = None,
        hashtags: Optional[str] = None,
        autoedit_id: Optional[str] = None
    ) -> Dict[str, Any]:
        ae_id = autoedit_id or str(uuid.uuid4())
        now = utc_now_iso()
        with self.get_conn() as conn:
            conn.execute(
                """INSERT INTO autoedits (id, project_id, output_path, format_mode, target_duration_sec, actual_duration_sec, chapters_text, title, description, hashtags, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     output_path = excluded.output_path,
                     actual_duration_sec = excluded.actual_duration_sec,
                     chapters_text = excluded.chapters_text,
                     title = COALESCE(excluded.title, autoedits.title),
                     description = COALESCE(excluded.description, autoedits.description),
                     hashtags = COALESCE(excluded.hashtags, autoedits.hashtags)""",
                (ae_id, project_id, output_path, format_mode, target_duration_sec, actual_duration_sec, chapters_text, title, description, hashtags, now)
            )
        return self.get_autoedit(ae_id)

    def get_autoedit(self, autoedit_id: str) -> Optional[Dict[str, Any]]:
        with self.get_conn() as conn:
            r = conn.execute(
                "SELECT id, project_id, output_path, format_mode, target_duration_sec, actual_duration_sec, chapters_text, title, description, hashtags, created_at FROM autoedits WHERE id = ?",
                (autoedit_id,)
            ).fetchone()
            if not r:
                return None
            return {
                "id": r["id"],
                "projectId": r["project_id"],
                "outputPath": r["output_path"],
                "formatMode": r["format_mode"],
                "targetDurationSec": r["target_duration_sec"],
                "actualDurationSec": r["actual_duration_sec"],
                "chaptersText": r["chapters_text"],
                "title": r["title"] or "",
                "description": r["description"] or "",
                "hashtags": r["hashtags"] or "",
                "createdAt": r["created_at"]
            }

    def list_autoedits(self, project_id: str) -> List[Dict[str, Any]]:
        with self.get_conn() as conn:
            rows = conn.execute(
                "SELECT id, project_id, output_path, format_mode, target_duration_sec, actual_duration_sec, chapters_text, title, description, hashtags, created_at FROM autoedits WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,)
            ).fetchall()
            return [
                {
                    "id": r["id"],
                    "projectId": r["project_id"],
                    "outputPath": r["output_path"],
                    "formatMode": r["format_mode"],
                    "targetDurationSec": r["target_duration_sec"],
                    "actualDurationSec": r["actual_duration_sec"],
                    "chaptersText": r["chapters_text"],
                    "title": r["title"] or "",
                    "description": r["description"] or "",
                    "hashtags": r["hashtags"] or "",
                    "createdAt": r["created_at"]
                }
                for r in rows
            ]

    def delete_autoedit(self, autoedit_id: str):
        with self.get_conn() as conn:
            conn.execute("DELETE FROM autoedits WHERE id = ?", (autoedit_id,))

    def update_autoedit_copy(self, autoedit_id: str, title: str, description: str, hashtags: str) -> Optional[Dict[str, Any]]:
        with self.get_conn() as conn:
            conn.execute(
                "UPDATE autoedits SET title = ?, description = ?, hashtags = ? WHERE id = ?",
                (title, description, hashtags, autoedit_id)
            )
        return self.get_autoedit(autoedit_id)
