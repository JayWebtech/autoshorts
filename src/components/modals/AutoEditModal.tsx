import React, { useState } from "react";
import {
  X,
  Zap,
  Scissors,
  Video,
  Smartphone,
  Check,
  FolderOpen,
  Play,
  Copy,
  Clock,
  Loader2,
  Layers,
  Sparkles,
  FileText,
  Shuffle,
  Crosshair,
  Flame,
  Wand2,
  Maximize2,
  Monitor
} from "lucide-react";
import { Project, AutoEditResult, AutoEditAssemblyStyle, AutoEditAspectRatio } from "../../types";

interface AutoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  candidateCount: number;
  formatMode: "youtube" | "shorts";
  setFormatMode: (mode: "youtube" | "shorts") => void;
  aspectRatio?: AutoEditAspectRatio;
  setAspectRatio?: (ar: AutoEditAspectRatio) => void;
  targetMinutes: number;
  setTargetMinutes: (mins: number) => void;
  assemblyStyle?: AutoEditAssemblyStyle;
  setAssemblyStyle?: (style: AutoEditAssemblyStyle) => void;
  includeTeaser: boolean;
  setIncludeTeaser: (val: boolean) => void;
  trimSilences: boolean;
  setTrimSilences: (val: boolean) => void;
  status: "idle" | "rendering" | "done";
  progressMsg: string;
  progressPct: number;
  result: AutoEditResult | null;
  onStartAutoEdit: () => Promise<void>;
  onCancelAutoEdit: () => void;
  onOpenFolder?: (path: string) => void;
  onOpenFile?: (path: string) => void;
}

export function AutoEditModal({
  isOpen,
  onClose,
  project,
  candidateCount,
  formatMode,
  setFormatMode,
  targetMinutes,
  setTargetMinutes,
  aspectRatio = "original",
  setAspectRatio,
  assemblyStyle = "balanced",
  setAssemblyStyle,
  includeTeaser,
  setIncludeTeaser,
  trimSilences,
  setTrimSilences,
  status,
  progressMsg,
  progressPct,
  result,
  onStartAutoEdit,
  onCancelAutoEdit,
  onOpenFolder,
  onOpenFile
}: AutoEditModalProps) {
  const [copiedChapters, setCopiedChapters] = useState(false);

  if (!isOpen) return null;

  const allDurations = [1, 2, 3, 4, 5, 8, 10, 12, 15, 20, 25, 30];

  const handleCopyChapters = async () => {
    if (!result?.chaptersText) return;
    try {
      await navigator.clipboard.writeText(result.chaptersText);
      setCopiedChapters(true);
      setTimeout(() => setCopiedChapters(false), 2000);
    } catch (e) {
      console.error("Error al copiar capítulos:", e);
    }
  };

  const formatDurationDisplay = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  };

  return (
    <div className="autoedit-modal-overlay">
      <div className="autoedit-modal">
        {/* Header */}
        <div className="autoedit-modal-header">
          <div className="autoedit-header-title-box">
            <div className="autoedit-icon-badge">
              <Zap size={18} />
            </div>
            <div>
              <h3>AutoEdición con IA</h3>
              <p>Montaje base ensamblado (Rough Cut / A-Roll) listo para post-producción</p>
            </div>
          </div>
          <button
            className="autoedit-close-btn"
            onClick={onClose}
            disabled={status === "rendering"}
            title="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="autoedit-modal-body">
          {status !== "done" ? (
            <>
              {/* Formato de destino */}
              <div className="autoedit-section">
                <label className="autoedit-section-label">
                  <Layers size={14} /> Formato de Destino
                </label>
                <div className="autoedit-format-grid">
                  <button
                    type="button"
                    className={`autoedit-format-card ${formatMode === "youtube" ? "active" : ""}`}
                    onClick={() => {
                      if (status === "rendering") return;
                      setFormatMode("youtube");
                    }}
                    disabled={status === "rendering"}
                  >
                    <div className="autoedit-format-card-icon">
                      <Video size={22} />
                    </div>
                    <div className="autoedit-format-card-text">
                      <span className="autoedit-format-name">Ritmo Narrativo (YouTube)</span>
                      <span className="autoedit-format-desc">
                        Estructurado por capítulos, deja respirar el contexto, desarrollo y remate.
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`autoedit-format-card ${formatMode === "shorts" ? "active" : ""}`}
                    onClick={() => {
                      if (status === "rendering") return;
                      setFormatMode("shorts");
                    }}
                    disabled={status === "rendering"}
                  >
                    <div className="autoedit-format-card-icon">
                      <Smartphone size={22} />
                    </div>
                    <div className="autoedit-format-card-text">
                      <span className="autoedit-format-name">Ritmo Dinámico (Shorts / TikTok)</span>
                      <span className="autoedit-format-desc">
                        Cortes rápidos y continuos con alta velocidad narrativa sin pausas.
                      </span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Relación de Aspecto */}
              {setAspectRatio && (
                <div className="autoedit-section">
                  <label className="autoedit-section-label">
                    <Maximize2 size={14} /> Relación de Aspecto
                  </label>
                  <div className="autoedit-durations-row">
                    {[
                      { id: "original" as AutoEditAspectRatio, label: "Nativo del Video", icon: Maximize2 },
                      { id: "9:16" as AutoEditAspectRatio, label: "Vertical (9:16)", icon: Smartphone },
                      { id: "16:9" as AutoEditAspectRatio, label: "Horizontal (16:9)", icon: Monitor }
                    ].map((ar) => {
                      const isSelected = aspectRatio === ar.id;
                      const IconComponent = ar.icon;
                      return (
                        <button
                          key={ar.id}
                          type="button"
                          className={`autoedit-dur-chip ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (status === "rendering") return;
                            setAspectRatio(ar.id);
                          }}
                          disabled={status === "rendering"}
                        >
                          <IconComponent size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />
                          {ar.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Duración Objetivo */}
              <div className="autoedit-section">
                <label className="autoedit-section-label">
                  <Clock size={14} /> Duración Objetivo
                </label>
                <div className="autoedit-durations-row">
                  {allDurations.map((d) => {
                    const isSelected = targetMinutes === d;
                    const label = d === 1 ? "1 min" : `${d} min`;
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`autoedit-dur-chip ${isSelected ? "active" : ""}`}
                        onClick={() => {
                          if (status === "rendering") return;
                          setTargetMinutes(d);
                        }}
                        disabled={status === "rendering"}
                      >
                        {isSelected && <Check size={13} className="chip-check" />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Orquestación de la IA */}
              {setAssemblyStyle && (
                <div className="autoedit-section">
                  <label className="autoedit-section-label">
                    <Wand2 size={14} /> Orquestación de la IA
                  </label>
                  <div className="autoedit-durations-row">
                    {[
                      { id: "balanced" as AutoEditAssemblyStyle, label: "Mezcla Épica", icon: Sparkles },
                      { id: "smart_shuffle" as AutoEditAssemblyStyle, label: "Mezcla Dinámica", icon: Shuffle },
                      { id: "alternative" as AutoEditAssemblyStyle, label: "Nueva Variación", icon: Layers },
                      { id: "action" as AutoEditAssemblyStyle, label: "Clutches & Acción", icon: Crosshair },
                      { id: "humor" as AutoEditAssemblyStyle, label: "Risas & Comedia", icon: Flame },
                      { id: "chronological" as AutoEditAssemblyStyle, label: "Cronológico", icon: Clock },
                    ].map((st) => {
                      const isSelected = assemblyStyle === st.id;
                      const IconC = st.icon;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          className={`autoedit-dur-chip ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (status === "rendering") return;
                            setAssemblyStyle(st.id);
                          }}
                          disabled={status === "rendering"}
                        >
                          <IconC size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />
                          {st.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Opciones Inteligentes */}
              <div className="autoedit-section">
                <label className="autoedit-section-label">
                  <Sparkles size={14} /> Estructura y Poda de Video
                </label>
                <div className="autoedit-options-list">
                  {/* Hook Teaser */}
                  <label className="autoedit-toggle-item">
                    <input
                      type="checkbox"
                      checked={includeTeaser}
                      onChange={(e) => setIncludeTeaser(e.target.checked)}
                      disabled={status === "rendering"}
                    />
                    <div className="autoedit-toggle-custom">
                      <div className="toggle-indicator" />
                    </div>
                    <div className="autoedit-toggle-text">
                      <div className="autoedit-toggle-title">
                        <Zap size={14} /> Hook Teaser Inicial (3 a 5 seg)
                      </div>
                      <div className="autoedit-toggle-sub">
                        Coloca un bocado del momento más impactante del stream al puro inicio con micro-fundido.
                      </div>
                    </div>
                  </label>

                  {/* Poda de Silencios */}
                  <label className="autoedit-toggle-item">
                    <input
                      type="checkbox"
                      checked={trimSilences}
                      onChange={(e) => setTrimSilences(e.target.checked)}
                      disabled={status === "rendering"}
                    />
                    <div className="autoedit-toggle-custom">
                      <div className="toggle-indicator" />
                    </div>
                    <div className="autoedit-toggle-text">
                      <div className="autoedit-toggle-title">
                        <Scissors size={14} /> Poda de Silencios Muertos (Jump-Cuts)
                      </div>
                      <div className="autoedit-toggle-sub">
                        Elimina automáticamente pausas vacías mayores a 1.8 segundos para mantener dinamismo continuo.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Mensaje de progreso durante rendering */}
              {status === "rendering" && (
                <div className="autoedit-progress-box">
                  <div className="autoedit-progress-header">
                    <span className="autoedit-progress-msg">
                      <Loader2 size={14} className="spin" /> {progressMsg || "Procesando video..."}
                    </span>
                    <span className="autoedit-progress-val">{progressPct}%</span>
                  </div>
                  <div className="autoedit-progress-bar-bg">
                    <div
                      className="autoedit-progress-bar-fill"
                      style={{ width: `${Math.max(5, progressPct)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Vista de resultado completado */
            result && (
              <div className="autoedit-result-container">
                <div className="autoedit-success-badge">
                  <Check size={20} />
                  <div>
                    <h4>Montaje Ensamblado Exitosamente</h4>
                    <p>El corte en bruto está listo para importar a tu editor o reproducir.</p>
                  </div>
                </div>

                <div className="autoedit-result-meta-card">
                  <div className="result-meta-row">
                    <span className="meta-label">Archivo:</span>
                    <span className="meta-value filename">{result.filename}</span>
                  </div>
                  <div className="result-meta-row">
                    <span className="meta-label">Duración:</span>
                    <span className="meta-value">{formatDurationDisplay(result.duration)}</span>
                  </div>
                  <div className="result-meta-row">
                    <span className="meta-label">Formato:</span>
                    <span className="meta-value format">
                      {result.formatMode === "youtube" ? "YouTube (16:9)" : "Shorts / TikTok (9:16)"}
                    </span>
                  </div>
                </div>

                {/* Vista previa de Capítulos generados */}
                {result.chaptersText && (
                  <div className="autoedit-chapters-preview-box">
                    <div className="chapters-header">
                      <span className="chapters-title">
                        <FileText size={14} /> Capítulos para YouTube
                      </span>
                      <button
                        type="button"
                        className="copy-chapters-btn"
                        onClick={handleCopyChapters}
                      >
                        {copiedChapters ? <Check size={13} /> : <Copy size={13} />}
                        {copiedChapters ? "Copiado!" : "Copiar"}
                      </button>
                    </div>
                    <pre className="chapters-pre">{result.chaptersText}</pre>
                  </div>
                )}

                {/* Acciones del resultado */}
                <div className="autoedit-result-actions">
                  {onOpenFile && (
                    <button
                      type="button"
                      className="autoedit-btn secondary"
                      onClick={() => onOpenFile(result.videoPath)}
                    >
                      <Play size={15} /> Reproducir
                    </button>
                  )}
                  {onOpenFolder && (
                    <button
                      type="button"
                      className="autoedit-btn secondary"
                      onClick={() => onOpenFolder(result.outputDir)}
                    >
                      <FolderOpen size={15} /> Abrir Carpeta
                    </button>
                  )}
                  <button
                    type="button"
                    className="autoedit-btn primary"
                    onClick={onClose}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        {status !== "done" && (
          <div className="autoedit-modal-footer">
            <div className="autoedit-footer-info">
              {candidateCount} momentos disponibles en el stream
            </div>
            <div className="autoedit-footer-actions">
              {status === "rendering" ? (
                <button
                  type="button"
                  className="autoedit-btn cancel"
                  onClick={onCancelAutoEdit}
                >
                  <X size={15} /> Cancelar Proceso
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="autoedit-btn secondary"
                    onClick={onClose}
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    className="autoedit-btn primary"
                    onClick={onStartAutoEdit}
                  >
                    <Zap size={15} /> Generar Video Ensamblado (.mp4)
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
