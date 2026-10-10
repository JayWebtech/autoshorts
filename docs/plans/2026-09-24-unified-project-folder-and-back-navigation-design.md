# Design Document: Unified Project Storage Folder, Project Relocation & Dashboard Navigation

**Date:** 2026-09-24  
**Status:** Approved  
**Topic:** Unified Project Directory (Audio + Clips + Summary), Relocate/Move Project Folder, and Back to Dashboard Button  

---

## 1. Problem Statement
1. **Navigation friction**: When editing a project, there is no direct "Back to Dashboard" button in the workspace header; users must rely solely on the left sidebar to navigate back.
2. **Fragmented storage**: Project assets are currently dispersed across disconnected locations: extracted transcription audio in `.autoshorts/projects/<id>/` (hidden Windows folder), clips in `Documents/AutoShorts/<proj_name>/`, and summaries in separate subpaths.
3. **Inability to move projects**: Users have no built-in way to move a project's assets to another disk/drive (e.g., from `C:` to a high-capacity `D:` or external SSD drive) or open the project folder in Windows Explorer.

---

## 2. Requirements & Goals
- **Back to Dashboard Button**:
  - Add `<ChevronLeft size={16} /> Volver` button in `WorkspaceHeader` to cleanly return to `HomeDashboard` with one click.
- **Unified Project Directory (`project_dir`)**:
  - Consolidate all project artifacts inside a single dedicated folder:
    - `audio/transcription_audio.wav` (extracted Whisper audio)
    - `clips/` (cut candidate MP4 videos and exported SRTs)
    - `summary/` (compiled summary videos)
    - `project_info.json` (metadata & candidate backup)
  - Default path: `~/Documents/AutoShorts/<ProjectName>` or customizable location.
- **Open Project Folder**:
  - Action button in `WorkspaceHeader` and `HomeDashboard` card to open the folder directly in Windows Explorer.
- **Move / Relocate Project Folder**:
  - Action button in `WorkspaceHeader` allowing users to select a new destination directory (on any disk/drive).
  - Safely transfers project files (`shutil.move` / `shutil.copytree`), updates the project's directory in the database, and refreshes the frontend without losing any transcription, clips, or settings.

---

## 3. Architecture & Data Flow

### 3.1 Database & Schema (`python_backend/db.py`)
- In `projects` table:
  - Add optional column `project_dir TEXT` (with migration to automatically backfill for existing projects).
  - Add helper `update_project_dir(project_id, new_dir)`.

### 3.2 Backend API (`python_backend/api.py`)
- Helper `get_project_dir(project)`:
  - Resolves `project.get("projectDir")` or fallback `Documents/AutoShorts/<proj_name>`.
  - Ensures subdirectories exist (`audio/`, `clips/`, `summary/`).
- Endpoint `open_project_folder(args)`:
  - Resolves project directory.
  - Launches Windows Explorer: `os.startfile(str(proj_dir))` or `subprocess.Popen(["explorer", str(proj_dir)])`.
- Endpoint `move_project_folder(args)`:
  - Receives `{ projectId, targetParentDir }`.
  - Creates the destination folder inside `targetParentDir`.
  - Copies/moves files from old `project_dir` to new `project_dir`.
  - Updates `project_dir` in database.
  - Returns updated project record.
- Update `extract_audio_for_transcription`:
  - Output audio to `<project_dir>/audio/transcription_audio.wav`.
- Update `render_flat_clip_for_candidate` and `render_summary_video`:
  - Output clips to `<project_dir>/clips/` and `<project_dir>/summary/`.

### 3.3 Frontend Navigation & Controls
- `WorkspaceHeader.tsx`:
  - Add `onBackToDashboard: () => void` prop.
  - Add `<ChevronLeft size={16} /> Volver` button on top-left.
  - Add `onOpenFolder: () => void` button with `<FolderOpen size={15} />`.
  - Add `onMoveProject: () => void` button with `<FolderSync size={15} />`.
- `HomeDashboard.tsx`:
  - Add `openProjectFolder` action button on each project card.
- `src/App.tsx`:
  - Implement `openProjectFolder(projectId)` and `moveProjectFolder(projectId)`.
  - Wire `onBackToDashboard` to `onSelectProject(null)`.

---

## 4. Verification Plan
- Test `move_project_folder` and `open_project_folder` in python with temporary folders.
- Verify audio extraction and clip rendering write to unified `<project_dir>`.
- Build frontend with `pnpm run build` to verify TypeScript typings.
- Test "Volver" button returns to Dashboard instantly.
