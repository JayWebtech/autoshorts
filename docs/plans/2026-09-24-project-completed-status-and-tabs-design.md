# Design Document: Project Completion Status & Filter Tabs

**Date:** 2026-09-24  
**Status:** Approved  
**Topic:** Project Completed Status Indicator and Dashboard Filter Tabs  

---

## 1. Problem Statement & Motivation
Users working on multiple stream and video projects need a direct, visual way to know which projects have been completed/finished vs which are still pending or in progress. Currently, all projects appear with processing status badges (`READY`, `ANALYZING`, etc.) without a definitive "Done" flag or visual indicator, making project management difficult when the project list grows.

---

## 2. Requirements & Goals
- Provide a clean, one-click toggle to mark a project as "Listo / Culminado" (Completed) or reopen it.
- Display a tasteful emerald/green badge (`CULMINADO`) with check icon on completed project cards.
- Add tabs in `HomeDashboard.tsx` to filter projects: `Todos`, `En progreso`, and `Culminados` with tabular numeric counts.
- Add a quick toggle action in both the Dashboard project cards and the active project `WorkspaceHeader`.
- Display a subtle emerald checkmark next to completed projects in the left `Sidebar` list.
- Keep 100% harmony with the Linear / Vercel monochrome design system.

---

## 3. Architecture & Data Flow

### 3.1 Backend (`python_backend/api.py` & `db.py`)
- Expose `toggle_project_completed(args)` IPC endpoint.
- Query current project status via `db.get_project(project_id)`.
- If current status is `"completed"`, revert to `"ready"`. Otherwise, set status to `"completed"`.
- Persist via `db.update_project_status(project_id, new_status)`.
- Return the updated project record.

### 3.2 Frontend State & Actions (`src/App.tsx`)
- Implement `toggleProjectCompleted(projectId: string)`:
  - Calls `invoke("toggle_project_completed", { projectId })`.
  - Optimistically updates or refreshes the project list and active detail if currently viewing that project.

### 3.3 Dashboard Filter Tabs (`src/components/panels/HomeDashboard.tsx`)
- Local state `filterTab: "all" | "in_progress" | "completed"`.
- Tab bar styled with Linear pills:
  - `Todos (N)`
  - `En progreso (N)` (status !== "completed")
  - `Culminados (N)` (status === "completed")
- Filtered list rendered dynamically based on active tab.
- Project cards show:
  - Emerald status badge when completed (`CULMINADO` with `CheckCircle2` icon).
  - Action button: "Listo" (when pending) / "Reabrir" (when completed).

### 3.4 Workspace Header (`src/components/panels/WorkspaceHeader.tsx`)
- Action button in topbar:
  - If completed: Emerald secondary button `Culminado` (clickable to re-open).
  - If pending: Linear button `Marcar Listo` with check icon.

### 3.5 Sidebar List (`src/components/panels/Sidebar.tsx`)
- In the project navigation items, if `project.status === "completed"`, display a subtle emerald `<Check size={13} color="#34d399" />` next to the project name.

---

## 4. Verification & Testing Plan
- Test backend `toggle_project_completed` with unit call.
- Verify frontend filtering between All, In Progress, and Completed.
- Verify status changes in Dashboard, WorkspaceHeader, and Sidebar.
- Run `pnpm run build` to guarantee TypeScript and Vite build cleanliness.
