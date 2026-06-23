import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .models import (
    Project, Transcript, Candidate, CandidateDraft,
    Clip, ClipCopy, ProjectDetail,
)


class Database:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(db_path))
        self.conn.row_factory = sqlite3.Row
        self._migrate()

    def _migrate(self):
        self.conn.executescript("""
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
        """)
        try:
            self.conn.execute("ALTER TABLE projects ADD COLUMN name TEXT")
        except Exception:
            pass

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _row_to_project(self, r: sqlite3.Row) -> Project:
        return Project(
            id=r["id"], name=r["name"], source_path=r["source_path"],
            source_duration=r["source_duration"], status=r["status"],
            transcription_mode=r["transcription_mode"],
            created_at=r["created_at"], updated_at=r["updated_at"],
        )

    def create_project(self, source_path: str,
                       transcription_mode: str,
                       source_duration: float | None = None) -> Project:
        now = self._now()
        p = Project(
            id=str(uuid.uuid4()), source_path=source_path,
            transcription_mode=transcription_mode,
            source_duration=source_duration, created_at=now, updated_at=now,
        )
        self.conn.execute(
            "INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)",
            (p.id, p.name, p.source_path, p.source_duration, p.status,
             p.transcription_mode, p.created_at, p.updated_at),
        )
        self.conn.commit()
        return p

    def list_projects(self) -> list[Project]:
        rows = self.conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        ).fetchall()
        return [self._row_to_project(r) for r in rows]

    def get_project(self, project_id: str) -> Project | None:
        r = self.conn.execute(
            "SELECT * FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        return self._row_to_project(r) if r else None

    def update_project_status(self, project_id: str, status: str,
                               source_duration: float | None = None):
        self.conn.execute(
            "UPDATE projects SET status=?, source_duration=COALESCE(?, source_duration), updated_at=? WHERE id=?",
            (status, source_duration, self._now(), project_id),
        )
        self.conn.commit()

    def save_transcript(self, project_id: str, engine: str,
                         raw_json: str, language: str | None = None) -> Transcript:
        t = Transcript(
            id=str(uuid.uuid4()), project_id=project_id,
            engine=engine, raw_json=raw_json, language=language,
            created_at=self._now(),
        )
        self.conn.execute("DELETE FROM transcripts WHERE project_id=?", (project_id,))
        self.conn.execute(
            "INSERT INTO transcripts VALUES (?,?,?,?,?,?)",
            (t.id, t.project_id, t.engine, t.raw_json, t.language, t.created_at),
        )
        self.conn.commit()
        return t

    def latest_transcript(self, project_id: str) -> Transcript | None:
        r = self.conn.execute(
            "SELECT * FROM transcripts WHERE project_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id,),
        ).fetchone()
        if not r:
            return None
        return Transcript(
            id=r["id"], project_id=r["project_id"], engine=r["engine"],
            raw_json=r["raw_json"], language=r["language"],
            created_at=r["created_at"],
        )

    def replace_candidates(self, project_id: str,
                           drafts: list[CandidateDraft]) -> list[Candidate]:
        self.conn.execute("DELETE FROM candidates WHERE project_id=?", (project_id,))
        selected_cutoff = min(max(len(drafts), 3), 6)
        candidates = []
        for i, d in enumerate(drafts):
            c = Candidate(
                id=str(uuid.uuid4()), project_id=project_id,
                start_sec=d.start, end_sec=d.end, score=d.score,
                hook=d.hook, rationale=d.rationale,
                rank=i + 1, selected=i < selected_cutoff,
            )
            self.conn.execute(
                "INSERT INTO candidates VALUES (?,?,?,?,?,?,?,?,?)",
                (c.id, c.project_id, c.start_sec, c.end_sec, c.score,
                 c.hook, c.rationale, c.rank, 1 if c.selected else 0),
            )
            self.conn.execute(
                "INSERT INTO clips (id, candidate_id, status) VALUES (?,?,?)",
                (str(uuid.uuid4()), c.id, "pending"),
            )
            candidates.append(c)
        self.conn.commit()
        return candidates

    def list_candidates(self, project_id: str) -> list[Candidate]:
        rows = self.conn.execute(
            "SELECT * FROM candidates WHERE project_id=? ORDER BY rank ASC",
            (project_id,),
        ).fetchall()
        return [Candidate(
            id=r["id"], project_id=r["project_id"],
            start_sec=r["start_sec"], end_sec=r["end_sec"],
            score=r["score"], hook=r["hook"], rationale=r["rationale"],
            rank=r["rank"], selected=bool(r["selected"]),
        ) for r in rows]

    def get_candidate_with_project(self, candidate_id: str
                                    ) -> tuple[Candidate, Project] | None:
        r = self.conn.execute("""
            SELECT candidates.*, projects.id as pid, projects.name,
                   projects.source_path, projects.source_duration,
                   projects.status, projects.transcription_mode,
                   projects.created_at, projects.updated_at
            FROM candidates INNER JOIN projects ON projects.id = candidates.project_id
            WHERE candidates.id=?
        """, (candidate_id,)).fetchone()
        if not r:
            return None
        c = Candidate(id=r["id"], project_id=r["project_id"],
                      start_sec=r["start_sec"], end_sec=r["end_sec"],
                      score=r["score"], hook=r["hook"], rationale=r["rationale"],
                      rank=r["rank"], selected=bool(r["selected"]))
        p = Project(id=r["pid"], name=r["name"], source_path=r["source_path"],
                    source_duration=r["source_duration"], status=r["status"],
                    transcription_mode=r["transcription_mode"],
                    created_at=r["created_at"], updated_at=r["updated_at"])
        return c, p

    def update_clip_for_candidate(self, candidate_id: str, status: str,
                                   output_path: str | None = None,
                                   render_log: str | None = None):
        self.conn.execute(
            "UPDATE clips SET status=?, output_path=COALESCE(?, output_path), render_log=COALESCE(?, render_log) WHERE candidate_id=?",
            (status, output_path, render_log, candidate_id),
        )
        self.conn.commit()

    def set_selected_clip_count(self, project_id: str, count: int) -> list[Candidate]:
        self.conn.execute(
            "UPDATE candidates SET selected = CASE WHEN rank <= ? THEN 1 ELSE 0 END WHERE project_id=?",
            (count, project_id),
        )
        self.conn.commit()
        return self.list_candidates(project_id)

    def project_detail(self, project_id: str) -> ProjectDetail | None:
        project = self.get_project(project_id)
        if not project:
            return None
        transcript = self.latest_transcript(project_id)
        candidates = self.list_candidates(project_id)
        clips = self.conn.execute("""
            SELECT clips.* FROM clips
            INNER JOIN candidates ON candidates.id = clips.candidate_id
            WHERE candidates.project_id=? ORDER BY candidates.rank ASC
        """, (project_id,)).fetchall()
        copy = self.conn.execute("""
            SELECT clip_copy.* FROM clip_copy
            INNER JOIN clips ON clips.id = clip_copy.clip_id
            INNER JOIN candidates ON candidates.id = clips.candidate_id
            WHERE candidates.project_id=?
        """, (project_id,)).fetchall()
        return ProjectDetail(
            project=project, transcript=transcript,
            candidates=candidates,
            clips=[Clip(
                id=r["id"], candidate_id=r["candidate_id"],
                status=r["status"], output_path=r["output_path"],
                face_track_json=r["face_track_json"],
                caption_ass_path=r["caption_ass_path"],
                render_log=r["render_log"],
            ) for r in clips],
            copy=[ClipCopy(
                id=r["id"], clip_id=r["clip_id"], platform=r["platform"],
                hook_text=r["hook_text"], caption_text=r["caption_text"],
                hashtags=r["hashtags"],
            ) for r in copy],
        )

    def delete_project(self, project_id: str):
        self.conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        self.conn.commit()

    def rename_project(self, project_id: str, name: str):
        self.conn.execute(
            "UPDATE projects SET name=?, updated_at=? WHERE id=?",
            (name, self._now(), project_id),
        )
        self.conn.commit()
