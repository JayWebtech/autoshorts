import React from "react";
import {
  Clapperboard,
  SlidersHorizontal,
  RefreshCw,
  Check,
  CheckCircle2,
  AlertTriangle,
  FolderSearch,
  ChevronLeft,
  FolderOpen,
  FolderSync,
  Zap,
  Scissors,
  FileText,
  Trash2,
} from "lucide-react";
import type { ProjectDetail, LlmMemoryStatus } from "../../types";
import { fileName } from "../../utils/format";

interface WorkspaceHeaderProps {
  detail: ProjectDetail;
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  openSummaryModal: () => void;
  refresh: (projectId: string) => void;
  toggleProjectCompleted: (projectId: string) => void;
  relinkProjectVideo: (projectId: string) => void;
  onBackToDashboard: () => void;
  openProjectFolder: (projectId: string) => void;
  moveProjectFolder: (projectId: string) => void;
  error: string | null;
  selectedCount?: number;
  selectedCutCount?: number;
  selectedCaptionsCount?: number;
  activeView?: "transcript" | "moments" | "autoedit";
  onChangeView?: (view: "transcript" | "moments" | "autoedit") => void;
  llmMemoryStatus?: LlmMemoryStatus | null;
  onUnloadActiveModel?: () => Promise<void>;
  isMemoryActionBusy?: boolean;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  detail,
  showSettings,
  setShowSettings,
  openSummaryModal,
  refresh,
  toggleProjectCompleted,
  relinkProjectVideo,
  onBackToDashboard,
  openProjectFolder,
  moveProjectFolder,
  error,
  activeView = "moments",
  onChangeView,
  llmMemoryStatus,
  onUnloadActiveModel,
  isMemoryActionBusy = false,
}) => {
  const isCompleted = detail.project.status === "completed";
  const isMissing = detail.project.sourceExists === false;

  const statusLabel = isMissing
    ? "Archivo movido o eliminado"
    : detail.candidates.length > 0
    ? `${detail.candidates.length} Momentos detectados`
    : detail.transcript
    ? "Transcrito listo"
    : "Audio pendiente de transcribir";

  return (
    <>
      <header className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
          <button
            type="button"
            className="back-dashboard-btn"
            onClick={onBackToDashboard}
            title="Volver a todos los proyectos (Dashboard)"
          >
            <ChevronLeft size={16} />
            <span>Volver</span>
          </button>

          <div className="project-info">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {isMissing ? (
                <div
                  className="eyebrow"
                  style={{
                    background: "rgba(245, 158, 11, 0.12)",
                    borderColor: "rgba(245, 158, 11, 0.35)",
                    color: "#fbbf24",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <AlertTriangle size={11} />
                  <span>VIDEO NO ENCONTRADO</span>
                </div>
              ) : isCompleted ? (
                <div
                  className="eyebrow"
                  style={{
                    background: "rgba(16, 185, 129, 0.12)",
                    borderColor: "rgba(16, 185, 129, 0.35)",
                    color: "#34d399",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <CheckCircle2 size={11} />
                  <span>CULMINADO</span>
                </div>
              ) : (
                <div className="eyebrow">{detail.project.status}</div>
              )}
              <span
                style={{
                  fontSize: "0.72rem",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "var(--bg-surface-raised)",
                  border: "1px solid var(--border-default)",
                  color: isMissing ? "#fbbf24" : "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 500,
                }}
              >
                {statusLabel}
              </span>
            </div>
            <h2>{detail.project.name || fileName(detail.project.sourcePath)}</h2>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="secondary-action"
            onClick={() => void openProjectFolder(detail.project.id)}
            title="Abrir carpeta de archivos de este proyecto en el Explorador de Windows"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <FolderOpen size={14} />
            <span>Carpeta</span>
          </button>

          <button
            type="button"
            className="secondary-action"
            onClick={() => void moveProjectFolder(detail.project.id)}
            title="Mover la carpeta de este proyecto a otro disco o ubicación"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <FolderSync size={14} />
            <span>Mover</span>
          </button>
          {isMissing ? (
            <button
              type="button"
              className="missing-video-banner-btn"
              onClick={() => void relinkProjectVideo(detail.project.id)}
              title="Buscar y seleccionar la nueva ubicación de este video"
            >
              <FolderSearch size={14} />
              <span>Localizar video</span>
            </button>
          ) : (
            <button
              type="button"
              className="secondary-action"
              onClick={() => void toggleProjectCompleted(detail.project.id)}
              title={isCompleted ? "Reabrir proyecto como en progreso" : "Marcar proyecto como culminado"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: isCompleted ? "rgba(16, 185, 129, 0.1)" : undefined,
                borderColor: isCompleted ? "rgba(16, 185, 129, 0.35)" : undefined,
                color: isCompleted ? "#34d399" : undefined,
              }}
            >
              {isCompleted ? (
                <>
                  <CheckCircle2 size={14} />
                  <span>Culminado</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Marcar Listo</span>
                </>
              )}
            </button>
          )}

          {/* Segmented View Switcher: Transcripción | Clips y Momentos | AutoEdición con IA */}
          <div className="view-mode-segmented">
            <button
              type="button"
              className={`view-mode-pill ${activeView === "transcript" ? "active" : ""}`}
              onClick={() => onChangeView?.("transcript")}
              title="Ver y editar la transcripción completa del video"
            >
              <FileText size={13} />
              <span>Transcripción</span>
            </button>
            <button
              type="button"
              className={`view-mode-pill ${activeView === "moments" ? "active" : ""}`}
              onClick={() => onChangeView?.("moments")}
              title="Explorar, previsualizar y cortar los clips candidatos detectados"
            >
              <Scissors size={13} />
              <span>Clips y Momentos</span>
              {detail.candidates.length > 0 && (
                <span
                  style={{
                    fontSize: "0.68rem",
                    padding: "1px 5px",
                    borderRadius: "10px",
                    background: activeView === "moments" ? "rgba(255, 255, 255, 0.2)" : "var(--bg-surface-raised)",
                    color: activeView === "moments" ? "#fafafa" : "var(--text-secondary)",
                    fontFamily: "var(--font-mono, monospace)",
                    marginLeft: "2px",
                  }}
                >
                  {detail.candidates.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`view-mode-pill ${activeView === "autoedit" ? "active" : ""}`}
              onClick={() => onChangeView?.("autoedit")}
              title="Sección de montaje automático con IA y galería de autoedits para YouTube"
            >
              <Zap size={13} />
              <span>AutoEdición con IA</span>
            </button>
          </div>

          {llmMemoryStatus?.isLoaded && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "3px 8px",
                borderRadius: "6px",
                background: "rgba(16, 185, 129, 0.12)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                color: "#34d399",
                fontSize: "0.72rem",
                fontFamily: "var(--font-mono)",
              }}
              title={`Modelo activo en VRAM/RAM: ${llmMemoryStatus.loadedModel}`}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              <span>{llmMemoryStatus.loadedModel} {llmMemoryStatus.sizeMb ? `(${llmMemoryStatus.sizeMb}MB)` : ""}</span>
              {onUnloadActiveModel && (
                <button
                  type="button"
                  onClick={() => void onUnloadActiveModel()}
                  disabled={isMemoryActionBusy}
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#f87171",
                    borderRadius: "4px",
                    padding: "1px 5px",
                    fontSize: "0.68rem",
                    cursor: isMemoryActionBusy ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontWeight: 500,
                  }}
                  title="Liberar VRAM de inmediato"
                >
                  <Trash2 size={10} />
                  <span>Liberar</span>
                </button>
              )}
            </div>
          )}

          <button
            className={`secondary-action settings-toggle ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Configuración de Modelos & APIs"
          >
            <SlidersHorizontal size={15} />
            <span>Configuración & APIs</span>
          </button>
          <button className="secondary-action" onClick={() => void refresh(detail.project.id)} title="Actualizar" style={{ width: "36px", padding: 0 }}>
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {isMissing && (
        <div className="missing-video-banner">
          <div className="missing-video-banner-content">
            <AlertTriangle size={18} style={{ color: "#fbbf24", flexShrink: 0 }} />
            <div>
              <strong>El archivo original de video no se encuentra en:</strong>
              <div style={{ marginTop: "2px" }}>
                <code>{detail.project.sourcePath}</code>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="missing-video-banner-btn"
            onClick={() => void relinkProjectVideo(detail.project.id)}
            title="Seleccionar la nueva ruta del archivo de video"
          >
            <FolderSearch size={14} />
            <span>Localizar video</span>
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
    </>
  );
};
