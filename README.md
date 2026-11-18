[![Fund my work on FLOSSAfrica](https://flossafrica.com/badge.svg)](https://flossafrica.com/m/jaywebtech?p=autoshorts)

# AutoShorts

AutoShorts is a local-first desktop application for turning long-form video or audio recordings into high-impact, vertical short-form clip candidates (9:16 portrait) with AI-powered viral moment ranking.

This repository implements the desktop app foundation using **Tauri 2 + React + TSX + Rust + SQLite**.

<img width="1397" height="918" alt="Screenshot 2026-06-22 at 4 10 13 PM" src="https://github.com/user-attachments/assets/3a58ff60-6d9b-46fc-81e8-2778c96aba62" />

---

## Key Features

- **Dynamic Multi-LLM Support**: Supports both **DeepSeek** (default) and **Claude** (anthropic) for viral moment detection and hooks analysis.
- **Automated Pipeline**: Imports media, extracts audio, transcribes using Deepgram, and automatically analyzes and ranks moments in a single automated chain.
- **Local SQLite Storage**: Saves transcripts, candidates, custom names, and rendering data locally.
- **Native Project Manager**: Create, open, rename, and delete projects from the dashboard.
- **Portrait Auto-Cropping**: Automatically center-crops landscape videos to vertical H.264 portrait clips using native `ffmpeg` integration.
- **Key Warnings**: Built-in visual warnings that identify missing environment variables and prompt you directly in the UI.

---

## Prerequisites

To run the application, **FFmpeg & FFprobe** must be installed and available on your system `PATH` to handle cropping, audio extraction, and dynamic captions:

* **macOS**: Install using Homebrew:
  ```bash
  brew install ffmpeg
  ```
  *Note: To ensure full captions rendering support, if standard Homebrew FFmpeg lacks drawtext/subtitles filters, tap and install the `homebrew-ffmpeg` formula:*
  ```bash
  brew tap homebrew-ffmpeg/ffmpeg
  brew install homebrew-ffmpeg/ffmpeg/ffmpeg
  ```
* **Windows**: Install using Winget (in PowerShell):
  ```powershell
  winget install Gyan.FFmpeg
  ```
  *(Or download the release build from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) and add it to your system PATH environment variables).*
* **Linux**: Install via your native package manager:
  ```bash
  sudo apt install ffmpeg      # Debian/Ubuntu
  sudo pacman -S ffmpeg        # Arch Linux
  sudo dnf install ffmpeg      # Fedora
  ```

---

## Installation Guide (For Users)

Download the correct package matching your system from the latest [GitHub Releases](https://github.com/JayWebtech/autoshorts/releases/tag/autoshorts).

### 🖥️ macOS Installation
1. **Download**:
   * **Apple Silicon (M1/M2/M3)**: Select the `aarch64.dmg` package.
   * **Intel Mac**: Select the `x64.dmg` package.
2. **Install**: Double-click the `.dmg` file and drag **AutoShorts** to your **Applications** folder.
3. **Bypass Gatekeeper** (For unsigned local builds):
   * Right-click `AutoShorts.app` in Finder, select **Open**, and click **Open** in the warning dialog.
   * *Alternatively*, run this command in Terminal:
     ```bash
     xattr -cr /Applications/AutoShorts.app
     ```

### 🪟 Windows Installation
1. **Download**: Select the `.msi` (installer) or `.exe` (portable executable) package.
2. **Install**: Double-click the `.msi` file to run the setup wizard.
3. **SmartScreen Bypass**: Since the package is self-signed, Windows SmartScreen may show a warning. Click **"More Info"** in the window and choose **"Run anyway"**.

### 🐧 Linux Installation
1. **Download**: Select the `.deb` (Debian/Ubuntu) or `.AppImage` (universal portable binary).
2. **Install `.deb`**:
   ```bash
   sudo dpkg -i autoshorts_*.deb
   ```
3. **Run `.AppImage`**:
   Make it executable and launch it:
   ```bash
   chmod +x autoshorts_*.AppImage
   ./autoshorts_*.AppImage
   ```

### 🚀 First-Launch Onboarding & AI Configuration

When you first launch the application, you will be greeted by an **Onboarding Wizard** that lets you choose your preferred workflow:

#### Option A: Fully Offline (Ollama + Whisper)
1. **Ollama Setup**: Select a local model card (`llama3.2 3B`, `qwen2.5 3B`, or `qwen2.5 7B`). The application will check if Ollama is running and automatically pull the model weights, showing a downloader progress bar.
2. **Local Whisper**: Click **Instalar Whisper**. The app creates a virtualenv under its data directory (`python-venv`) and installs `openai-whisper` into it, so nothing is added to your system Python. The first install downloads PyTorch (~1–2 GB). Only a Python 3 interpreter is required — the Linux packages declare `python3`/`python3-venv` as dependencies.

#### Option B: Cloud API Keys
1. Enter your API credentials for:
   * **Deepgram**: For fast, accurate cloud transcription.
   * **DeepSeek**: (Highly Recommended) For cheap, high-quality cloud moment detection.
   * **Claude**: For premium copywriting, hooks, and moment detection.
2. Click **Save & Start** to immediately load the dashboard.

#### Option C: Any OpenAI-Compatible Endpoint
Select **OpenAI-Compatible (Custom Base URL)** in **API Settings** and provide:
* **Base URL**: the API root, e.g. `http://localhost:1234/v1` (LM Studio), `http://localhost:8000/v1` (vLLM), `http://localhost:8080/v1` (llama.cpp), or a hosted provider URL.
* **Model Name**: the model identifier that endpoint expects.
* **API Key**: optional; leave empty for local servers that do not require auth.

The app calls `POST {Base URL}/chat/completions` and retries without `response_format` if the server rejects JSON mode.

---

### ⚙️ Modifying Settings & Resetting Onboarding

* **Update Credentials**: Click the **API Settings** gear icon in the top right of your app dashboard to switch engines, select different local models, or update API keys.
* **Reset Onboarding**: If you want to switch from Cloud to Offline (or vice-versa) and start setup from scratch, click the **Reset App Configuration & Onboarding** button at the bottom of the API Settings panel.

> [!TIP]
> **LLM Provider Recommendation (Local vs. Cloud)**:
> - **Local Models (Ollama)**: While AutoShorts supports fully offline moments analysis via local Ollama models (like LLaMA 3.2 3B or Qwen 2.5 3B/7B), **local models are generally not recommended for viral moment detection**. Smaller 3B/7B models lack the context reasoning and mathematical capabilities needed to evaluate long transcripts and calculate accurate segment timestamps (often outputting fragments that are too short).
> - **DeepSeek (Highly Recommended)**: We strongly suggest using **DeepSeek** for moment detection. It offers top-tier reasoning capabilities (matching GPT-4/Claude 3.5 Sonnet) at a **fraction of a cent per run** (under $0.001 per transcript). You can get an API key instantly at [platform.deepseek.com](https://platform.deepseek.com).
> - **Claude (Premium Option)**: Claude 3.5 Sonnet provides the absolute best hooks copywriting and emotional resonance, but is slightly more expensive than DeepSeek (typically $0.01 – $0.05 per run).

---

## Developer Guide

### 1. Setup Environment Configuration
Copy `.env.example` to `.env` in the root folder:
```bash
cp .env.example .env
```
Fill in your API Keys:
```env
DEEPGRAM_API_KEY=your-deepgram-api-key
DEEPSEEK_API_KEY=your-deepseek-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Choose your default AI analysis provider
# ("deepseek", "claude", "gemini", "openai", "openrouter", "groq", "local" or "openai-compatible")
LLM_PROVIDER=deepseek

# Only for LLM_PROVIDER=openai-compatible
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_COMPATIBLE_MODEL=qwen2.5-7b-instruct
OPENAI_COMPATIBLE_API_KEY=
```

### 2. Run in Development Mode
To start the live-reloaded frontend and backend development shell:
```bash
npm install
npm run tauri:dev
```

### 3. Build the Application
To build and package the native macOS app bundle (`.app` and `.dmg` installer):
```bash
npm run tauri:build
```
The output installers will be built under `src-tauri/target/release/bundle/`.

### 4. Run the Tests
Rust unit tests live next to the code they cover (`#[cfg(test)]` modules in
`src-tauri/src/*.rs`); the SQLite layer is covered end to end from
`src-tauri/tests/db_integration.rs` against a temporary database file:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
# or
npm run test:rust
```

Frontend tests use Vitest + Testing Library with a jsdom environment:

```bash
npm test              # single run
npm run test:watch    # watch mode
```

Test layout:

| Path | Kind | Covers |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | unit | SRT/ASS caption generation, slug + extension validation |
| `src-tauri/src/media.rs` | unit | ffmpeg progress parsing, ASS filter escaping, path handling |
| `src-tauri/src/transcription.rs` | unit | Whisper/Deepgram normalization, segment building, download progress |
| `src-tauri/src/llm.rs` | unit | LLM response parsing, SSE streaming, URL normalization |
| `src-tauri/tests/db_integration.rs` | integration | projects, transcripts, candidates, clips, cascade deletes, migrations |
| `src/lib/format.test.ts` | unit | duration/size/file-name formatting helpers |
| `src/components/common.test.tsx` | component | `PipelineStep`, `EmptyState`, `StatusPill` |
| `src/App.integration.test.tsx` | integration | onboarding gate, sidebar rendering, project detail loading (Tauri IPC mocked) |

### 5. Multi-Platform Build (Windows + Linux + macOS)
One command attempts every platform the current host can actually target:
```bash
npm run build:all
```
Each platform is detected first; unsupported ones are skipped with the reason instead of aborting the run. Successful bundles are copied to `artifacts/<platform>/`.

```bash
npm run build:linux     # .deb / .rpm / .AppImage
npm run build:windows   # .msi / NSIS .exe
npm run build:macos     # .dmg / .app (macOS only)

npm run build:all -- --only=linux,macos     # subset
npm run build:all -- --skip=windows         # exclude one
npm run build:all -- --dry-run              # print commands only
```

Host capability matrix:

| Target | Requires |
| --- | --- |
| Linux | Linux host + `webkit2gtk-4.1`, `gtk+-3.0`, `libsoup-3.0` (pkg-config) |
| Windows | Windows host, **or** WSL with Windows `cargo.exe` + `node.exe` + MSVC Build Tools. From WSL the source is mirrored to `%USERPROFILE%\autoshorts-build` and built by the Windows toolchain. |
| macOS | macOS + Xcode only. Cannot be produced from Linux/WSL — use a Mac or the `Release App` GitHub workflow. |

<a id="support"></a>

## ❤️ Support AutoShorts

If AutoShorts helps you create content faster, consider supporting its development.

Your support helps fund new features, bug fixes, and ongoing improvements.

👉 https://buy.polar.sh/polar_cl_ZjNgejG1JnPQqVXyMmEmq7vpdwJUFBqx4qahw4BqBCP
