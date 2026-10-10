import React from "react";
import { Captions, Sparkles, X, Folder, FolderOpen } from "lucide-react";
import {
  ContentType,
  EnvironmentStatus,
  HardwareTelemetry,
  LlmEngine,
  TargetDuration,
  TranscriptionEngine,
  WhisperModel,
} from "../../types";
import {
  ModelBadge,
  getWhisperTrafficLevel,
  getOllamaTrafficLevel,
} from "../common/ModelBadge";

interface StyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry?: HardwareTelemetry | null;
  selectedStyle: string;
  setSelectedStyle: (style: string) => void;
  selectedContentType: ContentType;
  setSelectedContentType: (type: ContentType) => void;
  targetDuration: TargetDuration;
  setTargetDuration: (dur: TargetDuration) => void;
  importModalTab: "subtitles" | "ai";
  setImportModalTab: (tab: "subtitles" | "ai") => void;
  llmEngine: LlmEngine;
  setLlmEngine: (engine: LlmEngine) => void;
  localLlmModel: string;
  setLocalLlmModel: (model: string) => void;
  lmstudioModel?: string;
  setLmstudioModel?: (model: string) => void;
  canUseLmStudio?: boolean;
  deepseekModel: string;
  setDeepseekModel: (model: string) => void;
  openrouterModel: string;
  setOpenrouterModel: (model: string) => void;
  canUseDeepseek: boolean;
  canUseClaude: boolean;
  canUseOpenai: boolean;
  canUseGroq: boolean;
  canUseGemini: boolean;
  canUseOpenrouter: boolean;
  transcriptionEngine: TranscriptionEngine;
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  whisperModelsList: WhisperModel[];
  autoTranscribeOnImport: boolean;
  setAutoTranscribeOnImport: (val: boolean) => void;
  refineTranscriptWithLlm: boolean;
  setRefineTranscriptWithLlm: (val: boolean) => void;
  autoDetectMoments: boolean;
  setAutoDetectMoments: (val: boolean) => void;
  enableThinking: boolean;
  setEnableThinking: (val: boolean) => void;
  customProjectDir: string;
  onSelectProjectDir: () => void;
  moveSourceVideo: boolean;
  setMoveSourceVideo: (val: boolean) => void;
  environment: EnvironmentStatus | null;
  onOpenSettings: () => void;
  onConfirm: () => Promise<void>;
}

export function StyleModal({
  isOpen,
  onClose,
  telemetry,
  selectedStyle,
  setSelectedStyle,
  selectedContentType,
  setSelectedContentType,
  targetDuration,
  setTargetDuration,
  importModalTab,
  setImportModalTab,
  llmEngine,
  setLlmEngine,
  localLlmModel,
  setLocalLlmModel,
  lmstudioModel = "",
  setLmstudioModel,
  canUseLmStudio = false,
  deepseekModel,
  setDeepseekModel,
  openrouterModel,
  setOpenrouterModel,
  canUseDeepseek,
  canUseClaude,
  canUseOpenai,
  canUseGroq,
  canUseGemini,
  canUseOpenrouter,
  transcriptionEngine,
  whisperModel,
  setWhisperModel,
  whisperModelsList,
  autoTranscribeOnImport,
  setAutoTranscribeOnImport,
  refineTranscriptWithLlm,
  setRefineTranscriptWithLlm,
  autoDetectMoments,
  setAutoDetectMoments,
  enableThinking,
  setEnableThinking,
  customProjectDir,
  onSelectProjectDir,
  moveSourceVideo,
  setMoveSourceVideo,
  environment,
  onOpenSettings,
  onConfirm,
}: StyleModalProps) {
  if (!isOpen) return null;

  return (
    <div className="style-modal-overlay">
      <div className="style-modal">
        {/* Modal Header */}
        <div style={{ padding: "1.25rem 1.5rem 0.75rem", borderBottom: "1px solid var(--border-default)", background: "var(--bg-surface-raised)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>
              Configuración de Importación
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", borderRadius: "4px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                {importModalTab === "subtitles" ? "Pestaña 1 de 2: Subtítulos y Formato" : "Pestaña 2 de 2: Procesamiento e IA"}
              </span>
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                title="Cerrar modal"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <p style={{ margin: "0.2rem 0 0.85rem", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
            Personaliza el formato visual y las opciones de procesamiento para este proyecto.
          </p>

          {/* Tabs Navigation */}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setImportModalTab("subtitles")}
              style={{
                flex: 1,
                padding: "0.55rem 0.8rem",
                fontSize: "0.84rem",
                fontWeight: 600,
                borderRadius: "6px",
                border: importModalTab === "subtitles" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                background: importModalTab === "subtitles" ? "#fafafa" : "var(--bg-surface)",
                color: importModalTab === "subtitles" ? "#09090b" : "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                transition: "all 0.15s ease",
              }}
            >
              <Captions size={15} color={importModalTab === "subtitles" ? "#09090b" : "currentColor"} />
              Subtítulos y Formato
            </button>

            <button
              type="button"
              onClick={() => setImportModalTab("ai")}
              style={{
                flex: 1,
                padding: "0.55rem 0.8rem",
                fontSize: "0.84rem",
                fontWeight: 600,
                borderRadius: "6px",
                border: importModalTab === "ai" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                background: importModalTab === "ai" ? "#fafafa" : "var(--bg-surface)",
                color: importModalTab === "ai" ? "#09090b" : "var(--text-secondary)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                transition: "all 0.15s ease",
              }}
            >
              <Sparkles size={15} color={importModalTab === "ai" ? "#09090b" : "currentColor"} />
              Procesamiento e IA
            </button>
          </div>
        </div>

        {/* Scrollable Tab Content Area */}
        <div style={{ padding: "1.25rem 1.5rem", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {importModalTab === "subtitles" ? (
            <>
              {/* Estilo de Subtítulos */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                  <label style={{ fontSize: "0.86rem", fontWeight: 600, color: "var(--foreground)" }}>
                    Estilo de Subtítulos:
                  </label>
                  <span style={{ fontSize: "0.72rem", opacity: 0.7 }}>
                    Desplaza la lista para ver todos los estilos
                  </span>
                </div>

                <div className="style-grid">
                  <div
                    className={`style-card ${selectedStyle === "none" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("none")}
                  >
                    <div className="style-preview-box">
                      <span style={{ fontSize: "0.75rem", fontWeight: "bold", opacity: 0.85, color: "var(--accent-primary)" }}>[VIDEO LIMPIO RAW]</span>
                    </div>
                    <div className="style-card-title">Sin Subtítulos (Raw)</div>
                    <div className="style-card-desc">Corte limpio sin texto quemado (conserva formato original o 9:16 vertical). Incluye el archivo .SRT aparte para edición manual.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "modern-box" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("modern-box")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-box">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Modern Box</div>
                    <div className="style-card-desc">Texto blanco nítido dentro de una caja oscura semitransparente. Alta legibilidad.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "classic-outline" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("classic-outline")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-outline">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Classic Outline</div>
                    <div className="style-card-desc">Texto amarillo con trazo negro marcado. Formato dinámico estilo CapCut.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "minimal-shadow" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("minimal-shadow")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-shadow">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Minimal Shadow</div>
                    <div className="style-card-desc">Texto blanco limpio con sombra suave y elegante sin recargar la imagen.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "vibrant-cyan" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("vibrant-cyan")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-cyan">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Vibrant Cyan</div>
                    <div className="style-card-desc">Tono cian tecnológico con sombra oscura para un look fresco y moderno.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "vibrant-yellow-box" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("vibrant-yellow-box")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-yellow-box">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Vibrant Yellow Box</div>
                    <div className="style-card-desc">Texto negro dentro de una caja amarilla sólida. Máxima visibilidad e impacto.</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "vibrant-green" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("vibrant-green")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-green">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Vibrant Green</div>
                    <div className="style-card-desc">Verde neón enérgico con contorno negro (estilo Hormozi).</div>
                  </div>

                  <div
                    className={`style-card ${selectedStyle === "vibrant-red" ? "selected" : ""}`}
                    onClick={() => setSelectedStyle("vibrant-red")}
                  >
                    <div className="style-preview-box">
                      <span className="preview-text-red">BRAINFOOD BECAUSE</span>
                    </div>
                    <div className="style-card-title">Vibrant Red</div>
                    <div className="style-card-desc">Rojo carmesí con relieve para momentos de acción, tensión o gaming.</div>
                  </div>
                </div>
              </div>

              {/* Selector de Duración Objetivo de Clips */}
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                  <span>Objetivo de Duración de Clips:</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>VRAM constante por fragmentos</span>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.4rem" }}>
                  {(["30s", "60s", "2m", "3m", "5m"] as const).map((dur) => {
                    const active = targetDuration === dur;
                    return (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => {
                          setTargetDuration(dur);
                          localStorage.setItem("autoshorts_target_duration", dur);
                        }}
                        style={{
                          padding: "0.5rem 0.4rem",
                          borderRadius: "6px",
                          border: active ? "1px solid #fafafa" : "1px solid var(--border-default)",
                          background: active ? "#fafafa" : "var(--bg-surface)",
                          color: active ? "#09090b" : "var(--text-secondary)",
                          cursor: "pointer",
                          textAlign: "center",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "0.82rem", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                          {dur === "30s" ? "30 seg" : dur === "60s" ? "1 min" : dur === "2m" ? "2 min" : dur === "3m" ? "3 min" : "5 min"}
                        </div>
                        <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                          {dur === "60s" ? "Recomendado" : dur === "30s" ? "Rápido" : "Formato Largo"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selector de Tipo de Video / Enfoque */}
              <div>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, display: "block", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
                  Tipo de Video / Enfoque de la IA:
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "0.5rem" }}>
                  {[
                    { id: "gaming", label: "Gaming", desc: "Kills, fails, torneos" },
                    { id: "tutorial", label: "Tutorial", desc: "Tips, avisos, trucos" },
                    { id: "podcast", label: "Charla", desc: "Historias, debates" },
                    { id: "general", label: "General", desc: "Detección mixta" },
                  ].map((ct) => {
                    const active = selectedContentType === ct.id;
                    return (
                      <button
                        key={ct.id}
                        type="button"
                        onClick={() => setSelectedContentType(ct.id as ContentType)}
                        style={{
                          padding: "0.6rem 0.8rem",
                          borderRadius: "6px",
                          border: active ? "1.5px solid #fafafa" : "1px solid var(--border-default)",
                          background: active ? "var(--bg-surface-hover)" : "var(--bg-surface)",
                          color: active ? "#fafafa" : "var(--text-secondary)",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{ct.label}</div>
                        <div style={{ fontSize: "0.72rem", opacity: 0.75 }}>{ct.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Selector de Motor & Modelo de IA */}
              <div style={{ padding: "0.9rem 1rem", borderRadius: "10px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <Sparkles size={16} color="var(--accent-primary)" />
                    Motor & Modelo de IA para Analizar Momentos:
                  </label>
                  <span style={{ fontSize: "0.75rem", opacity: 0.75 }}>
                    {llmEngine === "local" || llmEngine === "lmstudio" ? "Local y Privado" : "API Cloud"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0.75rem", alignItems: "center" }}>
                  {/* Engine Selector */}
                  <div>
                    <label style={{ fontSize: "0.72rem", opacity: 0.7, display: "block", marginBottom: "0.2rem" }}>Proveedor</label>
                    <select
                      className="form-select"
                      value={llmEngine}
                      onChange={(e) => {
                        const eng = e.target.value as any;
                        setLlmEngine(eng);
                        localStorage.setItem("autoshorts_llm_engine", eng);
                      }}
                      style={{ width: "100%", padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                    >
                      <option value="local">Ollama (Local)</option>
                      <option value="lmstudio">LM Studio (Local)</option>
                      <option value="openrouter">OpenRouter (Cloud)</option>
                    </select>
                  </div>

                  {/* Model Selector / Input */}
                  <div>
                    <label style={{ fontSize: "0.72rem", opacity: 0.7, display: "block", marginBottom: "0.2rem" }}>
                      {llmEngine === "local" ? "Modelo de Ollama instalado" : llmEngine === "lmstudio" ? "Modelo de LM Studio" : "Modelo / Clave"}
                    </label>

                    {llmEngine === "local" ? (
                      environment?.installedOllamaModels && environment.installedOllamaModels.length > 0 ? (
                        <select
                          className="form-select"
                          value={localLlmModel}
                          onChange={(e) => {
                            setLocalLlmModel(e.target.value);
                            localStorage.setItem("autoshorts_local_llm_model", e.target.value);
                          }}
                          style={{ width: "100%", padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                        >
                          {environment.installedOllamaModels.map((m) => (
                            <option key={m} value={m}>
                              {m} {m.includes("qwen") ? "(Recomendado)" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          className="form-input"
                          value={localLlmModel}
                          onChange={(e) => {
                            setLocalLlmModel(e.target.value);
                            localStorage.setItem("autoshorts_local_llm_model", e.target.value);
                          }}
                          placeholder="Ej: qwen3.5:9b o qwen2.5:7b"
                          style={{ width: "100%", padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                        />
                      )
                    ) : llmEngine === "lmstudio" ? (
                      environment?.installedLmStudioModels && environment.installedLmStudioModels.length > 0 ? (
                        <select
                          className="form-select"
                          value={lmstudioModel}
                          onChange={(e) => {
                            if (setLmstudioModel) setLmstudioModel(e.target.value);
                            localStorage.setItem("autoshorts_lmstudio_model", e.target.value);
                          }}
                          style={{ width: "100%", padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                        >
                          {environment.installedLmStudioModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input
                            type="text"
                            className="form-input"
                            value={lmstudioModel}
                            onChange={(e) => {
                              if (setLmstudioModel) setLmstudioModel(e.target.value);
                              localStorage.setItem("autoshorts_lmstudio_model", e.target.value);
                            }}
                            placeholder="Ej: gemma-4-e4b-uncensored-hauhaucs-aggressive"
                            style={{ flex: 1, padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                          />
                          <span style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                            {canUseLmStudio ? (
                              <span style={{ color: "#10b981", fontWeight: 600 }}>LM Studio OK</span>
                            ) : (
                              <span
                                onClick={onOpenSettings}
                                style={{ color: "#f59e0b", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                                title="Verifica que LM Studio esté corriendo en el puerto 1234"
                              >
                                Desconectado (Configurar)
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    ) : (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input
                          type="text"
                          className="form-input"
                          value={openrouterModel || "anthropic/claude-3.5-sonnet"}
                          onChange={(e) => {
                            if (setOpenrouterModel) setOpenrouterModel(e.target.value);
                          }}
                          style={{ flex: 1, padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                        />
                        <span style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                          {canUseOpenrouter ? (
                            <span style={{ color: "#10b981", fontWeight: 600 }}>API Key OK</span>
                          ) : (
                            <span
                              onClick={onOpenSettings}
                              style={{ color: "#ef4444", cursor: "pointer", textDecoration: "underline", fontWeight: 600 }}
                              title="Haz clic para abrir ajustes y poner tu API Key"
                            >
                              Falta API Key (Configurar)
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Opciones de Transcripción de Audio */}
              <div style={{ padding: "0.9rem 1rem", borderRadius: "10px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--foreground)" }}>
                  Transcripción de Audio
                </div>

                {/* Modelo Whisper */}
                {transcriptionEngine === "local" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Modelo de Whisper (Precisión vs VRAM)</label>
                        {(() => {
                          const traf = getWhisperTrafficLevel(whisperModel, telemetry?.vramTotalMb);
                          return <ModelBadge level={traf.level} label={traf.label} note={traf.note} />;
                        })()}
                      </div>
                      <span style={{ fontSize: "0.72rem", color: "var(--accent-primary)", fontWeight: 600 }}>
                        {whisperModelsList.find((m) => m.id === whisperModel)?.vram || ""} VRAM
                      </span>
                    </div>
                    <select
                      className="form-select"
                      value={whisperModel}
                      onChange={(e) => {
                        setWhisperModel(e.target.value);
                        localStorage.setItem("autoshorts_whisper_model", e.target.value);
                      }}
                      style={{ width: "100%", padding: "0.45rem 0.6rem", fontSize: "0.82rem", borderRadius: "6px" }}
                    >
                      {whisperModelsList.map((m) => {
                        const traf = getWhisperTrafficLevel(m.id, telemetry?.vramTotalMb);
                        return (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.vram} VRAM) — {traf.label} {m.downloaded ? "[Descargado]" : "[Descargar al usar]"}
                          </option>
                        );
                      })}
                    </select>
                    <span style={{ fontSize: "0.72rem", opacity: 0.75 }}>
                      {whisperModelsList.find((m) => m.id === whisperModel)?.description || "Modelo de Whisper para transcripción en GPU."}
                    </span>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                  <input
                    type="checkbox"
                    id="autoTranscribeOnImport"
                    checked={autoTranscribeOnImport}
                    onChange={(e) => setAutoTranscribeOnImport(e.target.checked)}
                    style={{ cursor: "pointer", width: "17px", height: "17px", marginTop: "2px", accentColor: "var(--accent-primary)" }}
                  />
                  <div>
                    <label htmlFor="autoTranscribeOnImport" style={{ fontSize: "0.83rem", fontWeight: 600, cursor: "pointer", display: "block" }}>
                      Transcribir audio automáticamente al importar
                    </label>
                    <span style={{ fontSize: "0.75rem", opacity: 0.75, display: "block", marginTop: "2px" }}>
                      Desmárcalo si solo deseas cargar el video al proyecto y transcribirlo o revisarlo más tarde por si te equivocaste de archivo.
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                  <input
                    type="checkbox"
                    id="refineTranscriptWithLlm"
                    checked={refineTranscriptWithLlm}
                    onChange={(e) => setRefineTranscriptWithLlm(e.target.checked)}
                    style={{ cursor: "pointer", width: "17px", height: "17px", marginTop: "2px", accentColor: "var(--accent-primary)" }}
                  />
                  <div>
                    <label htmlFor="refineTranscriptWithLlm" style={{ fontSize: "0.83rem", fontWeight: 600, cursor: "pointer", display: "block" }}>
                      Perfeccionar ortografía y jerga con IA (ASR Refiner)
                    </label>
                    <span style={{ fontSize: "0.75rem", opacity: 0.75, display: "block", marginTop: "2px" }}>
                      Corrige términos técnicos, jerga gamer y tildes preservando los timestamps exactos de cada palabra.
                    </span>
                    <span style={{ fontSize: "0.73rem", color: "#38bdf8", display: "block", marginTop: "4px", lineHeight: "1.4" }}>
                      Nota de velocidad: En modo rápido añade solo unos segundos por minuto de audio. Si activas el modo razonamiento (thinking) tardará varios minutos adicionales. Desactívalo si buscas transcripción inmediata.
                    </span>
                  </div>
                </div>
              </div>

              {/* Detección de Momentos */}
              <div style={{ padding: "0.9rem 1rem", borderRadius: "10px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-color)", display: "flex", alignItems: "flex-start", gap: "0.65rem" }}>
                <input
                  type="checkbox"
                  id="autoDetectMoments"
                  checked={autoDetectMoments}
                  onChange={(e) => setAutoDetectMoments(e.target.checked)}
                  style={{ cursor: "pointer", width: "17px", height: "17px", marginTop: "2px", accentColor: "var(--accent-primary)" }}
                />
                <div>
                  <label htmlFor="autoDetectMoments" style={{ fontSize: "0.83rem", fontWeight: 600, cursor: "pointer", display: "block" }}>
                    Buscar momentos clave automáticamente tras transcribir
                  </label>
                  <span style={{ fontSize: "0.75rem", opacity: 0.75, display: "block", marginTop: "2px" }}>
                    Desmárcalo para dejar enfriar la GPU entre pasos o revisar la transcripción antes de procesar candidatos.
                  </span>
                </div>
              </div>

              {/* Modo Razonamiento (Thinking / CoT en Ollama) */}
              <div style={{
                padding: "1rem",
                borderRadius: "10px",
                background: enableThinking ? "rgba(245, 158, 11, 0.05)" : "rgba(16, 185, 129, 0.05)",
                border: enableThinking ? "1px solid rgba(245, 158, 11, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
                display: "flex",
                flexDirection: "column",
                gap: "0.6rem"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label htmlFor="enableThinkingImport" style={{ fontSize: "0.86rem", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <input
                      type="checkbox"
                      id="enableThinkingImport"
                      checked={enableThinking}
                      onChange={(e) => {
                        setEnableThinking(e.target.checked);
                        localStorage.setItem("autoshorts_enable_thinking", String(e.target.checked));
                      }}
                      style={{ cursor: "pointer", width: "17px", height: "17px", accentColor: "var(--accent-primary)" }}
                    />
                    <span>Modo Razonamiento (Thinking / CoT en Ollama)</span>
                  </label>
                  <span style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    padding: "0.2rem 0.6rem",
                    borderRadius: "4px",
                    background: "var(--bg-surface)",
                    color: enableThinking ? "#f59e0b" : "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                    fontFamily: "var(--font-mono)"
                  }}>
                    {enableThinking ? "Modo Razonamiento Profundo" : "Modo Rápido"}
                  </span>
                </div>

                <div style={{ fontSize: "0.78rem", lineHeight: "1.45", color: "var(--text-secondary)", paddingLeft: "1.7rem" }}>
                  {enableThinking ? (
                    <div>
                      <strong style={{ color: "#fafafa" }}>Activado:</strong> La IA genera una cadena de pensamiento antes de dar la respuesta. Proporciona mayor análisis contextual pero incrementa el tiempo y el uso de VRAM.
                    </div>
                  ) : (
                    <div>
                      <strong style={{ color: "#fafafa" }}>Desactivado (Recomendado):</strong> La IA responde de forma directa sin cadena de razonamiento previa. Recomendado para tu NVIDIA RTX 2060 (12GB) con procesamiento hasta 30 veces más ágil.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Project Destination & Move Video Option */}
        <div className="import-destination-card">
          <div className="import-destination-row">
            <div className="import-destination-info">
              <Folder size={15} className="import-destination-icon" />
              <div className="import-destination-text">
                <span className="import-destination-label">Carpeta del proyecto:</span>
                <span className="import-destination-path" title={customProjectDir}>
                  {customProjectDir || "Ubicación predeterminada (Documents/AutoShorts/...)"}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="import-destination-change-btn"
              onClick={onSelectProjectDir}
              title="Seleccionar otra carpeta o disco para este proyecto"
            >
              <FolderOpen size={13} />
              <span>Cambiar...</span>
            </button>
          </div>

          <label className="import-move-option">
            <input
              type="checkbox"
              checked={moveSourceVideo}
              onChange={(e) => setMoveSourceVideo(e.target.checked)}
              className="import-move-checkbox"
            />
            <div className="import-move-text">
              <span className="import-move-title">Mover video original a esta carpeta</span>
              <span className="import-move-desc">
                Traslada el archivo de video adentro de la carpeta del proyecto para centralizar todo y ahorrar espacio.
              </span>
            </div>
          </label>
        </div>

        {/* Modal Footer */}
        <div style={{ padding: "0.9rem 1.5rem", borderTop: "1px solid var(--border-default)", background: "var(--bg-surface-raised)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {importModalTab === "subtitles" ? (
              <button
                type="button"
                className="btn-cancel"
                onClick={onClose}
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setImportModalTab("subtitles")}
              >
                Atrás: Subtítulos
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.6rem" }}>
            {importModalTab === "subtitles" ? (
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setImportModalTab("ai")}
              >
                Opciones de IA
              </button>
            ) : (
              <button
                type="button"
                className="btn-cancel"
                onClick={onClose}
              >
                Cancelar
              </button>
            )}

            <button
              type="button"
              className="btn-confirm"
              onClick={onConfirm}
            >
              Confirmar e Importar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
