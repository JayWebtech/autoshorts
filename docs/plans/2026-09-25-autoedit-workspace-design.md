# Design Document: Dedicated AutoEdit Workspace View & Split-Panel Architecture

**Date**: 2026-09-25  
**Status**: Approved by User  
**Author**: Antigravity  

---

## 1. Executive Summary

Transform the AutoEdit feature from an ephemeral popup modal into a first-class **dedicated workspace view** within each project. The workspace features a split-panel interface:
- **Left Panel (Assembler & Configuration)**: Interactive format selection (YouTube 16:9 vs. TikTok 9:16), target duration chips, editorial toggles, and live rendering progress.
- **Right Panel (Render Gallery & Social Hub)**: List of generated AutoEdit videos with quick playback, folder access, YouTube chapters, and full AI social media copy (titles, descriptions, hashtags) ready to copy in 1 click.

---

## 2. Navigation & Workspace Switcher

A segmented tab switcher in `WorkspaceHeader` allows seamless switching between:
1. **Clips y Momentos** (Classic view: Transcription panel on the left, Candidate moments on the right).
2. **AutoEdición con IA** (Split-panel view: Config on the left, Render Gallery on the right).

Both views operate on the same project state, preserving all existing moment selection, transcription data, and background tasks.

---

## 3. UI Component Architecture

```
src/
├── components/
│   ├── panels/
│   │   ├── WorkspaceHeader.tsx         # Adds segmented switcher [Clips y Momentos | AutoEdición con IA]
│   │   ├── autoedit/
│   │   │   ├── AutoEditWorkspace.tsx   # Two-column grid container
│   │   │   ├── AutoEditConfigPanel.tsx # Left panel: format, duration, toggles, assemble button & progress
│   │   │   └── AutoEditGalleryPanel.tsx# Right panel: cards of rendered videos, playback, copy & chapters
```

### 3.1 Left Panel (`AutoEditConfigPanel`)
- **Format Cards**: YouTube (16:9 horizontal) and Shorts/TikTok (9:16 vertical).
- **Duration Chips**:
  - TikTok: 1 min, 2 min, 3 min.
  - YouTube: 8 min, 12 min, 15 min, 20 min.
- **Toggles**: Teaser Hook (3-5s cold open) and Recortar silencios (dead-air jump cuts).
- **Assemble Button**: Triggers `render_auto_edit` with live percentage and step indicator.

### 3.2 Right Panel (`AutoEditGalleryPanel`)
- **Empty State**: Friendly invitation to assemble the first montage with format recommendations.
- **Video Cards**:
  - File name, creation date, format badge (16:9 or 9:16), and formatted duration (e.g. `2m 00s`).
  - Actions: **Reproducir** (opens in default OS player via `open_media_file`) and **Carpeta** (opens in Explorer via `open_folder`).
  - **Social Copy Card**:
    - Suggested Title (with 1-click copy).
    - Description for YouTube/TikTok (with 1-click copy).
    - Curated Hashtags (with 1-click copy).
    - YouTube Chapters with timestamps (with 1-click copy).

---

## 4. Backend & Data Persistence

### 4.1 SQLite Schema (`db.py`)
Create an `autoedits` table to persist every generated montage across sessions:
```sql
CREATE TABLE IF NOT EXISTS autoedits (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    output_path TEXT NOT NULL,
    format_mode TEXT NOT NULL,
    target_duration_sec REAL NOT NULL,
    actual_duration_sec REAL,
    chapters_text TEXT,
    title TEXT,
    description TEXT,
    hashtags TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

### 4.2 Auto-generating Social Copy on Render Completion
When `render_auto_edit` finishes:
1. Calls `generate_social_copy_with_llm` using the narrative title and story hooks to create tailored copy (title, description, hashtags).
2. Saves the record to `autoedits` in SQLite.
3. Emits `autoedit-complete` or returns the newly created autoedit object.

### 4.3 New Python API Methods (`api.py`)
- `get_autoedits(projectId)`: Returns all saved autoedits for the project, also discovering any existing MP4s in the project's `autoedit/` folder so past renders appear immediately.
- `delete_autoedit(autoeditId)`: Deletes the record (and optionally the MP4 file).
- `generate_autoedit_social_copy(autoeditId)`: Generates or refreshes social copy on demand.
