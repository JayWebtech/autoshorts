# Design Document: Missing Video Detection and Relinking

**Date:** 2026-09-24  
**Status:** Approved  
**Topic:** Relink moved / missing source videos with visual status & file picker  

---

## 1. Problem Statement
When a user moves, renames, or transfers a source video file to a different folder or drive after importing it into AutoShorts, the project's stored `sourcePath` becomes invalid. Attempting to play the video, generate candidate clips, or render summaries causes unexpected playback failures or FFmpeg errors without explaining to the user why the file cannot be accessed.

---

## 2. Requirements & Goals
- Automatically detect whether the file at `sourcePath` exists (`os.path.exists`) without crashing or blocking project load.
- Flag missing media with a `sourceExists: boolean` property on project models.
- In the Dashboard:
  - Display an amber warning badge `VIDEO NO ENCONTRADO` on affected project cards.
  - Provide a dedicated button `Localizar video` with `<FolderSearch size={13} />`.
- In the Project Workspace:
  - Display an amber banner informing the user of the missing video and its last known path.
  - Provide a direct button to relink the video file.
  - Disable clip rendering / video operations until media is relinked.
- In the Sidebar:
  - Show a small amber warning icon next to projects with missing videos.
- Backend relinking endpoint (`relink_project_video`):
  - Validate new file existence and probe with `ffprobe` to verify duration and readability.
  - Update `source_path`, `source_duration`, and `updated_at` in SQLite database.
  - Return updated project record so frontend updates reactively.

---

## 3. Architecture & Data Flow

### 3.1 Backend (`python_backend/db.py` & `api.py`)
- In `db.py`:
  - Add `relink_project(project_id, new_source_path, new_duration)` to update `projects` table.
- In `api.py`:
  - In `list_projects()`:
    - Enrich each project dict with `"sourceExists": os.path.exists(p["sourcePath"])`.
  - In `get_project_detail()`:
    - Enrich detail project dict with `"sourceExists": os.path.exists(proj["sourcePath"])`.
  - New IPC endpoint: `relink_project_video(args)`:
    - Extract `projectId` and `newSourcePath`.
    - Verify `os.path.exists(new_source_path)`. If not, raise `FileNotFoundError`.
    - Probe media with `probe_media(new_source_path)` to get `durationSec`.
    - Update database via `self.db.relink_project(...)`.
    - Return updated project.

### 3.2 Frontend State & Relinking Controller (`src/App.tsx`)
- Implement `relinkProjectVideo(projectId: string, explicitPath?: string)`:
  - Open file selection dialog using `open({ multiple: false, filters: [{ name: "Video Files", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }] })`.
  - Call `invoke("relink_project_video", { projectId, newSourcePath: selectedPath })`.
  - Refresh projects list and active project detail.
- Pass `relinkProjectVideo` to `<HomeDashboard>` and `<WorkspaceHeader>`.

### 3.3 Dashboard Card Alert & Action (`src/components/panels/HomeDashboard.tsx`)
- Check `project.sourceExists === false`:
  - Show amber warning badge `<AlertTriangle size={11} /> VIDEO NO ENCONTRADO`.
  - Replace or prepend action button with `Localizar` (`.relink-btn`).

### 3.4 Workspace Alert Banner (`src/components/panels/WorkspaceHeader.tsx`)
- When `detail.project.sourceExists === false`:
  - Render an amber alert banner below header:
    - Icon `<AlertTriangle size={16} />`.
    - Text: "El archivo de video original no se encuentra en: [Ruta previa]. Localiza el video para poder reproducir y generar clips."
    - Button: `Localizar Video` (`secondary-action`).

### 3.5 Sidebar List Indicator (`src/components/panels/Sidebar.tsx`)
- Show an amber `<AlertTriangle size={13} color="#f59e0b" />` if `project.sourceExists === false`.

---

## 4. Verification Plan
- Unit test backend `relink_project_video` and `sourceExists` detection with temporary sqlite database and temp files.
- Build frontend with `pnpm run build` to ensure type cleanliness.
- Verify visually with moved file simulation.
