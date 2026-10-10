import React from "react";
import {
  Zap,
  Video,
  Clock,
  Scissors,
  Sparkles,
  Shuffle,
  Crosshair,
  Flame,
  Layers,
  Check,
  X,
  Loader2,
  Wand2,
  Maximize2,
  Smartphone,
  Monitor
} from "lucide-react";
import { AutoEditAssemblyStyle, AutoEditAspectRatio } from "../../../types";

interface AutoEditConfigPanelProps {
  formatMode: "youtube" | "shorts";
  setFormatMode: (mode: "youtube" | "shorts") => void;
  aspectRatio: AutoEditAspectRatio;
  setAspectRatio: (ar: AutoEditAspectRatio) => void;
  targetDurationMinutes: number;
  setTargetDurationMinutes: (m: number) => void;
  assemblyStyle: AutoEditAssemblyStyle;
  setAssemblyStyle: (style: AutoEditAssemblyStyle) => void;
  includeTeaser: boolean;
  setIncludeTeaser: (val: boolean) => void;
  trimSilences: boolean;
  setTrimSilences: (val: boolean) => void;
  isRendering: boolean;
  renderingPercentage: number;
  renderingMessage: string;
  onAssemble: () => void;
  onCancel: () => void;
}

const ALL_DURATIONS = [1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30];

const ASSEMBLY_STYLES: {
  id: AutoEditAssemblyStyle;
  name: string;
  badge: string;
  desc: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    id: "balanced",
    name: "Mezcla Épica",
    badge: "Equilibrado",
    desc: "Gancho estelar, progresión de tensión y remate clímax.",
    icon: Sparkles
  },
  {
    id: "smart_shuffle",
    name: "Mezcla Dinámica",
    badge: "Variación IA",
    desc: "Orquestación aleatoria con IA: combina diferentes mejores momentos.",
    icon: Shuffle
  },
  {
    id: "alternative",
    name: "Nueva Variación",
    badge: "Sin Repetir",
    desc: "Excluye momentos usados en tus autoedits previos de este stream.",
    icon: Layers
  },
  {
    id: "action",
    name: "Clutches & Acción",
    badge: "Combate",
    desc: "Prioriza bajas, disparos detectados y jugadas intensas.",
    icon: Crosshair
  },
  {
    id: "humor",
    name: "Risas & Comedia",
    badge: "Diversión",
    desc: "Prioriza risas del streamer, carcajadas y momentos cómicos.",
    icon: Flame
  },
  {
    id: "chronological",
    name: "Flujo Cronológico",
    badge: "Historia",
    desc: "Ensambla los mejores momentos en el orden temporal del stream.",
    icon: Clock
  }
];

export const AutoEditConfigPanel: React.FC<AutoEditConfigPanelProps> = ({
  formatMode,
  setFormatMode,
  aspectRatio,
  setAspectRatio,
  targetDurationMinutes,
  setTargetDurationMinutes,
  assemblyStyle,
  setAssemblyStyle,
  includeTeaser,
  setIncludeTeaser,
  trimSilences,
  setTrimSilences,
  isRendering,
  renderingPercentage,
  renderingMessage,
  onAssemble,
  onCancel
}) => {
  return (
    <aside className="autoedit-config-panel">
      <div className="panel-header-clean">
        <div className="title-row">
          <Zap className="icon-accent" size={18} />
          <h3>Nuevo Montaje con IA</h3>
        </div>
        <p className="subtitle">
          Configura y orquesta un video ensamblado con los mejores momentos de tu stream.
        </p>
      </div>

      <div className="config-scroll-body">
        {/* Editorial Rhythm Mode */}
        <div className="config-section">
          <label className="section-label">
            <Video size={14} /> Ritmo y Enfoque Narrativo
          </label>
          <div className="format-cards-grid">
            <button
              type="button"
              className={`format-card ${formatMode === "youtube" ? "active" : ""}`}
              onClick={() => setFormatMode("youtube")}
              disabled={isRendering}
            >
              <div className="format-card-header">
                <Video size={18} />
                <span className="aspect-badge">Capítulos</span>
              </div>
              <div className="format-title">Ritmo Narrativo</div>
              <div className="format-desc">Ideal para YouTube o compilaciones. Da espacio para setup, jugada y remate.</div>
            </button>

            <button
              type="button"
              className={`format-card ${formatMode === "shorts" ? "active" : ""}`}
              onClick={() => setFormatMode("shorts")}
              disabled={isRendering}
            >
              <div className="format-card-header">
                <Zap size={18} />
                <span className="aspect-badge">Ágil</span>
              </div>
              <div className="format-title">Ritmo Dinámico</div>
              <div className="format-desc">Ideal para Shorts, Reels o TikTok. Cortes continuos y alta retención sin pausas.</div>
            </button>
          </div>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="config-section">
          <label className="section-label">
            <Maximize2 size={14} /> Relación de Aspecto
          </label>
          <div className="aspect-ratio-row">
            <button
              type="button"
              className={`aspect-chip ${aspectRatio === "original" ? "active" : ""}`}
              onClick={() => setAspectRatio("original")}
              disabled={isRendering}
            >
              <Maximize2 size={13} />
              <span>Original del Video (Nativo)</span>
            </button>
            <button
              type="button"
              className={`aspect-chip ${aspectRatio === "9:16" ? "active" : ""}`}
              onClick={() => setAspectRatio("9:16")}
              disabled={isRendering}
            >
              <Smartphone size={13} />
              <span>Vertical (9:16)</span>
            </button>
            <button
              type="button"
              className={`aspect-chip ${aspectRatio === "16:9" ? "active" : ""}`}
              onClick={() => setAspectRatio("16:9")}
              disabled={isRendering}
            >
              <Monitor size={13} />
              <span>Horizontal (16:9)</span>
            </button>
          </div>
          <p className="field-hint">
            Por defecto, el montaje respeta la resolución nativa de tu video fuente sin recortes no deseados.
          </p>
        </div>

        {/* Target Duration Chips */}
        <div className="config-section">
          <label className="section-label">
            <Clock size={14} /> Duración Objetivo
          </label>
          <div className="duration-chips-row">
            {ALL_DURATIONS.map((dur) => (
              <button
                key={dur}
                type="button"
                className={`duration-chip ${targetDurationMinutes === dur ? "active" : ""}`}
                onClick={() => setTargetDurationMinutes(dur)}
                disabled={isRendering}
              >
                {dur} {dur === 1 ? "minuto" : "minutos"}
              </button>
            ))}
          </div>
          <p className="field-hint">
            Puedes generar videos de cualquier duración (ej. 20 min en vertical o 3 min en horizontal) con plena libertad.
          </p>
        </div>

        {/* AI Assembly Orchestration Style */}
        <div className="config-section">
          <label className="section-label">
            <Wand2 size={14} /> Orquestación de la IA
          </label>
          <div className="assembly-styles-grid">
            {ASSEMBLY_STYLES.map((style) => {
              const IconComp = style.icon;
              const isSelected = assemblyStyle === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  className={`style-option-card ${isSelected ? "active" : ""}`}
                  onClick={() => setAssemblyStyle(style.id)}
                  disabled={isRendering}
                >
                  <div className="style-option-header">
                    <div className="style-option-title-row">
                      <IconComp size={15} className="style-icon" />
                      <span className="style-name">{style.name}</span>
                    </div>
                    <span className="style-badge">{style.badge}</span>
                  </div>
                  <div className="style-desc">{style.desc}</div>
                </button>
              );
            })}
          </div>
          <p className="field-hint">
            La IA analizará los momentos, los diálogos y los disparos para secuenciar el video según el estilo seleccionado.
          </p>
        </div>

        {/* Editorial Options */}
        <div className="config-section">
          <label className="section-label">
            <Sparkles size={14} /> Opciones Editoriales
          </label>
          <div className="toggles-column">
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={includeTeaser}
                onChange={(e) => setIncludeTeaser(e.target.checked)}
                disabled={isRendering}
              />
              <div className="toggle-info">
                <span className="toggle-title">Teaser Hook al inicio</span>
                <span className="toggle-desc">
                  Agrega un fragmento de 3-5s de la jugada o remate más impactante antes de empezar.
                </span>
              </div>
            </label>

            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={trimSilences}
                onChange={(e) => setTrimSilences(e.target.checked)}
                disabled={isRendering}
              />
              <div className="toggle-info">
                <span className="toggle-title">Recortar silencios (Jump Cuts)</span>
                <span className="toggle-desc">
                  Elimina pausas muertas manteniendo la duración objetivo mediante compensación inteligente.
                </span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Footer / Assembly Action & Progress */}
      <div className="config-footer">
        {isRendering ? (
          <div className="rendering-status-box">
            <div className="status-top">
              <Loader2 className="spinner" size={16} />
              <span className="status-msg">{renderingMessage || "Procesando montaje..."}</span>
              <span className="status-pct">{renderingPercentage}%</span>
            </div>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.max(5, renderingPercentage)}%` }}
              />
            </div>
            <button
              type="button"
              className="cancel-btn-clean"
              onClick={onCancel}
            >
              <X size={14} /> Cancelar Proceso
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="assemble-submit-btn"
            onClick={onAssemble}
          >
            <Zap size={16} /> Ensamblar Video con IA
          </button>
        )}
      </div>
    </aside>
  );
};
