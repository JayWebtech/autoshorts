# Import Project Folder Selection & Video Relocation Design

## 1. Overview
Allow users to specify the destination project directory during media import (instead of only after project creation) and choose whether to move the original source video into that folder to centralize all files in one location.

## 2. Requirements & User Stories
- **Custom Project Folder at Import**: When the user imports a video file (or downloads from YouTube), they should see where the project folder will be created (defaulting to `Documents/AutoShorts/<VideoStem>`), with a "Cambiar..." button to select another directory or drive (e.g. `D:\Proyectos`).
- **Option to Move Source Video**: A toggle / checkbox option asking "¿Mover video original a esta carpeta?" (Move original video to this folder).
  - When enabled: The source video is moved into the project folder (`<project_dir>/<original_filename>`), and the project database record stores this path.
  - When disabled: The video stays in its original location, and only generated files (transcription audio, cut clips, summary) live in `<project_dir>`.

## 3. Architecture & Components

### 3.1 Backend (`python_backend/api.py`)
- Update `create_project_from_path(self, args: Any)`:
  - Read `project_dir` from `args` (if provided, use it; otherwise compute default).
  - Read boolean flag `move_source_video = bool(args.get("moveSourceVideo", False))`.
  - Create `<project_dir>` with `audio`, `clips`, `summary`.
  - If `move_source_video` is True and the source file exists:
    - Target file path: `<project_dir> / Path(source_path).name`.
    - If target file path is different from source path:
      - Safely move using `shutil.move(source_path, str(target_file))`.
      - Update `source_path = str(target_file)` so all subsequent probes and ffmpeg operations use the moved file.
  - Store `project_dir` and the updated `source_path` in SQLite.

### 3.2 Frontend Modal (`src/components/modals/StyleModal.tsx`)
- Add props:
  - `customProjectDir: string`: current target folder path.
  - `onSelectProjectDir: () => Promise<void>`: invokes folder picker.
  - `moveSourceVideo: boolean`: toggle state.
  - `setMoveSourceVideo: (val: boolean) => void`: setter.
- Render a dedicated "Ubicación del Proyecto" card right above the modal footer:
  - Path display showing the selected directory.
  - "Cambiar..." button with `<FolderOpen size={14} />`.
  - Linear-style checkbox/toggle: `Mover video original a esta carpeta` with helper hint.

### 3.3 Main App Flow (`src/App.tsx`)
- Manage state:
  - `customProjectDir`: initialized on file selection to `Documents/AutoShorts/<fileNameWithoutExt>`.
  - `moveSourceVideo`: boolean state.
  - Handler to open folder picker using `open({ directory: true })`.
  - In `confirmImport`: pass `projectDir: customProjectDir` and `moveSourceVideo`.

## 4. Error Handling & Edge Cases
- If the source video cannot be moved (e.g. file lock or permissions), log an error or copy instead of failing the entire import.
- If moving across drives, `shutil.move` will copy and delete the source cleanly.
- If user leaves `customProjectDir` as default, proceed with `Documents/AutoShorts/<Name>`.

## 5. Visual Consistency
- Adhere to the Linear monochrome dark aesthetic with `#18181b` surface, `#27272a` borders, and `#fafafa` accents.
