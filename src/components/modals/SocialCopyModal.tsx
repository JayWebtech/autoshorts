import React from "react";
import { Loader2, Sparkles, Copy, X } from "lucide-react";
import { CopyResult } from "../../types";

interface SocialCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  isGeneratingCopy: boolean;
  copyResult: CopyResult | null;
  llmEngine: string;
  localLlmModel: string;
  copyExtraContext: string;
  setCopyExtraContext: (val: string) => void;
  onGenerateCopy: (override?: string) => Promise<void>;
  copiedField: string | null;
  onCopyText: (key: string, text: string) => void;
}

export function SocialCopyModal({
  isOpen,
  onClose,
  isGeneratingCopy,
  copyResult,
  llmEngine,
  localLlmModel,
  copyExtraContext,
  setCopyExtraContext,
  onGenerateCopy,
  copiedField,
  onCopyText,
}: SocialCopyModalProps) {
  if (!isOpen) return null;

  return (
    <div className="summary-modal-overlay" onClick={onClose}>
      <div
        className="summary-modal"
        style={{ maxWidth: "760px", width: "95%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="summary-modal-header">
          <div>
            <h3>Generador de Copy para Redes Sociales</h3>
            <p>Titulares virales (hooks), descripción persuasiva, llamadas a la acción (CTA) y hashtags generados a partir del contenido de tu video.</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isGeneratingCopy}
            aria-label="Cerrar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Prompt context and generation bar */}
        <div style={{ padding: "1rem", borderRadius: "10px", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border)", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>
              Contexto o Enfoque Específico (Opcional):
            </span>
            <span style={{ fontSize: "0.74rem", opacity: 0.7 }}>
              Modelo activo: {llmEngine === "local" ? localLlmModel : llmEngine.toUpperCase()}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              className="form-input"
              placeholder="Ej: Enfoque para TikTok, tono humorístico gamer, invitar a seguir el stream..."
              value={copyExtraContext}
              onChange={(e) => setCopyExtraContext(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isGeneratingCopy) {
                  void onGenerateCopy();
                }
              }}
              style={{ flex: 1, padding: "0.5rem 0.75rem", fontSize: "0.84rem", borderRadius: "6px" }}
            />
            <button
              type="button"
              className="primary-action"
              onClick={() => void onGenerateCopy()}
              disabled={isGeneratingCopy}
              style={{ padding: "0.5rem 1rem", fontSize: "0.84rem", display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
            >
              {isGeneratingCopy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              <span>{isGeneratingCopy ? "Generando..." : copyResult ? "Regenerar Copy" : "Generar Copy"}</span>
            </button>
          </div>
        </div>

        {/* Loading state */}
        {isGeneratingCopy && (
          <div style={{ padding: "2.5rem 1rem", textAlign: "center" }}>
            <Loader2 className="spin" size={40} style={{ color: "var(--accent-primary)", margin: "0 auto 1rem" }} />
            <h4 style={{ margin: "0 0 0.5rem", fontSize: "1.05rem" }}>Analizando Transcripción con IA...</h4>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
              Extrayendo ganchos virales, resumen persuasivo, llamada a la acción y etiquetas relevantes...
            </p>
          </div>
        )}

        {/* Content Display */}
        {!isGeneratingCopy && copyResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Hooks */}
            <div style={{ padding: "1rem", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--accent-primary)" }}>
                  Ganchos Virales (Titulares / Hooks)
                </span>
                <button
                  type="button"
                  className="desc-copy-btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  onClick={() => onCopyText("hooks", copyResult.hooks.join("\n"))}
                >
                  <Copy size={12} />
                  <span>{copiedField === "hooks" ? "Copiados" : "Copiar Todos"}</span>
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                {copyResult.hooks.map((hook, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "6px",
                      background: "rgba(0,0,0,0.25)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      fontSize: "0.82rem"
                    }}
                  >
                    <span style={{ flex: 1, marginRight: "0.5rem" }}>{hook}</span>
                    <button
                      type="button"
                      className="btn-cancel"
                      style={{ padding: "0 8px", fontSize: "0.72rem", height: "26px", minHeight: "26px" }}
                      onClick={() => onCopyText(`hook-${idx}`, hook)}
                    >
                      {copiedField === `hook-${idx}` ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Caption / Descripción */}
            <div style={{ padding: "1rem", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Descripción Persuasiva (Caption)
                </span>
                <button
                  type="button"
                  className="btn-cancel"
                  style={{ padding: "0 10px", height: "26px", minHeight: "26px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  onClick={() => onCopyText("caption", copyResult.caption)}
                >
                  <Copy size={12} />
                  <span>{copiedField === "caption" ? "Copiado" : "Copiar Descripción"}</span>
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "0.83rem", lineHeight: "1.55", opacity: 0.9, whiteSpace: "pre-wrap" }}>
                {copyResult.caption}
              </p>
            </div>

            {/* Call To Action */}
            <div style={{ padding: "0.85rem 1rem", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Llamada a la Acción (CTA)
                </span>
                <button
                  type="button"
                  className="btn-cancel"
                  style={{ padding: "0 10px", height: "26px", minHeight: "26px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  onClick={() => onCopyText("cta", copyResult.cta)}
                >
                  <Copy size={12} />
                  <span>{copiedField === "cta" ? "Copiado" : "Copiar CTA"}</span>
                </button>
              </div>
              <div style={{ fontSize: "0.82rem", color: "#fafafa", fontWeight: 500 }}>
                {copyResult.cta}
              </div>
            </div>

            {/* Hashtags */}
            <div style={{ padding: "0.85rem 1rem", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Hashtags Optimizados
                </span>
                <button
                  type="button"
                  className="btn-cancel"
                  style={{ padding: "0 10px", height: "26px", minHeight: "26px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  onClick={() => onCopyText("hashtags", copyResult.hashtags.join(" "))}
                >
                  <Copy size={12} />
                  <span>{copiedField === "hashtags" ? "Copiados" : "Copiar Hashtags"}</span>
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {copyResult.hashtags.map((tag, idx) => (
                  <span
                    key={idx}
                    style={{
                      fontSize: "0.75rem",
                      fontFamily: "var(--font-mono, monospace)",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      background: "rgba(255, 255, 255, 0.04)",
                      color: "var(--text-primary)",
                      border: "1px solid var(--border-default)"
                    }}
                  >
                    {tag.startsWith("#") ? tag : `#${tag}`}
                  </span>
                ))}
              </div>
            </div>

            {/* Full copy */}
            <div style={{ padding: "1rem", borderRadius: "10px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Copy Completo Listo para Publicar
                </span>
                <button
                  type="button"
                  className="btn-confirm"
                  style={{ padding: "0 12px", height: "28px", minHeight: "28px", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  onClick={() => onCopyText("full", copyResult.full_copy)}
                >
                  <Copy size={13} />
                  <span>{copiedField === "full" ? "Copiado al Portapapeles" : "Copiar Todo"}</span>
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "0.75rem",
                  borderRadius: "6px",
                  background: "rgba(0,0,0,0.4)",
                  fontSize: "0.78rem",
                  fontFamily: "var(--font-mono, monospace)",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.45",
                  color: "var(--foreground)"
                }}
              >
                {copyResult.full_copy}
              </pre>
            </div>
          </div>
        )}

        {!isGeneratingCopy && !copyResult && (
          <div style={{ padding: "2rem 1rem", textAlign: "center", opacity: 0.75 }}>
            <p style={{ fontSize: "0.85rem", margin: "0 0 1rem" }}>
              Haz clic en el botón para que la IA redacte automáticamente el copy comercial y viral de este video.
            </p>
            <button
              type="button"
              className="primary-action"
              onClick={() => void onGenerateCopy()}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Sparkles size={16} />
              <span>Generar Copy con IA Ahora</span>
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: "1.25rem", paddingTop: "0.9rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-cancel"
            onClick={onClose}
            style={{ padding: "0.45rem 1.2rem", fontSize: "0.84rem" }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
