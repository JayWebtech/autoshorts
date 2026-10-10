import React, { useState, useRef } from "react";
import { Loader2, Sparkles, Copy, Check, X, FileVideo, FileText, Upload, FileCode2 } from "lucide-react";
import { CopyResult } from "../../types";
import { invoke } from "../../apiBridge";

interface QuickCopyModalProps {
  isOpen: boolean;
  onClose: () => void;
  llmEngine: string;
  localLlmModel: string;
  lmstudioModel?: string;
  anthropicKey?: string;
  deepseekKey?: string;
  deepseekModel?: string;
  geminiKey?: string;
  openaiKey?: string;
  openrouterKey?: string;
  openrouterModel?: string;
  groqKey?: string;
  enableThinking: boolean;
}

function cleanSrtClientText(content: string): string {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /^\d+$/.test(t)) continue;
    if (/^\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,\.]\d{3}/.test(t)) continue;
    const noTags = t.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim();
    if (noTags) {
      cleaned.push(noTags);
    }
  }
  return cleaned.join(" ").replace(/\s+/g, " ").trim();
}

export function QuickCopyModal({
  isOpen,
  onClose,
  llmEngine,
  localLlmModel,
  lmstudioModel = "",
  anthropicKey = "",
  deepseekKey = "",
  deepseekModel = "",
  geminiKey = "",
  openaiKey = "",
  openrouterKey = "",
  openrouterModel = "",
  groqKey = "",
  enableThinking,
}: QuickCopyModalProps) {
  const [activeTab, setActiveTab] = useState<"srt" | "text" | "media">("srt");
  const [srtFile, setSrtFile] = useState<{ name: string; path?: string; text: string; wordsCount: number } | null>(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [selectedMediaPath, setSelectedMediaPath] = useState<string | null>(null);
  const [extraContext, setExtraContext] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleCopyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2500);
  };

  const handleSelectSrt = async () => {
    try {
      const selected = await invoke<string | null>("open_file_dialog", { fileType: "srt" });
      if (selected) {
        const lower = selected.toLowerCase();
        if (!lower.endsWith(".srt") && !lower.endsWith(".vtt") && !lower.endsWith(".txt")) {
          setError("El archivo seleccionado debe ser un archivo de subtítulos (.srt, .vtt o .txt).");
          return;
        }
        const data = await invoke<{ path: string; filename: string; rawText: string; charCount: number; wordCount: number }>("read_subtitle_file", { filePath: selected });
        setSrtFile({
          name: data.filename,
          path: data.path,
          text: data.rawText,
          wordsCount: data.wordCount,
        });
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "");
      const cleaned = cleanSrtClientText(content);
      const words = cleaned ? cleaned.split(/\s+/).length : 0;
      setSrtFile({
        name: file.name,
        text: cleaned,
        wordsCount: words,
      });
      setError(null);
    };
    reader.readAsText(file);
  };

  const handleSelectMedia = async () => {
    try {
      const selected = await invoke<string | null>("open_file_dialog");
      if (selected) {
        setSelectedMediaPath(selected);
        setError(null);
      }
    } catch (err) {
      console.error("Error al abrir diálogo de archivo:", err);
    }
  };

  const handleGenerate = async () => {
    let sourceText: string | null = null;
    let sourceMedia: string | null = null;

    if (activeTab === "srt") {
      if (!srtFile || !srtFile.text.trim()) {
        setError("Selecciona o arrastra un archivo .SRT con texto para generar el copy.");
        return;
      }
      sourceText = srtFile.text.trim();
      sourceMedia = srtFile.path || null;
    } else if (activeTab === "text") {
      if (!transcriptText.trim()) {
        setError("Pega o escribe el texto de tu transcripción.");
        return;
      }
      sourceText = transcriptText.trim();
    } else if (activeTab === "media") {
      if (!selectedMediaPath) {
        setError("Selecciona un archivo de video o audio.");
        return;
      }
      sourceMedia = selectedMediaPath;
    }

    setIsGenerating(true);
    setError(null);

    const activeLlmKey =
      llmEngine === "openrouter"
        ? openrouterKey.trim()
        : "";

    const activeLlmModel =
      llmEngine === "local"
        ? localLlmModel.trim()
        : llmEngine === "lmstudio"
        ? lmstudioModel.trim() || null
        : llmEngine === "openrouter"
        ? openrouterModel.trim() || null
        : null;

    try {
      const result = await invoke<CopyResult>("generate_quick_copy", {
        transcriptText: sourceText,
        mediaPath: sourceMedia,
        extraContext: extraContext.trim() || null,
        provider: llmEngine,
        modelName: activeLlmModel,
        apiKey: activeLlmKey || null,
        enableThinking,
      });
      setCopyResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const activeIaLabel =
    llmEngine === "lmstudio"
      ? `LM Studio ${lmstudioModel ? `(${lmstudioModel})` : "(Auto)"}`
      : llmEngine === "local"
      ? localLlmModel || "Ollama"
      : llmEngine.toUpperCase();

  return (
    <div className="summary-modal-overlay" onClick={onClose}>
      <div
        className="summary-modal"
        style={{ maxWidth: "820px", width: "95%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="summary-modal-header">
          <div>
            <h3>Generador de Copy Rápido para Redes Sociales</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                Extrae ganchos virales, descripción estructurada y hashtags adaptados al contenido real de tu clip.
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  background: "rgba(56, 189, 248, 0.1)",
                  border: "1px solid rgba(56, 189, 248, 0.25)",
                  padding: "2px 7px",
                  borderRadius: "5px",
                  fontSize: "0.72rem",
                  color: "#38bdf8",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
                title="Motor de Inteligencia Artificial que procesará el guion"
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#38bdf8" }} />
                IA: {activeIaLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isGenerating}
            aria-label="Cerrar"
          >
            <X size={15} />
          </button>
        </div>

        {/* Source tab selector */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "1rem" }}>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setActiveTab("srt")}
            style={{
              flex: 1,
              padding: "0.55rem 0.8rem",
              borderRadius: "8px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: activeTab === "srt" ? "var(--bg-surface-hover)" : "var(--bg-surface-raised)",
              borderColor: activeTab === "srt" ? "var(--accent-primary)" : "var(--border-default)",
              fontWeight: activeTab === "srt" ? 600 : 400,
              fontSize: "0.82rem",
            }}
          >
            <FileCode2 size={15} />
            <span>Subir Archivo .SRT</span>
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setActiveTab("text")}
            style={{
              flex: 1,
              padding: "0.55rem 0.8rem",
              borderRadius: "8px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: activeTab === "text" ? "var(--bg-surface-hover)" : "var(--bg-surface-raised)",
              borderColor: activeTab === "text" ? "var(--accent-primary)" : "var(--border-default)",
              fontWeight: activeTab === "text" ? 600 : 400,
              fontSize: "0.82rem",
            }}
          >
            <FileText size={15} />
            <span>Pegar Texto / Transcripción</span>
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setActiveTab("media")}
            style={{
              flex: 1,
              padding: "0.55rem 0.8rem",
              borderRadius: "8px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              background: activeTab === "media" ? "var(--bg-surface-hover)" : "var(--bg-surface-raised)",
              borderColor: activeTab === "media" ? "var(--accent-primary)" : "var(--border-default)",
              fontWeight: activeTab === "media" ? 600 : 400,
              fontSize: "0.82rem",
            }}
          >
            <FileVideo size={15} />
            <span>Desde Video / Audio</span>
          </button>
        </div>

        {/* Input container */}
        <div style={{ marginBottom: "1rem" }}>
          {activeTab === "srt" ? (
            <div
              style={{
                border: "1px dashed var(--border-default)",
                borderRadius: "8px",
                padding: srtFile ? "1rem" : "1.75rem",
                textAlign: "center",
                background: "rgba(255, 255, 255, 0.02)",
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt,.vtt,.txt"
                style={{ display: "none" }}
                onChange={handleFileUpload}
              />
              {srtFile ? (
                <div style={{ textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <FileCode2 size={16} style={{ color: "#38bdf8" }} />
                      <span style={{ fontWeight: 600, fontSize: "0.86rem", color: "var(--text-primary)" }}>
                        {srtFile.name}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "0.72rem",
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: "rgba(34, 197, 94, 0.15)",
                        color: "#4ade80",
                        fontWeight: 600,
                      }}
                    >
                      {srtFile.wordsCount} palabras extraídas
                    </span>
                  </div>

                  {/* Clean text preview */}
                  <div
                    style={{
                      maxHeight: "130px",
                      overflowY: "auto",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-default)",
                      borderRadius: "6px",
                      padding: "0.6rem 0.8rem",
                      fontSize: "0.78rem",
                      lineHeight: "1.45",
                      color: "var(--text-secondary)",
                      marginBottom: "0.75rem",
                    }}
                  >
                    {srtFile.text}
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={handleSelectSrt}
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem", display: "inline-flex", alignItems: "center", gap: "5px" }}
                    >
                      <Upload size={13} />
                      <span>Cambiar archivo .SRT</span>
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => fileInputRef.current?.click()}
                      style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
                    >
                      Cargar desde navegador
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <Upload size={32} style={{ opacity: 0.5, margin: "0 auto 0.6rem", color: "#38bdf8" }} />
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.88rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    Sube tu archivo .SRT o .VTT
                  </p>
                  <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                    AutoShorts limpiará los números y marcas de tiempo automáticamente para que la IA entienda el 100% del video
                  </p>
                  <div style={{ display: "flex", justifyContent: "center", gap: "8px" }}>
                    <button
                      type="button"
                      className="primary-action"
                      onClick={handleSelectSrt}
                      style={{ fontSize: "0.82rem", padding: "0.45rem 1rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <FileCode2 size={15} />
                      <span>Seleccionar Archivo .SRT</span>
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => fileInputRef.current?.click()}
                      style={{ fontSize: "0.82rem", padding: "0.45rem 0.9rem" }}
                    >
                      Explorar PC
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : activeTab === "text" ? (
            <div>
              <textarea
                className="form-input"
                rows={5}
                placeholder="Pega aquí la transcripción de tu video o clip (ej. texto exportado de Premiere, SRT, o lo que dice el video)..."
                value={transcriptText}
                onChange={(e) => setTranscriptText(e.target.value)}
                style={{
                  width: "100%",
                  resize: "vertical",
                  fontSize: "0.84rem",
                  lineHeight: "1.4",
                  padding: "0.75rem",
                  borderRadius: "8px",
                  boxSizing: "border-box",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                border: "1px dashed var(--border-default)",
                borderRadius: "8px",
                padding: "1.5rem",
                textAlign: "center",
                background: "rgba(255, 255, 255, 0.02)",
              }}
            >
              {selectedMediaPath ? (
                <div>
                  <p style={{ margin: "0 0 0.5rem", fontWeight: 600, fontSize: "0.88rem" }}>
                    {selectedMediaPath.split(/[\\/]/).pop()}
                  </p>
                  <p style={{ margin: "0 0 1rem", fontSize: "0.76rem", opacity: 0.6 }}>
                    {selectedMediaPath}
                  </p>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={handleSelectMedia}
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
                  >
                    Cambiar archivo
                  </button>
                </div>
              ) : (
                <div>
                  <Upload size={28} style={{ opacity: 0.5, margin: "0 auto 0.5rem" }} />
                  <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Selecciona un video o audio de tu disco para transcribirlo rápidamente y extraer su copy
                  </p>
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={handleSelectMedia}
                    style={{ fontSize: "0.82rem", padding: "0.5rem 1rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <FileVideo size={15} />
                    <span>Seleccionar Archivo</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Optional Extra Context & Generate button */}
        <div
          style={{
            padding: "0.6rem 0.85rem",
            borderRadius: "8px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid var(--border-default)",
            display: "flex",
            gap: "8px",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <input
            type="text"
            className="form-input"
            placeholder="Contexto o tono (Opcional): ej. Tono gamer cómico, resaltar la frustración de las armas, video para TikTok..."
            value={extraContext}
            onChange={(e) => setExtraContext(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isGenerating) {
                void handleGenerate();
              }
            }}
            style={{ flex: 1, padding: "0.5rem 0.75rem", fontSize: "0.84rem", borderRadius: "6px" }}
          />
          <button
            type="button"
            className="primary-action"
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{ padding: "0.5rem 1.2rem", fontSize: "0.84rem", display: "inline-flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
          >
            {isGenerating ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            <span>{isGenerating ? "Analizando y redactando..." : copyResult ? "Regenerar Copy" : "Generar Copy con IA"}</span>
          </button>
        </div>

        {error && (
          <div style={{ padding: "0.6rem 0.8rem", background: "rgba(239, 68, 68, 0.1)", border: "1px solid #ef4444", borderRadius: "6px", color: "#f87171", fontSize: "0.82rem", marginBottom: "1rem" }}>
            {error}
          </div>
        )}

        {/* Results view */}
        {copyResult && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem", maxHeight: "380px", overflowY: "auto", paddingRight: "4px" }}>
            {/* Hooks */}
            <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-default)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--accent-primary)" }}>
                  Ganchos Virales (Hooks)
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>Elige el más llamativo para tu título o texto en pantalla</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {copyResult.hooks.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.45rem 0.65rem",
                      background: "var(--bg-surface)",
                      borderRadius: "6px",
                      border: "1px solid var(--border-default)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <span style={{ flex: 1, marginRight: "8px" }}>{h}</span>
                    <button
                      type="button"
                      className="desc-copy-btn"
                      onClick={() => handleCopyText(`hook_${i}`, h)}
                      style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                    >
                      {copiedKey === `hook_${i}` ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedKey === `hook_${i}` ? "Copiado" : "Copiar"}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Caption */}
            <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-default)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>Descripción del Post (Caption)</span>
                <button
                  type="button"
                  className="desc-copy-btn"
                  onClick={() => handleCopyText("caption", copyResult.caption)}
                  style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                >
                  {copiedKey === "caption" ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedKey === "caption" ? "Copiado" : "Copiar"}</span>
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: "1.45", color: "var(--text-secondary)" }}>
                {copyResult.caption}
              </p>
            </div>

            {/* CTA */}
            {copyResult.cta && (
              <div style={{ padding: "0.6rem 1rem", borderRadius: "8px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", display: "block", marginBottom: "2px" }}>
                    Llamado a la acción (CTA)
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "var(--text-primary)" }}>{copyResult.cta}</span>
                </div>
                <button
                  type="button"
                  className="desc-copy-btn"
                  onClick={() => handleCopyText("cta", copyResult.cta)}
                  style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                >
                  {copiedKey === "cta" ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedKey === "cta" ? "Copiado" : "Copiar"}</span>
                </button>
              </div>
            )}

            {/* Hashtags */}
            <div style={{ padding: "0.6rem 1rem", borderRadius: "8px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-default)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-primary)" }}>Hashtags sugeridos</span>
                <button
                  type="button"
                  className="desc-copy-btn"
                  onClick={() => handleCopyText("hashtags", copyResult.hashtags.join(" "))}
                  style={{ fontSize: "0.72rem", padding: "2px 6px" }}
                >
                  {copiedKey === "hashtags" ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedKey === "hashtags" ? "Copiado" : "Copiar todos"}</span>
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {copyResult.hashtags.map((tag, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: "0.74rem",
                      padding: "2px 6px",
                      background: "rgba(56, 189, 248, 0.1)",
                      color: "#38bdf8",
                      borderRadius: "4px",
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Full Copy Box */}
            <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(56, 189, 248, 0.04)", border: "1px solid rgba(56, 189, 248, 0.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#38bdf8" }}>Copy Completo (Listo para publicar)</span>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => handleCopyText("full_copy", copyResult.full_copy)}
                  style={{ fontSize: "0.74rem", padding: "3px 8px" }}
                >
                  {copiedKey === "full_copy" ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedKey === "full_copy" ? "Copiado" : "Copiar Todo el Texto"}</span>
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: "0.78rem",
                  fontFamily: "var(--font-mono, monospace)",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.4",
                  color: "var(--text-primary)",
                  maxHeight: "120px",
                  overflowY: "auto",
                }}
              >
                {copyResult.full_copy}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
