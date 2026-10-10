# Design Document: UI/UX Linear & Vercel Monochrome Overhaul

## 1. Overview & Vision
This document formalizes the complete visual and interaction design overhaul for **AutoShorts**, adopting the **Linear / Vercel** design language:
- High contrast, true black and precision zinc surfaces (`#000000`, `#09090b`, `#141418`, `#27272a`).
- Restrained, purposeful contrast: high-impact `#fafafa` on `#09090b` primary buttons, dark secondary buttons.
- Monospace tabular numbers (`font-variant-numeric: tabular-nums`) for timestamps, telemetry, and progress.
- Flexible multi-aspect ratio video preview cards (supporting original 16:9, vertical 9:16, square 1:1 without forcing 9:16).
- 100% emoji-free UI with clean SVG Lucide iconography.
- Micro-interactions (120ms-180ms ease transitions).

---

## 2. Design System Tokens (`src/styles.css`)

```css
:root {
  /* Surfaces */
  --bg-app: #000000;
  --bg-sidebar: #09090b;
  --bg-surface: #0f0f12;
  --bg-surface-raised: #141418;
  --bg-surface-hover: #1c1c22;
  --bg-input: #09090b;

  /* Borders */
  --border-subtle: #1c1c22;
  --border-default: #27272a;
  --border-hover: #3f3f46;
  --border-focus: #fafafa;

  /* Typography */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #52525b;

  /* Linear-style Buttons */
  --btn-primary-bg: #fafafa;
  --btn-primary-text: #09090b;
  --btn-primary-hover: #e4e4e7;

  --btn-secondary-bg: #141418;
  --btn-secondary-border: #27272a;
  --btn-secondary-text: #fafafa;
  --btn-secondary-hover: #1c1c22;

  /* Functional Status */
  --status-success: #10b981;
  --status-warning: #f59e0b;
  --status-error: #ef4444;
  --accent-primary: #fafafa;

  /* Fonts */
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

---

## 3. Component Specifications

### 3.1 Sidebar (`src/components/panels/Sidebar.tsx`)
- Background: `--bg-sidebar` (`#09090b`), border right `1px solid var(--border-subtle)`.
- Primary Button: Linear dominant action (`bg: #fafafa`, `text: #09090b`).
- Secondary Button: Dark secondary button with subtle zinc border.
- Project Rows: Active project highlighted with `--bg-surface-hover` and white text; inactive in `--text-secondary`.
- Config & API Button: Bottom-docked minimal item with icon.

### 3.2 Workspace Header (`src/components/panels/WorkspaceHeader.tsx`)
- Project name in bold white, with subtle compact status pill (`Transcrito listo` / `14 Momentos`).
- Actions grouped on right:
  - "Autoeditar Resumen" button.
  - "Configuración & APIs" toggle button.
  - "Actualizar" button.
- No obsolete 5-box pipeline strip.

### 3.3 Transcript Panel (`src/components/panels/TranscriptPanel.tsx`)
- Segment count in monospace (`342 segmentos`).
- Thin linear progress indicator (3px) during active transcription or refinement with exact percentage.
- Transcript rows: Monospace timestamps (`[00:14]`) in muted zinc, smooth text selection and editing.

### 3.4 Candidate Panel (`src/components/panels/CandidatePanel.tsx`)
- Duration segmented control (`30 seg | 1 min | 2 min | 3 min | 5 min`): Active pill has white background and black text.
- Thinking mode toggle: clean, minimal toggle switch.
- Progress bar during moment analysis with percentage and block status.
- **Flexible Aspect Ratio Preview Container**:
  - Instead of forcing portrait 9:16, the thumbnail preview frame supports flexible aspect ratio (16:9 horizontal, 9:16 vertical, or original) with a clean play overlay and rank badge.
- Candidate card body:
  - Monospace timestamps (`01:15 - 02:30`) and score match (`92% Match`).
  - Semibold white hook, zinc rationale.
  - Description box with copy feedback.
  - Action buttons: "Ver" (Preview) and "Cut".

### 3.5 Home Dashboard (`src/components/panels/HomeDashboard.tsx`)
- Modern projects grid with cards in `--bg-surface-raised` and `--border-default`.
- Hover elevation with border `--border-hover`.
- Duration in monospace, clean date formatting, and action buttons (`Abrir`, `Renombrar`, `Eliminar`).

### 3.6 Footer / Telemetry Bar (`src/components/common/StatusBar.tsx`)
- Height: 32px, bottom docked, border top `1px solid var(--border-subtle)`.
- Telemetry metrics in tabular monospace numbers:
  - `CPU: 6.3%` | `GPU: 4% (48°C)` | `VRAM: 0.7 / 12.0 GB`
- Status indicators for dependencies with subtle indicator dots.

### 3.7 Modals & Dialogs
- Overlays with `rgba(0, 0, 0, 0.75)` and `backdrop-filter: blur(4px)`.
- Containers in `--bg-surface-raised` with `--border-default`.
- Inputs and selects in `--bg-input` with crisp borders and focus state in white.
- Model traffic light recommendation badges (`ModelBadge.tsx`) cleanly matching the monochrome palette.
