import React from "react";
import { Download, RefreshCw, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  EnvironmentStatus,
  HardwareTelemetry,
  LlmEngine,
  TranscriptionEngine,
  WhisperModel,
} from "../../types";
import {
  ModelBadge,
  getWhisperTrafficLevel,
  getOllamaTrafficLevel,
} from "../common/ModelBadge";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry?: HardwareTelemetry | null;
  transcriptionEngine: TranscriptionEngine;
  setTranscriptionEngine: (engine: TranscriptionEngine) => void;
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  whisperModelsList: WhisperModel[];
  llmEngine: LlmEngine;
  setLlmEngine: (engine: LlmEngine) => void;
  localLlmModel: string;
  setLocalLlmModel: (model: string) => void;
  enableThinking: boolean;
  setEnableThinking: (val: boolean) => void;
  environment: EnvironmentStatus | null;
  onRefreshEnv: () => Promise<void>;
  pullInputModel: string;
  setPullInputModel: (val: string) => void;
  downloadingModelName: string | null;
  modelDownloadStatus: string;
  modelDownloadProgress: number;
  onPullModel: (model: string) => Promise<void>;
  openrouterKey: string;
  setOpenrouterKey: (key: string) => void;
  openrouterModel: string;
  setOpenrouterModel: (model: string) => void;
  lmstudioModel?: string;
  setLmstudioModel?: (model: string) => void;
  lmstudioBaseUrl?: string;
  setLmstudioBaseUrl?: (url: string) => void;
  deepseekKey: string;
  setDeepseekKey: (key: string) => void;
  deepseekModel: string;
  setDeepseekModel: (model: string) => void;
  anthropicKey: string;
  setAnthropicKey: (key: string) => void;
  openaiKey: string;
  setOpenaiKey: (key: string) => void;
  groqKey: string;
  setGroqKey: (key: string) => void;
  geminiKey: string;
  setGeminiKey: (key: string) => void;
  deepgramKey: string;
  setDeepgramKey: (key: string) => void;
  customMomentsPrompt: string;
  setCustomMomentsPrompt: (prompt: string) => void;
  defaultMomentsPrompt: string;
  syncConfig: (updates: Record<string, any>) => void;
  onResetConfig: () => void;
}

export function SettingsPanel({
  isOpen,
  onClose,
  telemetry,
  transcriptionEngine,
  setTranscriptionEngine,
  whisperModel,
  setWhisperModel,
  whisperModelsList,
  llmEngine,
  setLlmEngine,
  localLlmModel,
  setLocalLlmModel,
  enableThinking,
  setEnableThinking,
  environment,
  onRefreshEnv,
  pullInputModel,
  setPullInputModel,
  downloadingModelName,
  modelDownloadStatus,
  modelDownloadProgress,
  onPullModel,
  openrouterKey,
  setOpenrouterKey,
  openrouterModel,
  setOpenrouterModel,
  lmstudioModel = "",
  setLmstudioModel,
  lmstudioBaseUrl = "http://127.0.0.1:1234/v1",
  setLmstudioBaseUrl,
  deepseekKey,
  setDeepseekKey,
  deepseekModel,
  setDeepseekModel,
  anthropicKey,
  setAnthropicKey,
  openaiKey,
  setOpenaiKey,
  groqKey,
  setGroqKey,
  geminiKey,
  setGeminiKey,
  deepgramKey,
  setDeepgramKey,
  customMomentsPrompt,
  setCustomMomentsPrompt,
  defaultMomentsPrompt,
  syncConfig,
  onResetConfig,
}: SettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <div
      className="summary-modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        padding: "1rem"
      }}
    >
      <div
        className="settings-modal-floating"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "880px",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "#121215",
          border: "1px solid #27272a",
          borderRadius: "14px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1.1rem 1.4rem",
            borderBottom: "1px solid #1f1f23",
            background: "#151519"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <SlidersHorizontal size={17} color="#a78bfa" />
            <div>
              <h3 style={{ margin: 0, fontSize: "0.98rem", fontWeight: 700, color: "#fafafa" }}>
                Configuración del Estudio (Modelos & APIs)
              </h3>
              <p style={{ margin: 0, fontSize: "0.74rem", color: "#71717a" }}>
                Administra tus motores de transcripción, modelos locales de Ollama y claves de IA en la nube.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Cerrar configuración"
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "1.35rem" }}>

      <div className="key-stack-horizontal" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
        {/* Transcription Engine */}
        <label>
          <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" }}>MOTOR DE TRANSCRIPCIÓN</span>
          <select
            className="form-select"
            value={transcriptionEngine}
            onChange={(event) => {
              const eng = event.target.value as "deepgram" | "local";
              setTranscriptionEngine(eng);
              syncConfig({ transcriptionEngine: eng });
            }}
            style={{ width: "100%" }}
          >
            <option value="local">Local Whisper (Offline - GPU CUDA)</option>
            <option value="deepgram">Deepgram API (Cloud)</option>
          </select>
        </label>

        {/* Whisper Model Selector (if local) */}
        {transcriptionEngine === "local" && (
          <label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", letterSpacing: "0.04em" }}>MODELO WHISPER (LOCAL)</span>
                {(() => {
                  const traf = getWhisperTrafficLevel(whisperModel, telemetry?.vramTotalMb);
                  return <ModelBadge level={traf.level} label={traf.label} note={traf.note} />;
                })()}
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}>
                {whisperModelsList.find((m) => m.id === whisperModel)?.vram || ""} VRAM
              </span>
            </div>
            <select
              className="form-select"
              value={whisperModel}
              onChange={(event) => {
                setWhisperModel(event.target.value);
                syncConfig({ whisperModel: event.target.value });
              }}
              style={{ width: "100%" }}
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
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "4px", display: "block" }}>
              {whisperModelsList.find((m) => m.id === whisperModel)?.description || "Modelos de alta precisión para GPU NVIDIA."}
            </span>
          </label>
        )}

        {/* LLM Engine */}
        <label>
          <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", letterSpacing: "0.04em", display: "block", marginBottom: "0.4rem" }}>MOTOR DE IA (DETECCIÓN DE MOMENTOS)</span>
          <select
            className="form-select"
            value={llmEngine}
            onChange={(event) => {
              const eng = event.target.value as any;
              setLlmEngine(eng);
              syncConfig({ llmEngine: eng });
            }}
            style={{ width: "100%" }}
          >
            <option value="local">Ollama (Offline Local en tu PC)</option>
            <option value="lmstudio">LM Studio (Local en tu PC - Puerto 1234)</option>
            <option value="openrouter">OpenRouter (Cloud - Por si acaso)</option>
          </select>
        </label>

        {/* Conditional Fields based on LLM Engine */}
        {llmEngine === "local" && (
          <div style={{ gridColumn: "1 / -1", padding: "1rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-primary)" }}>
                  Modelos instalados en tu Ollama local:
                </span>
                {localLlmModel && (() => {
                  const traf = getOllamaTrafficLevel(localLlmModel, telemetry?.vramTotalMb);
                  return <ModelBadge level={traf.level} label={traf.label} note={traf.note} />;
                })()}
              </div>
              <button
                type="button"
                className="btn-cancel"
                style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                onClick={() => void onRefreshEnv()}
                title="Actualizar lista de modelos desde Ollama"
              >
                <RefreshCw size={12} /> Refrescar lista
              </button>
            </div>

            {environment?.installedOllamaModels && environment.installedOllamaModels.length > 0 ? (
              <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "0.8rem" }}>
                <select
                  className="form-select"
                  value={localLlmModel}
                  onChange={(event) => {
                    setLocalLlmModel(event.target.value);
                    syncConfig({ localLlmModel: event.target.value });
                  }}
                  style={{ flex: 1, padding: "0.5rem 0.75rem" }}
                >
                  {environment.installedOllamaModels.map((m) => {
                    const traf = getOllamaTrafficLevel(m, telemetry?.vramTotalMb);
                    return (
                      <option key={m} value={m}>
                        {m} — {traf.label} {m.includes("qwen") ? "(Recomendado para AutoShorts)" : ""}
                      </option>
                    );
                  })}
                </select>
                <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-default)", padding: "6px 10px", borderRadius: "6px", whiteSpace: "nowrap" }}>
                  {environment.installedOllamaModels.length} modelos detectados
                </span>
              </div>
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "0.4rem 0", marginBottom: "0.6rem" }}>
                No se detectaron modelos activos en Ollama (http://127.0.0.1:11434). Asegúrate de tener la app de Ollama abierta.
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0.6rem 0", padding: "0.6rem 0.85rem", background: "rgba(255, 255, 255, 0.02)", borderRadius: "6px", border: "1px solid var(--border-default)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.82rem" }}>
                <input
                  type="checkbox"
                  checked={enableThinking}
                  onChange={(e) => {
                    setEnableThinking(e.target.checked);
                    localStorage.setItem("autoshorts_enable_thinking", String(e.target.checked));
                  }}
                  style={{ cursor: "pointer", width: "15px", height: "15px", accentColor: "#fafafa" }}
                />
                <span style={{ color: "var(--text-primary)" }}>Activar modo razonamiento (Thinking / CoT en Ollama)</span>
              </label>
              <span style={{ fontSize: "0.72rem", color: enableThinking ? "#e4e4e7" : "var(--text-muted)", fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>
                {enableThinking ? "Modo razonamiento (análisis profundo)" : "Modo estándar (rápido)"}
              </span>
            </div>

            {/* Optional Pull another model */}
            <div style={{ paddingTop: "0.8rem", marginTop: "0.6rem", borderTop: "1px solid var(--border-default)" }}>
              <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.4rem" }}>
                Descargar otro modelo desde la biblioteca de Ollama:
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej: llama3.2, mistral, deepseek-r1:8b"
                  value={pullInputModel}
                  onChange={(e) => setPullInputModel(e.target.value)}
                  style={{ flex: 1, padding: "0.45rem 0.75rem", fontSize: "0.85rem" }}
                />
                <button
                  type="button"
                  className="btn-confirm"
                  style={{ height: "36px", padding: "0 14px", fontSize: "0.8rem", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  disabled={!pullInputModel.trim() || Boolean(downloadingModelName)}
                  onClick={() => {
                    if (pullInputModel.trim()) {
                      void onPullModel(pullInputModel.trim()).then(() => {
                        setLocalLlmModel(pullInputModel.trim());
                        syncConfig({ localLlmModel: pullInputModel.trim() });
                        setPullInputModel("");
                      });
                    }
                  }}
                >
                  <Download size={13} /> Descargar (Pull)
                </button>
              </div>
              {downloadingModelName && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)" }}>
                  {modelDownloadStatus} ({modelDownloadProgress}%)
                </div>
              )}
            </div>
          </div>
        )}

        {/* OpenRouter */}
        {llmEngine === "openrouter" && (
          <div style={{ gridColumn: "1 / -1", padding: "1rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <label>
                <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>OPENROUTER API KEY</span>
                <input
                  type="password"
                  className="form-input"
                  value={openrouterKey}
                  onChange={(event) => {
                    setOpenrouterKey(event.target.value);
                    syncConfig({ openrouterKey: event.target.value });
                  }}
                  placeholder={environment?.hasOpenrouterKey ? "Cargado desde variables de entorno" : "sk-or-v1-..."}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>MODELO DE OPENROUTER</span>
                <input
                  type="text"
                  className="form-input"
                  value={openrouterModel}
                  onChange={(event) => {
                    setOpenrouterModel(event.target.value);
                    syncConfig({ openrouterModel: event.target.value });
                  }}
                  placeholder="meta-llama/llama-3.3-70b-instruct:free"
                  style={{ width: "100%" }}
                />
              </label>
            </div>

            <div style={{ padding: "0.6rem 0.8rem", borderRadius: "6px", background: "rgba(255, 255, 255, 0.02)", border: "1px solid var(--border-default)", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
              <strong style={{ color: "var(--text-primary)" }}>Protección Anti-Saturación:</strong> AutoShorts incorpora pausas de 2.5s entre bloques y reintentos automáticos con espera exponencial ante códigos 429 (Rate Limit).
            </div>
          </div>
        )}

        {/* LM Studio */}
        {llmEngine === "lmstudio" && (
          <div style={{ gridColumn: "1 / -1", padding: "1rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text-primary)" }}>
                  Modelos detectados en LM Studio:
                </span>
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    background: environment?.hasLmStudio ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    color: environment?.hasLmStudio ? "#10b981" : "#ef4444",
                    border: `1px solid ${environment?.hasLmStudio ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`
                  }}
                >
                  {environment?.hasLmStudio ? "Servidor Conectado" : "Servidor No Detectado"}
                </span>
              </div>
              <button
                type="button"
                className="btn-cancel"
                style={{ height: "28px", padding: "0 10px", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "6px" }}
                onClick={() => void onRefreshEnv()}
                title="Actualizar lista de modelos desde LM Studio"
              >
                <RefreshCw size={12} /> Refrescar lista
              </button>
            </div>

            {environment?.installedLmStudioModels && environment.installedLmStudioModels.length > 0 ? (
              <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "0.8rem" }}>
                <select
                  className="form-select"
                  value={lmstudioModel || environment.installedLmStudioModels[0] || ""}
                  onChange={(event) => {
                    if (setLmstudioModel) setLmstudioModel(event.target.value);
                    syncConfig({ lmstudioModel: event.target.value });
                  }}
                  style={{ flex: 1, padding: "0.5rem 0.75rem" }}
                >
                  {environment.installedLmStudioModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)", background: "rgba(255, 255, 255, 0.03)", border: "1px solid var(--border-default)", padding: "6px 10px", borderRadius: "6px", whiteSpace: "nowrap" }}>
                  {environment.installedLmStudioModels.length} modelos cargados
                </span>
              </div>
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", padding: "0.4rem 0", marginBottom: "0.6rem" }}>
                No se detectaron modelos en LM Studio. Asegúrate de tener LM Studio abierto con un modelo cargado y el servidor local encendido (puerto 1234).
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.6rem", marginTop: "0.4rem" }}>
              <label>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>
                  URL del Servidor Local de LM Studio (OpenAI Compatible):
                </span>
                <input
                  type="text"
                  className="form-input"
                  value={lmstudioBaseUrl}
                  onChange={(e) => {
                    if (setLmstudioBaseUrl) setLmstudioBaseUrl(e.target.value);
                    syncConfig({ lmstudioBaseUrl: e.target.value });
                  }}
                  placeholder="http://127.0.0.1:1234/v1"
                  style={{ width: "100%", fontSize: "0.78rem", padding: "0.4rem 0.6rem" }}
                />
              </label>
            </div>
          </div>
        )}

        {/* Deepgram Key if selected */}
        {transcriptionEngine === "deepgram" && (
          <label style={{ gridColumn: "1 / -1" }}>
            <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.3rem" }}>DEEPGRAM API KEY</span>
            <input
              type="password"
              className="form-input"
              value={deepgramKey}
              onChange={(event) => {
                setDeepgramKey(event.target.value);
                syncConfig({ deepgramKey: event.target.value });
              }}
              placeholder={environment?.hasDeepgramKey ? "Cargado desde env" : "Token Deepgram..."}
              style={{ width: "100%" }}
            />
          </label>
        )}
      </div>

      {/* Custom Prompt for Moments */}
      <div style={{ marginTop: "1.25rem", padding: "1rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: "0.82rem", display: "block", color: "var(--text-primary)" }}>
              Prompt del Sistema para Detección de Momentos
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Instrucciones que guían a la IA para evaluar ganchos, interés y selección de candidatos.
            </span>
          </div>
          <button
            type="button"
            className="btn-cancel"
            style={{ fontSize: "0.75rem", padding: "0 10px", height: "28px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            onClick={() => {
              setCustomMomentsPrompt("");
              syncConfig({ customMomentsPrompt: "" });
            }}
            title="Restablecer al prompt original por defecto"
          >
            <RotateCcw size={12} /> Restablecer por defecto
          </button>
        </div>
        <textarea
          className="form-input"
          rows={6}
          value={customMomentsPrompt || defaultMomentsPrompt}
          onChange={(e) => {
            setCustomMomentsPrompt(e.target.value);
            syncConfig({ customMomentsPrompt: e.target.value });
          }}
          placeholder="Escribe o personaliza las instrucciones del sistema..."
          style={{ width: "100%", fontSize: "0.78rem", fontFamily: "var(--font-mono, monospace)", lineHeight: "1.5", resize: "vertical" }}
        />
        {customMomentsPrompt && (
          <div style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono, monospace)" }}>
            Prompt personalizado activo. Haz clic en "Restablecer por defecto" para volver a la configuración estándar.
          </div>
        )}
      </div>

      <div style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          type="button"
          className="btn-cancel"
          style={{ background: "rgba(239, 68, 68, 0.05)", borderColor: "rgba(239, 68, 68, 0.25)", color: "#f87171", padding: "0 14px", height: "32px", fontSize: "0.78rem" }}
          onClick={() => {
            if (window.confirm("¿Seguro que deseas reiniciar la configuración y volver al asistente inicial?")) {
              onResetConfig();
            }
          }}
        >
          Reiniciar configuración y asistente
        </button>

        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Las configuraciones se guardan automáticamente en tu sistema.
        </span>
      </div>
        </div>
      </div>
    </div>
  );
}
