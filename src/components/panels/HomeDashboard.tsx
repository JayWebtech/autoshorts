import React, { useMemo, useState } from "react";
import {
  FileVideo,
  Youtube,
  SlidersHorizontal,
  Clapperboard,
  Loader2,
  Check,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  FolderSearch,
  FolderOpen,
  Sparkles,
} from "lucide-react";
import type { Project, BusyState, EnvironmentStatus } from "../../types";
import { fileName, formatTime } from "../../utils/format";

interface HomeDashboardProps {
  projects: Project[];
  busy: BusyState;
  environment: EnvironmentStatus | null;
  showSettings: boolean;
  setShowSettings: (val: boolean) => void;
  importMedia: () => void;
  setYoutubeModalOpen: (val: boolean) => void;
  selectProject: (id: string) => void;
  renameProject: (id: string) => void;
  deleteProject: (id: string) => void;
  toggleProjectCompleted: (id: string) => void;
  relinkProjectVideo: (id: string) => void;
  openProjectFolder: (id: string) => void;
  onOpenQuickCopy?: () => void;
  settingsNode?: React.ReactNode;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  projects,
  busy,
  environment,
  showSettings,
  setShowSettings,
  importMedia,
  setYoutubeModalOpen,
  selectProject,
  renameProject,
  deleteProject,
  toggleProjectCompleted,
  relinkProjectVideo,
  openProjectFolder,
  onOpenQuickCopy,
  settingsNode,
}) => {
  const [filterTab, setFilterTab] = useState<"all" | "in_progress" | "completed">("all");

  const inProgressCount = useMemo(
    () => projects.filter((p) => p.status !== "completed").length,
    [projects]
  );
  const completedCount = useMemo(
    () => projects.filter((p) => p.status === "completed").length,
    [projects]
  );

  const filteredProjects = useMemo(() => {
    if (filterTab === "in_progress") return projects.filter((p) => p.status !== "completed");
    if (filterTab === "completed") return projects.filter((p) => p.status === "completed");
    return projects;
  }, [projects, filterTab]);

  return (
    <div className="home-dashboard">
      <header className="home-header">
        <div>
          <h2>Todos los Proyectos</h2>
          <p>Selecciona un proyecto o importa un nuevo video para comenzar.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
          {onOpenQuickCopy && (
            <button
              className="secondary-action compact"
              onClick={onOpenQuickCopy}
              disabled={busy !== "idle"}
              title="Generar copy persuasivo pegando una transcripción o desde archivo"
            >
              <Sparkles size={16} />
              <span>Generar Copy Rápido</span>
            </button>
          )}
          <button className="primary-action compact" onClick={importMedia} disabled={busy !== "idle"}>
            {busy === "import" ? <Loader2 className="spin" size={16} /> : <FileVideo size={16} />}
            <span>Importar Grabación</span>
          </button>
          <button
            className="secondary-action compact"
            onClick={() => setYoutubeModalOpen(true)}
            disabled={busy !== "idle" || !environment?.hasYtdlp}
            title={!environment?.hasYtdlp ? "Instala yt-dlp para habilitar esta función" : "Descargar video desde YouTube"}
          >
            <Youtube size={16} />
            <span>Importar de YouTube</span>
          </button>
          <button
            className={`secondary-action compact ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Configuración de Modelos e Inteligencia Artificial"
            style={{
              background: showSettings ? "var(--bg-surface-hover)" : "var(--bg-surface-raised)",
              borderColor: showSettings ? "var(--border-hover)" : "var(--border-default)",
            }}
          >
            <SlidersHorizontal size={16} />
            <span>Configuración & APIs</span>
          </button>
        </div>
      </header>

      {projects.length > 0 && (
        <div className="dashboard-filter-tabs">
          <button
            type="button"
            className={`dashboard-filter-tab ${filterTab === "all" ? "active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            <span>Todos</span>
            <span className="dashboard-filter-count">{projects.length}</span>
          </button>
          <button
            type="button"
            className={`dashboard-filter-tab ${filterTab === "in_progress" ? "active" : ""}`}
            onClick={() => setFilterTab("in_progress")}
          >
            <span>En progreso</span>
            <span className="dashboard-filter-count">{inProgressCount}</span>
          </button>
          <button
            type="button"
            className={`dashboard-filter-tab ${filterTab === "completed" ? "active" : ""}`}
            onClick={() => setFilterTab("completed")}
          >
            <span>Culminados</span>
            <span className="dashboard-filter-count">{completedCount}</span>
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty-dashboard-state">
          <Clapperboard size={48} className="empty-state-icon" />
          <h3>No projects found</h3>
          <p>Import your first recording to begin creating shorts.</p>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="empty-dashboard-state" style={{ marginTop: "24px", padding: "32px 16px" }}>
          <Clapperboard size={36} className="empty-state-icon" style={{ opacity: 0.5 }} />
          <h3 style={{ fontSize: "1rem", marginTop: "8px" }}>
            {filterTab === "completed"
              ? "No tienes proyectos culminados aún"
              : "No hay proyectos pendientes en progreso"}
          </h3>
          <p style={{ fontSize: "0.82rem", maxWidth: "380px", margin: "6px auto 0" }}>
            {filterTab === "completed"
              ? "Marca tus grabaciones con el botón 'Listo' cuando hayas terminado de editarlas para organizarlas aquí."
              : "Todos tus proyectos han sido marcados como culminados."}
          </p>
        </div>
      ) : (
        <div className="projects-grid">
          {filteredProjects.map((project) => {
            const name = project.name || fileName(project.sourcePath);
            const isCompleted = project.status === "completed";
            const isMissing = project.sourceExists === false;

            return (
              <article
                key={project.id}
                className={`project-card ${isMissing ? "is-missing" : isCompleted ? "is-completed" : ""}`}
              >
                <div className="project-card-header">
                  <FileVideo
                    size={22}
                    className="project-card-icon"
                    style={{ color: isMissing ? "#fbbf24" : isCompleted ? "#34d399" : undefined }}
                  />
                  {isMissing ? (
                    <span
                      className="project-card-status is-missing"
                      title={`No se encontró el archivo original en: ${project.sourcePath}`}
                    >
                      <AlertTriangle size={11} />
                      <span>VIDEO NO ENCONTRADO</span>
                    </span>
                  ) : isCompleted ? (
                    <span className="project-card-status is-completed">
                      <CheckCircle2 size={11} />
                      <span>CULMINADO</span>
                    </span>
                  ) : (
                    <span className="project-card-status">{project.status}</span>
                  )}
                </div>
                <h3 className="project-card-title">{name}</h3>
                <div className="project-card-meta">
                  <span>Duration: {project.sourceDuration ? formatTime(project.sourceDuration) : "Probing..."}</span>
                  <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="project-card-actions">
                  <div className="card-actions-primary">
                    <button className="action-btn open-btn" onClick={() => void selectProject(project.id)}>
                      Abrir
                    </button>
                    <button
                      className="action-btn folder-btn"
                      onClick={() => void openProjectFolder(project.id)}
                      title="Abrir carpeta de archivos del proyecto en Windows Explorer"
                    >
                      <FolderOpen size={13} />
                      <span>Carpeta</span>
                    </button>
                  </div>

                  <div className="card-actions-secondary">
                    {isMissing ? (
                      <button
                        className="action-btn relink-btn"
                        onClick={() => void relinkProjectVideo(project.id)}
                        title="Localizar y reubicar este archivo de video en tu computadora"
                      >
                        <FolderSearch size={12} />
                        <span>Localizar</span>
                      </button>
                    ) : (
                      <button
                        className={`action-btn complete-toggle-btn ${isCompleted ? "is-completed" : ""}`}
                        onClick={() => void toggleProjectCompleted(project.id)}
                        title={isCompleted ? "Reabrir proyecto como en progreso" : "Marcar proyecto como culminado / terminado"}
                      >
                        {isCompleted ? (
                          <>
                            <RotateCcw size={12} />
                            <span>Reabrir</span>
                          </>
                        ) : (
                          <>
                            <Check size={12} />
                            <span>Listo</span>
                          </>
                        )}
                      </button>
                    )}

                    <button className="action-btn rename-btn" onClick={() => void renameProject(project.id)}>
                      Renombrar
                    </button>
                    <button className="action-btn delete-btn" onClick={() => void deleteProject(project.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
