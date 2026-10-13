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
  onUpdateWorkflowGoal?: (projectId: string, goal: "clips" | "autoedit") => Promise<void>;
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
  onUpdateWorkflowGoal,
}) => {
  const isCompleted = detail.project.status === "completed";
  const isMissing = detail.project.sourceExists === false;
  const workflowGoal = detail.project.workflowGoal || "clips";
  const [showAllTabs, setShowAllTabs] = React.useState(false);

  const showClipsTab = showAllTabs || workflowGoal === "clips";
  const showAutoEditTab = showAllTabs || workflowGoal === "autoedit";

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
              <span
                style={{
                  fontSize: "0.72rem",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: workflowGoal === "autoedit" ? "rgba(59, 130, 246, 0.1)" : "rgba(16, 185, 129, 0.1)",
                  border: workflowGoal === "autoedit" ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
                  color: workflowGoal === "autoedit" ? "#60a5fa" : "#34d399",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: onUpdateWorkflowGoal ? "pointer" : "default",
                }}
                onClick={() => {
                  if (onUpdateWorkflowGoal) {
                    const newGoal = workflowGoal === "autoedit" ? "clips" : "autoedit";
                    void onUpdateWorkflowGoal(detail.project.id, newGoal);
                    onChangeView?.(newGoal === "autoedit" ? "autoedit" : "moments");
                  }
                }}
                title={onUpdateWorkflowGoal ? `Flujo: ${workflowGoal === 'autoedit' ? 'AutoEdición YouTube' : 'Clips & Shorts'}. Haz clic para alternar flujo.` : undefined}
              >
                <span>{workflowGoal === "autoedit" ? "🎬 YouTube 16:9" : "📱 Shorts & Clips"}</span>
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

          {/* Segmented View Switcher dinámico según objetivo del proyecto */}
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

            {showClipsTab && (
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
            )}

            {showAutoEditTab && (
              <button
                type="button"
                className={`view-mode-pill ${activeView === "autoedit" ? "active" : ""}`}
                onClick={() => onChangeView?.("autoedit")}
                title="Sección de montaje automático con IA y galería de autoedits para YouTube"
              >
                <Zap size={13} />
                <span>AutoEdición con IA</span>
              </button>
            )}

            <button
              type="button"
              className="view-mode-pill"
              onClick={() => setShowAllTabs(!showAllTabs)}
              title={showAllTabs ? "Mostrar solo las pestañas del flujo actual" : "Ver todas las herramientas (Clips y AutoEdición)"}
              style={{
                padding: "0 7px",
                fontSize: "0.72rem",
                opacity: showAllTabs ? 1 : 0.6,
                color: showAllTabs ? "var(--accent-primary)" : "var(--text-secondary)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {showAllTabs ? "✕" : "+"}
            </button>
          </div>

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
