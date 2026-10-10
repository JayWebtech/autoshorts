import React from "react";
import { BadgeCheck, Clapperboard, Copy, Loader2, X } from "lucide-react";
import { ProjectDetail, SummaryResult } from "../../types";
import { formatTime, fileName } from "../../utils/format";
import { invoke } from "../../apiBridge";

interface SummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  detail: ProjectDetail;
  summaryTargetMinutes: number;
  setSummaryTargetMinutes: (val: number) => void;
  summaryAspectRatio: "original" | "9:16";
  setSummaryAspectRatio: (val: "original" | "9:16") => void;
  summaryVibe: "balanced" | "tryhard" | "funny";
  setSummaryVibe: (val: "balanced" | "tryhard" | "funny") => void;
  summaryStatus: "idle" | "rendering" | "done";
  setSummaryStatus: (val: "idle" | "rendering" | "done") => void;
  summaryProgressMsg: string;
  summaryResult: SummaryResult | null;
  setSummaryResult: (val: SummaryResult | null) => void;
  customOutputDir: string;
  onGenerateSummary: () => Promise<void>;
  copiedChapters: boolean;
  setCopiedChapters: (val: boolean) => void;
}

export function SummaryModal({
  isOpen,
  onClose,
  detail,
  summaryTargetMinutes,
  setSummaryTargetMinutes,
  summaryAspectRatio,
  setSummaryAspectRatio,
  summaryVibe,
  setSummaryVibe,
  summaryStatus,
  setSummaryStatus,
  summaryProgressMsg,
  summaryResult,
  setSummaryResult,
  customOutputDir,
  onGenerateSummary,
  copiedChapters,
  setCopiedChapters,
}: SummaryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="summary-modal-overlay">
      <div className="summary-modal" style={{ background: "var(--bg-surface-raised)", border: "1px solid var(--border-default)", borderRadius: "12px" }}>
        <div className="summary-modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-default)", padding: "1.25rem 1.5rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>Autoedición y Resumen de Stream</h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-secondary)" }}>Compila y une automáticamente los mejores momentos en un único video listo para subir a YouTube o editar.</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => {
              if (summaryStatus !== "rendering") {
                onClose();
                setSummaryStatus("idle");
              }
            }}
            disabled={summaryStatus === "rendering"}
            title="Cerrar modal"
          >
            <X size={15} />
          </button>
        </div>

        <div className="summary-stats-box" style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border-default)" }}>
          <div className="summary-stat-item">
            <div className="stat-val" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{detail.candidates.length}</div>
            <div className="stat-lbl">Momentos Detectados</div>
          </div>
          <div className="summary-stat-item">
            <div className="stat-val" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {formatTime(detail.candidates.reduce((acc, c) => acc + (c.endSec - c.startSec), 0))}
            </div>
            <div className="stat-lbl">Duración Total Momentos</div>
          </div>
          <div className="summary-stat-item">
            <div className="stat-val" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{summaryTargetMinutes} min</div>
            <div className="stat-lbl">Objetivo Resumen</div>
          </div>
        </div>

        {summaryStatus === "idle" && (
          <div style={{ padding: "1.25rem 1.5rem" }}>
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                Duración Objetivo del Video Resumen:
              </label>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                {[
                  { val: 3, label: "3 min (Rápido)" },
                  { val: 5, label: "5 min (Compacto)" },
                  { val: 8, label: "8 min (YouTube Estándar)" },
                  { val: 10, label: "10 min (Extendido)" },
                  { val: 15, label: "15 min (Completo)" },
                ].map((opt) => {
                  const active = summaryTargetMinutes === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => setSummaryTargetMinutes(opt.val)}
                      style={{
                        padding: "0.45rem 0.85rem",
                        borderRadius: "6px",
                        border: active ? "1px solid #fafafa" : "1px solid var(--border-default)",
                        background: active ? "#fafafa" : "var(--bg-surface)",
                        color: active ? "#09090b" : "var(--text-secondary)",
                        cursor: "pointer",
                        fontWeight: active ? 600 : 400,
                        fontSize: "0.82rem",
                        fontFamily: "var(--font-mono)",
                        fontVariantNumeric: "tabular-nums",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: "0.4rem 0 0", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                La IA elegirá el momento con mayor impacto como intro teaser y concatenará cronológicamente los mejores momentos del stream hasta alcanzar la duración deseada.
              </p>
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                Estilo de Autoedición (Vibe de la IA):
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.6rem" }}>
                {[
                  { id: "balanced", title: "Equilibrado", desc: "Mezcla fluida de jugadas, humor y narrativa del stream." },
                  { id: "tryhard", title: "Tryhard / Épico", desc: "Prioriza kills, clutches y máxima tensión con silencios de concentración." },
                  { id: "funny", title: "Risas y Fails", desc: "Prioriza risas, troleos, fallos cómicos e interacciones con el chat." },
                ].map((v) => {
                  const active = summaryVibe === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSummaryVibe(v.id as any)}
                      style={{
                        padding: "0.6rem 0.75rem",
                        borderRadius: "6px",
                        border: active ? "1.5px solid #fafafa" : "1px solid var(--border-default)",
                        background: active ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                        color: active ? "#fafafa" : "var(--text-secondary)",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{v.title}</span>
                      <span style={{ fontSize: "0.72rem", opacity: 0.75, lineHeight: 1.25 }}>{v.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                Relación de Aspecto del Video:
              </label>
              <div style={{ display: "flex", gap: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => setSummaryAspectRatio("original")}
                  style={{
                    flex: 1,
                    padding: "0.6rem 0.8rem",
                    borderRadius: "6px",
                    border: summaryAspectRatio === "original" ? "1.5px solid #fafafa" : "1px solid var(--border-default)",
                    background: summaryAspectRatio === "original" ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                    color: summaryAspectRatio === "original" ? "#fafafa" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "0.82rem",
                    fontWeight: summaryAspectRatio === "original" ? 600 : 400,
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>16:9 Original (YouTube)</div>
                  <div style={{ fontSize: "0.74rem", opacity: 0.75, marginTop: "2px" }}>Conserva el formato nativo panorámico sin recorte vertical.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSummaryAspectRatio("9:16")}
                  style={{
                    flex: 1,
                    padding: "0.6rem 0.8rem",
                    borderRadius: "6px",
                    border: summaryAspectRatio === "9:16" ? "1.5px solid #fafafa" : "1px solid var(--border-default)",
                    background: summaryAspectRatio === "9:16" ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                    color: summaryAspectRatio === "9:16" ? "#fafafa" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "0.82rem",
                    fontWeight: summaryAspectRatio === "9:16" ? 600 : 400,
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>9:16 Vertical (Shorts / Reels)</div>
                  <div style={{ fontSize: "0.74rem", opacity: 0.75, marginTop: "2px" }}>Recorte centrado 9:16 para compilaciones verticales de móvil.</div>
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem", padding: "0.75rem", borderRadius: "6px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", fontSize: "0.8rem" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.25rem", color: "var(--text-secondary)" }}>Carpeta de destino:</div>
              <div style={{ color: "#fafafa", wordBreak: "break-all", fontFamily: "var(--font-mono)" }}>
                {customOutputDir || `Documentos/AutoShorts/${detail.project.name || fileName(detail.project.sourcePath)}`}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px" }}>
                El ensamblaje se realiza de forma directa en FFmpeg con micro-fades de audio entre cortes (0% de consumo de VRAM).
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-default)" }}>
              <button
                type="button"
                className="btn-cancel"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-confirm"
                onClick={onGenerateSummary}
              >
                <Clapperboard size={15} />
                <span>Autoeditar y Generar Video</span>
              </button>
            </div>
          </div>
        )}

        {summaryStatus === "rendering" && (
          <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
            <Loader2 className="spin" size={44} style={{ color: "var(--accent-primary)", margin: "0 auto 1rem" }} />
            <h4 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>Generando Video Resumen...</h4>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              {summaryProgressMsg || "Procesando cortes en FFmpeg con micro-fades de audio..."}
            </p>
            <div style={{ marginTop: "1rem", fontSize: "0.75rem", opacity: 0.7 }}>
              No se consume VRAM adicional durante este proceso.
            </div>
          </div>
        )}

        {summaryStatus === "done" && summaryResult && (
          <div style={{ padding: "1rem 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", color: "#10b981" }}>
              <BadgeCheck size={32} />
              <div>
                <h4 style={{ margin: 0, fontSize: "1.15rem", color: "var(--text-primary)" }}>Video Resumen Generado con Éxito</h4>
                <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                  El video está listo para reproducir, subir o abrir en Premiere / DaVinci Resolve.
                </p>
              </div>
            </div>

            <div style={{ padding: "1rem", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", marginBottom: "1.5rem", fontSize: "0.85rem" }}>
              {summaryResult.narrativeTitle && (
                <div style={{ marginBottom: "0.65rem", paddingBottom: "0.65rem", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Guión narrativo sugerido por la IA:</div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--accent-primary)", marginTop: "2px" }}>
                    {summaryResult.narrativeTitle}
                  </div>
                  {summaryResult.storyline && (
                    <div style={{ fontSize: "0.78rem", opacity: 0.8, marginTop: "4px", fontStyle: "italic" }}>
                      "{summaryResult.storyline}"
                    </div>
                  )}
                </div>
              )}

              {summaryResult.thumbnailPath && (
                <div style={{ marginBottom: "1rem", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)", background: "#000" }}>
                  <div style={{ fontSize: "0.75rem", padding: "0.4rem 0.65rem", background: "rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600 }}>Miniatura Extraída (1080p HD)</span>
                    <button
                      type="button"
                      className="icon-button"
                      style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                      onClick={() => void invoke("open_folder", { path: summaryResult.thumbnailPath })}
                    >
                      Abrir Archivo
                    </button>
                  </div>
                  <img
                    src={`http://127.0.0.1:1422/stream?file=${encodeURIComponent(summaryResult.thumbnailPath)}`}
                    alt="Miniatura del Video"
                    style={{ width: "100%", maxHeight: "200px", objectFit: "cover", display: "block" }}
                  />
                </div>
              )}

              {summaryResult.thumbnailIdeas && summaryResult.thumbnailIdeas.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.35rem", opacity: 0.85 }}>
                    Ideas de Título / Miniatura (Generadas por IA):
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                    {summaryResult.thumbnailIdeas.map((idea, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.35rem 0.6rem",
                          borderRadius: "6px",
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{idea}</span>
                        <button
                          type="button"
                          className="desc-copy-btn"
                          style={{ padding: "2px 6px", fontSize: "0.7rem" }}
                          onClick={() => void navigator.clipboard.writeText(idea)}
                          title="Copiar idea"
                        >
                          Copiar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summaryResult.youtubeChapters && (
                <div style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.85 }}>
                      Capítulos para Descripción de YouTube:
                    </span>
                    <button
                      type="button"
                      className="desc-copy-btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      onClick={() => {
                        void navigator.clipboard.writeText(summaryResult.youtubeChapters || "");
                        setCopiedChapters(true);
                        setTimeout(() => setCopiedChapters(false), 2000);
                      }}
                    >
                      <Copy size={12} />
                      <span>{copiedChapters ? "Copiado" : "Copiar Capítulos"}</span>
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={summaryResult.youtubeChapters}
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "rgba(0,0,0,0.3)",
                      color: "var(--foreground)",
                      fontSize: "0.78rem",
                      fontFamily: "monospace",
                      resize: "vertical",
                    }}
                  />
                  {summaryResult.descriptionPath && (
                    <div style={{ fontSize: "0.72rem", opacity: 0.65, marginTop: "3px" }}>
                      Archivo de texto listo: {summaryResult.descriptionPath}
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: "0.5rem" }}>
                <span style={{ opacity: 0.7 }}>Archivo: </span>
                <strong style={{ color: "var(--accent-primary)" }}>{summaryResult.filename}</strong>
              </div>
              <div style={{ marginBottom: "0.5rem" }}>
                <span style={{ opacity: 0.7 }}>Duración final: </span>
                <strong>{formatTime(summaryResult.duration)}</strong>
                <span style={{ opacity: 0.7, marginLeft: "1rem" }}>Momentos unidos: </span>
                <strong>{summaryResult.clipCount}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.7 }}>Ruta: </span>
                <span style={{ wordBreak: "break-all", fontSize: "0.78rem" }}>{summaryResult.outputPath}</span>
              </div>
            </div>

            <div className="style-modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => void invoke("open_folder", { path: summaryResult.outputPath })}
                title="Abrir la carpeta en el Explorador de Windows"
              >
                Abrir Carpeta
              </button>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setSummaryStatus("idle");
                  setSummaryResult(null);
                }}
              >
                Crear Otro Resumen
              </button>
              <button
                type="button"
                className="primary-action"
                onClick={() => {
                  onClose();
                  setSummaryStatus("idle");
                  setSummaryResult(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
