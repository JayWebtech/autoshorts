import React from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clapperboard,
  FileVideo,
  Loader2,
  SlidersHorizontal,
  Youtube,
} from "lucide-react";
import { BusyState, Project } from "../../types";
import { fileName } from "../../utils/format";

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onImportMedia: () => Promise<void>;
  onOpenYoutubeModal: () => void;
  busy: BusyState;
  hasYtdlp: boolean;
  showSettings: boolean;
  onToggleSettings: () => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onImportMedia,
  onOpenYoutubeModal,
  busy,
  hasYtdlp,
  showSettings,
  onToggleSettings,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <Clapperboard size={20} className="brand-logo" />
        <div>
          <h1>AutoShorts</h1>
          <p>Long recording in. Short clips out.</p>
        </div>
      </div>

      <button
        className="primary-action"
        onClick={() => void onImportMedia()}
        disabled={busy !== "idle"}
      >
        {busy === "import" ? <Loader2 className="spin" size={16} /> : <FileVideo size={16} />}
        <span>Importar Grabación</span>
      </button>

      <button
        type="button"
        className="secondary-action"
        onClick={onOpenYoutubeModal}
        disabled={busy !== "idle" || !hasYtdlp}
        title={!hasYtdlp ? "Instala yt-dlp para habilitar esta función" : "Descargar video desde YouTube"}
        style={{ marginTop: "4px" }}
      >
        <Youtube size={16} />
        <span>Importar de YouTube</span>
      </button>

      <section className="project-list" aria-label="Projects">
        <button
          className={`project-row ${!activeProjectId ? "active" : ""}`}
          onClick={() => onSelectProject(null)}
        >
          <Clapperboard size={14} />
          <span>Todos los Proyectos</span>
          <ChevronRight size={13} />
        </button>

        {projects.map((project) => {
          const isCompleted = project.status === "completed";
          const isMissing = project.sourceExists === false;
          return (
            <button
              key={project.id}
              className={`project-row ${activeProjectId === project.id ? "active" : ""}`}
              onClick={() => onSelectProject(project.id)}
            >
              <FileVideo
                size={15}
                style={{ color: isMissing ? "#fbbf24" : isCompleted ? "#34d399" : undefined }}
              />
              <span style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project.name || fileName(project.sourcePath)}
                </span>
                {isMissing ? (
                  <span title="Video no encontrado en la ruta original" style={{ display: "inline-flex", flexShrink: 0 }}>
                    <AlertTriangle size={12} color="#fbbf24" />
                  </span>
                ) : isCompleted ? (
                  <Check
                    size={13}
                    color="#34d399"
                    style={{ flexShrink: 0 }}
                  />
                ) : null}
              </span>
              <ChevronRight size={14} />
            </button>
          );
        })}
      </section>

      <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
        <button
          type="button"
          className={`project-row ${showSettings ? "active" : ""}`}
          onClick={onToggleSettings}
          title="Configuración de Modelos e IA"
          style={{
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            background: showSettings ? "rgba(16, 185, 129, 0.15)" : "transparent"
          }}
        >
          <SlidersHorizontal size={16} />
          <span>Configuración & APIs</span>
        </button>
      </div>
    </aside>
  );
}
