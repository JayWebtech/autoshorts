import React, { useState } from "react";
import {
  Play,
  Folder,
  Trash2,
  Copy,
  Check,
  Video,
  Zap,
  Sparkles,
  Clock,
  FileText,
  Hash,
  Layers,
  Loader2
} from "lucide-react";
import { AutoEditRecord } from "../../../types";

interface AutoEditGalleryPanelProps {
  autoedits: AutoEditRecord[];
  isLoading: boolean;
  onPlay: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onDelete: (id: string) => void;
  onGenerateCopy: (id: string) => void;
  isGeneratingCopyId: string | null;
}

export const AutoEditGalleryPanel: React.FC<AutoEditGalleryPanelProps> = ({
  autoedits,
  isLoading,
  onPlay,
  onOpenFolder,
  onDelete,
  onGenerateCopy,
  isGeneratingCopyId
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  const formatDuration = (sec?: number | null, fallbackTarget?: number) => {
    const s = sec && sec > 0 ? sec : (fallbackTarget || 0);
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  };

  return (
    <section className="autoedit-gallery-panel">
      <div className="panel-header-clean">
        <div className="title-row">
          <Layers className="icon-accent" size={18} />
          <h3>Montajes Generados</h3>
          <span className="count-pill">{autoedits.length}</span>
        </div>
        <p className="subtitle">
          Videos ensamblados listos para importar a tu editor, previsualizar o copiar sus datos a redes.
        </p>
      </div>

      <div className="gallery-scroll-container">
        {isLoading ? (
          <div className="gallery-loading">
            <Loader2 className="spinner" size={24} />
            <span>Cargando montajes...</span>
          </div>
        ) : autoedits.length === 0 ? (
          <div className="gallery-empty-state">
            <div className="empty-icon-box">
              <Video size={36} />
            </div>
            <h4>Sin montajes aún</h4>
            <p>
              Elige el formato y duración en el panel izquierdo y haz clic en{" "}
              <strong>Ensamblar Video con IA</strong> para generar tu primer video base.
            </p>
          </div>
        ) : (
          <div className="gallery-cards-list">
            {autoedits.map((item) => {
              const isShorts = item.formatMode === "shorts";
              const isGenerating = isGeneratingCopyId === item.id;

              return (
                <article key={item.id} className="autoedit-card">
                  {/* Top bar of the card */}
                  <div className="card-top-bar">
                    <div className="badges-group">
                      <span className={`format-pill ${isShorts ? "shorts" : "youtube"}`}>
                        {isShorts ? <Zap size={12} /> : <Video size={12} />}
                        {isShorts ? "Shorts / TikTok (9:16)" : "YouTube (16:9)"}
                      </span>
                      <span className="meta-pill">
                        <Clock size={12} />
                        {formatDuration(item.actualDurationSec, item.targetDurationSec)}
                      </span>
                      {item.fileSizeMb && item.fileSizeMb > 0 ? (
                        <span className="meta-pill">{item.fileSizeMb} MB</span>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      className="icon-action-btn delete"
                      title="Eliminar este montaje"
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Main video header and actions */}
                  <div className="card-media-row">
                    <div className="video-title-area">
                      <h4 className="video-filename">{item.filename || "Video Ensamblado"}</h4>
                      <div className="video-created-date">{item.createdAt}</div>
                    </div>

                    <div className="video-action-buttons">
                      <button
                        type="button"
                        className="btn-play-video"
                        onClick={() => onPlay(item.outputPath)}
                      >
                        <Play size={14} /> Reproducir
                      </button>
                      <button
                        type="button"
                        className="btn-open-folder"
                        onClick={() => onOpenFolder(item.outputPath)}
                      >
                        <Folder size={14} /> Abrir Carpeta
                      </button>
                    </div>
                  </div>

                  {/* Social Copy & Metadata Section */}
                  <div className="card-copy-hub">
                    <div className="hub-header">
                      <div className="hub-title">
                        <Sparkles size={14} /> Copy y Metadatos para Redes
                      </div>
                      <button
                        type="button"
                        className="regenerate-copy-btn"
                        onClick={() => onGenerateCopy(item.id)}
                        disabled={isGenerating}
                        title="Regenerar título y copy con IA"
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="spinner" size={12} /> Generando...
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} /> Regenerar con IA
                          </>
                        )}
                      </button>
                    </div>

                    {/* Title Box */}
                    {item.title ? (
                      <div className="copy-field-box">
                        <div className="field-header">
                          <span className="field-name">
                            <FileText size={12} /> Título Sugerido
                          </span>
                          <button
                            type="button"
                            className="copy-btn-tiny"
                            onClick={() => handleCopy(item.title || "", `title-${item.id}`)}
                          >
                            {copiedKey === `title-${item.id}` ? (
                              <>
                                <Check size={12} /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy size={12} /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                        <div className="field-content-preview">{item.title}</div>
                      </div>
                    ) : null}

                    {/* Description Box */}
                    {item.description ? (
                      <div className="copy-field-box">
                        <div className="field-header">
                          <span className="field-name">
                            <FileText size={12} /> Descripción del Video
                          </span>
                          <button
                            type="button"
                            className="copy-btn-tiny"
                            onClick={() => handleCopy(item.description || "", `desc-${item.id}`)}
                          >
                            {copiedKey === `desc-${item.id}` ? (
                              <>
                                <Check size={12} /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy size={12} /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                        <div className="field-content-preview multiline">{item.description}</div>
                      </div>
                    ) : null}

                    {/* Hashtags Box */}
                    {item.hashtags ? (
                      <div className="copy-field-box">
                        <div className="field-header">
                          <span className="field-name">
                            <Hash size={12} /> Hashtags
                          </span>
                          <button
                            type="button"
                            className="copy-btn-tiny"
                            onClick={() => handleCopy(item.hashtags || "", `tags-${item.id}`)}
                          >
                            {copiedKey === `tags-${item.id}` ? (
                              <>
                                <Check size={12} /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy size={12} /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                        <div className="field-content-preview hashtags">{item.hashtags}</div>
                      </div>
                    ) : null}

                    {/* YouTube Chapters */}
                    {item.chaptersText ? (
                      <div className="copy-field-box chapters">
                        <div className="field-header">
                          <span className="field-name">
                            <Layers size={12} /> Capítulos de YouTube
                          </span>
                          <button
                            type="button"
                            className="copy-btn-tiny"
                            onClick={() => handleCopy(item.chaptersText || "", `chaps-${item.id}`)}
                          >
                            {copiedKey === `chaps-${item.id}` ? (
                              <>
                                <Check size={12} /> Copiado
                              </>
                            ) : (
                              <>
                                <Copy size={12} /> Copiar
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="field-content-preview chapters-code">{item.chaptersText}</pre>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
