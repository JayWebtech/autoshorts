import React, { useMemo, useState } from "react";
import { Bot, Download, Eye, EyeOff, Mic, RefreshCw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import {
  DEFAULT_WHISPER_MODELS,
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
  sortWhisperModels,
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
  environment: EnvironmentStatus | null;
  onRefreshEnv: () => Promise<void>;
  pullInputModel: string;
  setPullInputModel: (val: string) => void;
  downloadingModelName: string | null;
  modelDownloadStatus: string;
  modelDownloadProgress: number;
  onPullModel: (model: string) => Promise<void>;
  lmstudioModel?: string;
  setLmstudioModel?: (model: string) => void;
  lmstudioBaseUrl?: string;
  setLmstudioBaseUrl?: (url: string) => void;
  openRouterKey?: string;
  setOpenRouterKey?: (key: string) => void;
  openRouterModel?: string;
  setOpenRouterModel?: (model: string) => void;
  openRouterIsFree?: boolean;
  setOpenRouterIsFree?: (isFree: boolean) => void;
  openRouterContextSize?: number;
  setOpenRouterContextSize?: (size: number) => void;
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
  whisperModel,
  setWhisperModel,
  whisperModelsList,
  llmEngine,
  setLlmEngine,
  localLlmModel,
  setLocalLlmModel,
  environment,
  onRefreshEnv,
  pullInputModel,
  setPullInputModel,
  downloadingModelName,
  modelDownloadStatus,
  modelDownloadProgress,
  onPullModel,
  lmstudioModel = "",
  setLmstudioModel,
  lmstudioBaseUrl = "http://127.0.0.1:1234/v1",
  setLmstudioBaseUrl,
  openRouterKey = "",
  setOpenRouterKey,
  openRouterModel = "openrouter/free",
  setOpenRouterModel,
  openRouterIsFree = true,
  setOpenRouterIsFree,
  openRouterContextSize = 16384,
  setOpenRouterContextSize,
  customMomentsPrompt,
  setCustomMomentsPrompt,
  defaultMomentsPrompt,
  syncConfig,
  onResetConfig,
}: SettingsPanelProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const effectiveWhisperModels = useMemo(() => {
    return whisperModelsList && whisperModelsList.length > 0
      ? whisperModelsList
      : DEFAULT_WHISPER_MODELS;
  }, [whisperModelsList]);

  const sortedWhisper = useMemo(() => {
    return sortWhisperModels(effectiveWhisperModels, telemetry?.vramTotalMb, telemetry?.hasGpu);
  }, [effectiveWhisperModels, telemetry?.vramTotalMb, telemetry?.hasGpu]);

  const ollamaCount = environment?.installedOllamaModels?.length ?? 0;
  const lmStudioCount = environment?.installedLmStudioModels?.length ?? 0;

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
        background: "rgba(0, 0, 0, 0.78)",
        backdropFilter: "blur(8px)",
        padding: "1rem",
      }}
    >
      <div
        className="settings-modal-floating"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "840px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#111114",
          border: "1px solid #27272a",
          borderRadius: "14px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)",
          overflow: "hidden",
        }}
      >
        {/* Cabecera del Modal */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1.1rem 1.4rem",
            borderBottom: "1px solid #1f1f23",
            background: "#16161a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "rgba(167, 139, 250, 0.12)",
                border: "1px solid rgba(167, 139, 250, 0.25)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <SlidersHorizontal size={18} color="#a78bfa" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#fafafa" }}>
                  Configuración del Estudio
                </h3>
                {telemetry?.hasGpu ? (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#34d399",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    GPU: {telemetry.gpuName} ({(telemetry.vramTotalMb / 1024).toFixed(1)} GB VRAM)
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      padding: "2px 8px",
                      borderRadius: "12px",
                      background: "rgba(255, 255, 255, 0.08)",
                      color: "#a1a1aa",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      fontWeight: 600,
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  >
                    Modo CPU (INT8)
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#a1a1aa" }}>
                Ajusta tus motores locales de transcripción y servidores de lenguaje para extracción de clips.
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

        {/* Cuerpo Scrollable con 3 Tarjetas */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>

          {/* TARJETA 1: Transcripción con Faster-Whisper */}
          <div
            style={{
              padding: "1.1rem",
              borderRadius: "10px",
              background: "#16161b",
              border: "1px solid #27272a",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "0.6rem", borderBottom: "1px solid #202026" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Mic size={16} color="#60a5fa" />
                <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fafafa" }}>
                  1. Transcripción de Audio (Faster-Whisper)
                </span>
              </div>
              <span
                style={{
                  fontSize: "0.7rem",
                  color: telemetry?.hasGpu ? "#34d399" : "#a1a1aa",
                  background: telemetry?.hasGpu ? "rgba(16, 185, 129, 0.1)" : "rgba(255, 255, 255, 0.05)",
                  border: `1px solid ${telemetry?.hasGpu ? "rgba(16, 185, 129, 0.25)" : "rgba(255, 255, 255, 0.1)"}`,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontWeight: 600,
                }}
              >
                {telemetry?.hasGpu ? "Aceleración CUDA (CTranslate2)" : "Aceleración CPU (INT8)"}
              </span>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
                <label style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-secondary)", letterSpacing: "0.03em" }}>
                  MODELO WHISPER SELECCIONADO
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {(() => {
                    const traf = getWhisperTrafficLevel(whisperModel, telemetry?.vramTotalMb, telemetry?.hasGpu);
                    return <ModelBadge level={traf.level} label={traf.label} note={traf.note} />;
                  })()}
                  <span style={{ fontSize: "0.72rem", color: "#60a5fa", fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                    {effectiveWhisperModels.find((m) => m.id === whisperModel)?.vram || ""} VRAM
                  </span>
                </div>
              </div>

              <select
                className="form-select"
                value={whisperModel}
                onChange={(event) => {
                  setWhisperModel(event.target.value);
                  syncConfig({ whisperModel: event.target.value });
                }}
                style={{ width: "100%", padding: "0.5rem 0.75rem", fontSize: "0.85rem", borderRadius: "6px" }}
              >
                {sortedWhisper.downloaded.length > 0 && (
                  <optgroup label="✓ Modelos descargados en tu equipo">
                    {sortedWhisper.downloaded.map((m) => {
                      const traf = getWhisperTrafficLevel(m.id, telemetry?.vramTotalMb, telemetry?.hasGpu);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.vram}) - {traf.label}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {sortedWhisper.available.length > 0 && (
                  <optgroup label="Disponibles para descargar automáticamente al usar">
                    {sortedWhisper.available.map((m) => {
                      const traf = getWhisperTrafficLevel(m.id, telemetry?.vramTotalMb, telemetry?.hasGpu);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.vram}) - {traf.label}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
                {sortedWhisper.downloaded.length === 0 && sortedWhisper.available.length === 0 && (
                  <optgroup label="Modelos Faster-Whisper disponibles">
                    {effectiveWhisperModels.map((m) => {
                      const traf = getWhisperTrafficLevel(m.id, telemetry?.vramTotalMb, telemetry?.hasGpu);
                      return (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.vram}) - {traf.label}
                        </option>
                      );
                    })}
                  </optgroup>
                )}
              </select>

              <div style={{ marginTop: "0.5rem", fontSize: "0.74rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {(() => {
                  const m = effectiveWhisperModels.find((x) => x.id === whisperModel);
                  const traf = getWhisperTrafficLevel(whisperModel, telemetry?.vramTotalMb, telemetry?.hasGpu);
                  return (
                    <span>
                      <strong style={{ color: "#e4e4e7" }}>{m?.desc || "Modelo de Whisper optimizado."}</strong>
                      {traf.note && <span style={{ marginLeft: "4px", color: "#a1a1aa" }}>({traf.note})</span>}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* TARJETA 2: Servidor de Inteligencia Artificial (Ollama / LM Studio) */}
          <div
            style={{
              padding: "1.1rem",
              borderRadius: "10px",
              background: "#16161b",
              border: "1px solid #27272a",
              display: "flex",
              flexDirection: "column",
              gap: "0.85rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "0.6rem", borderBottom: "1px solid #202026" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Bot size={16} color="#a78bfa" />
                <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fafafa" }}>
                  2. Motor de IA Local (Detección de Momentos Virales)
                </span>
              </div>
              <span style={{ fontSize: "0.72rem", color: "#a1a1aa" }}>
                100% Local (Cero Coste de API)
              </span>
            </div>

            {/* Selector de Motor Tipo Tabs / Segmented Buttons */}
            <div>
              <span style={{ fontWeight: 600, fontSize: "0.76rem", color: "var(--text-secondary)", letterSpacing: "0.03em", display: "block", marginBottom: "0.45rem" }}>
                PROVEEDOR ACTIVO
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.65rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setLlmEngine("local");
                    syncConfig({ llmEngine: "local" });
                  }}
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderRadius: "8px",
                    border: llmEngine === "local" ? "2px solid #a78bfa" : "1px solid #27272a",
                    background: llmEngine === "local" ? "rgba(167, 139, 250, 0.1)" : "rgba(255, 255, 255, 0.02)",
                    color: llmEngine === "local" ? "#fafafa" : "#a1a1aa",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: environment?.hasOllama ? "#10b981" : "#71717a" }} />
                    <span style={{ fontWeight: 700, fontSize: "0.84rem" }}>Ollama (Local)</span>
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: environment?.hasOllama ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)", color: environment?.hasOllama ? "#34d399" : "#71717a" }}>
                    {environment?.hasOllama ? `${ollamaCount} modelos` : "Desconectado"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLlmEngine("lmstudio");
                    syncConfig({ llmEngine: "lmstudio" });
                  }}
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderRadius: "8px",
                    border: llmEngine === "lmstudio" ? "2px solid #60a5fa" : "1px solid #27272a",
                    background: llmEngine === "lmstudio" ? "rgba(96, 165, 250, 0.1)" : "rgba(255, 255, 255, 0.02)",
                    color: llmEngine === "lmstudio" ? "#fafafa" : "#a1a1aa",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: environment?.hasLmStudio ? "#10b981" : "#71717a" }} />
                    <span style={{ fontWeight: 700, fontSize: "0.84rem" }}>LM Studio (Puerto 1234)</span>
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: environment?.hasLmStudio ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)", color: environment?.hasLmStudio ? "#34d399" : "#71717a" }}>
                    {environment?.hasLmStudio ? `${lmStudioCount} cargados` : "Desconectado"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLlmEngine("openrouter");
                    syncConfig({ llmEngine: "openrouter" });
                  }}
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderRadius: "8px",
                    border: llmEngine === "openrouter" ? "2px solid #38bdf8" : "1px solid #27272a",
                    background: llmEngine === "openrouter" ? "rgba(56, 189, 248, 0.1)" : "rgba(255, 255, 255, 0.02)",
                    color: llmEngine === "openrouter" ? "#fafafa" : "#a1a1aa",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: openRouterKey.trim() ? "#10b981" : "#f59e0b" }} />
                    <span style={{ fontWeight: 700, fontSize: "0.84rem" }}>OpenRouter (Cloud)</span>
                  </div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: openRouterKey.trim() ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)", color: openRouterKey.trim() ? "#34d399" : "#fbbf24" }}>
                    {openRouterKey.trim() ? "Listo" : "Sin Clave"}
                  </span>
                </button>
              </div>
            </div>

            {/* Ajustes específicos de Ollama */}
            {llmEngine === "local" && (
              <div style={{ marginTop: "0.4rem", padding: "0.85rem", borderRadius: "8px", background: "rgba(0, 0, 0, 0.25)", border: "1px solid #202025" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)" }}>
                      Modelo de Ollama:
                    </span>
                    {localLlmModel && (() => {
                      const traf = getOllamaTrafficLevel(localLlmModel, telemetry?.vramTotalMb, telemetry?.hasGpu);
                      return <ModelBadge level={traf.level} label={traf.label} note={traf.note} />;
                    })()}
                  </div>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                    onClick={() => void onRefreshEnv()}
                    title="Actualizar lista de modelos desde Ollama"
                  >
                    <RefreshCw size={11} /> Refrescar
                  </button>
                </div>

                {environment?.installedOllamaModels && environment.installedOllamaModels.length > 0 ? (
                  <select
                    className="form-select"
                    value={localLlmModel}
                    onChange={(event) => {
                      setLocalLlmModel(event.target.value);
                      syncConfig({ localLlmModel: event.target.value });
                    }}
                    style={{ width: "100%", padding: "0.45rem 0.65rem", fontSize: "0.83rem", borderRadius: "6px" }}
                  >
                    {environment.installedOllamaModels.map((m) => {
                      const traf = getOllamaTrafficLevel(m, telemetry?.vramTotalMb, telemetry?.hasGpu);
                      return (
                        <option key={m} value={m}>
                          {m} ({traf.label}) {m.includes("qwen") ? "[Recomendado para clips]" : ""}
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <div style={{ fontSize: "0.78rem", color: "#f59e0b", padding: "0.3rem 0" }}>
                    No se detectaron modelos activos en Ollama (:11434). Inicia la app de Ollama o descarga uno abajo.
                  </div>
                )}

                {/* Descarga opcional de modelos Ollama */}
                <div style={{ marginTop: "0.75rem", paddingTop: "0.65rem", borderTop: "1px solid #27272a" }}>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.35rem" }}>
                    Descargar otro modelo en Ollama:
                  </span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ej: qwen2.5:7b, llama3.2, mistral"
                      value={pullInputModel}
                      onChange={(e) => setPullInputModel(e.target.value)}
                      style={{ flex: 1, padding: "0.4rem 0.65rem", fontSize: "0.82rem" }}
                    />
                    <button
                      type="button"
                      className="btn-confirm"
                      style={{ height: "34px", padding: "0 12px", fontSize: "0.78rem", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "6px" }}
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
                    <div style={{ marginTop: "0.4rem", fontSize: "0.76rem", color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)" }}>
                      {modelDownloadStatus} ({modelDownloadProgress}%)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Ajustes específicos de LM Studio */}
            {llmEngine === "lmstudio" && (
              <div style={{ marginTop: "0.4rem", padding: "0.85rem", borderRadius: "8px", background: "rgba(0, 0, 0, 0.25)", border: "1px solid #202025" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)" }}>
                      Modelo cargado en LM Studio:
                    </span>
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: environment?.hasLmStudio ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                        color: environment?.hasLmStudio ? "#10b981" : "#ef4444",
                        border: `1px solid ${environment?.hasLmStudio ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                      }}
                    >
                      {environment?.hasLmStudio ? "Servidor Conectado" : "Servidor No Detectado"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                    onClick={() => void onRefreshEnv()}
                    title="Actualizar lista de modelos desde LM Studio"
                  >
                    <RefreshCw size={11} /> Refrescar
                  </button>
                </div>

                {environment?.installedLmStudioModels && environment.installedLmStudioModels.length > 0 ? (
                  <select
                    className="form-select"
                    value={lmstudioModel || environment.installedLmStudioModels[0] || ""}
                    onChange={(event) => {
                      if (setLmstudioModel) setLmstudioModel(event.target.value);
                      syncConfig({ lmstudioModel: event.target.value });
                    }}
                    style={{ width: "100%", padding: "0.45rem 0.65rem", fontSize: "0.83rem", borderRadius: "6px" }}
                  >
                    {environment.installedLmStudioModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: "0.78rem", color: "#f59e0b", padding: "0.3rem 0" }}>
                    No se detectaron modelos en LM Studio. Inicia LM Studio en el puerto 1234 y carga un modelo en memoria.
                  </div>
                )}

                <div style={{ marginTop: "0.75rem", paddingTop: "0.65rem", borderTop: "1px solid #27272a" }}>
                  <label style={{ fontSize: "0.74rem", color: "var(--text-secondary)", display: "block", marginBottom: "0.35rem" }}>
                    URL del servidor local de LM Studio:
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={lmstudioBaseUrl}
                    onChange={(e) => {
                      if (setLmstudioBaseUrl) setLmstudioBaseUrl(e.target.value);
                      syncConfig({ lmstudioBaseUrl: e.target.value });
                    }}
                    placeholder="http://127.0.0.1:1234/v1"
                    style={{ width: "100%", padding: "0.4rem 0.65rem", fontSize: "0.82rem", fontFamily: "var(--font-mono, monospace)" }}
                  />
                </div>
              </div>
            )}

            {/* Ajustes específicos de OpenRouter */}
            {llmEngine === "openrouter" && (
              <div style={{ marginTop: "0.4rem", padding: "0.85rem", borderRadius: "8px", background: "rgba(0, 0, 0, 0.25)", border: "1px solid #202025", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* 1. API Key */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                    <label style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)" }}>
                      API Key de OpenRouter:
                    </label>
                    <span style={{ fontSize: "0.7rem", color: openRouterKey.trim() ? "#34d399" : "#fbbf24", fontWeight: 600 }}>
                      {openRouterKey.trim() ? "Clave configurada" : "Falta ingresar clave"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type={showApiKey ? "text" : "password"}
                      className="form-input"
                      value={openRouterKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (setOpenRouterKey) setOpenRouterKey(val);
                      }}
                      placeholder="sk-or-v1-..."
                      style={{ flex: 1, padding: "0.4rem 0.65rem", fontSize: "0.82rem", fontFamily: "var(--font-mono, monospace)" }}
                    />
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ padding: "0 10px", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.72rem" }}
                      title={showApiKey ? "Ocultar clave" : "Mostrar clave"}
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      <span>{showApiKey ? "Ocultar" : "Mostrar"}</span>
                    </button>
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.25rem", display: "block" }}>
                    Tu clave se guarda localmente en este equipo y nunca se comparte externamente.
                  </span>
                </div>

                {/* 2. Modelo */}
                <div style={{ borderTop: "1px solid #202025", paddingTop: "0.65rem" }}>
                  <label style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)", display: "block", marginBottom: "0.35rem" }}>
                    Modelo de OpenRouter:
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={openRouterModel}
                    onChange={(e) => {
                      if (setOpenRouterModel) setOpenRouterModel(e.target.value);
                    }}
                    placeholder="openrouter/free"
                    style={{ width: "100%", padding: "0.4rem 0.65rem", fontSize: "0.82rem", fontFamily: "var(--font-mono, monospace)", marginBottom: "0.4rem" }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", alignSelf: "center", marginRight: "2px" }}>Presets:</span>
                    {[
                      { label: "openrouter/free (Gratis)", id: "openrouter/free" },
                      { label: "Llama 3.3 70B (Gratis)", id: "meta-llama/llama-3.3-70b-instruct:free" },
                      { label: "Gemini 2.0 Flash (Gratis)", id: "google/gemini-2.0-flash-exp:free" },
                      { label: "DeepSeek Chat (Pago)", id: "deepseek/deepseek-chat" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          if (setOpenRouterModel) setOpenRouterModel(m.id);
                          if (m.id.includes(":free") || m.id === "openrouter/free") {
                            if (setOpenRouterIsFree) setOpenRouterIsFree(true);
                          } else {
                            if (setOpenRouterIsFree) setOpenRouterIsFree(false);
                          }
                        }}
                        style={{
                          fontSize: "0.68rem",
                          padding: "2px 7px",
                          borderRadius: "4px",
                          border: openRouterModel === m.id ? "1px solid #38bdf8" : "1px solid #27272a",
                          background: openRouterModel === m.id ? "rgba(56, 189, 248, 0.15)" : "#18181b",
                          color: openRouterModel === m.id ? "#38bdf8" : "#a1a1aa",
                          cursor: "pointer",
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Modalidad Free vs Pago */}
                <div style={{ borderTop: "1px solid #202025", paddingTop: "0.65rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                    <label style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)" }}>
                      Modalidad del Modelo:
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (setOpenRouterIsFree) setOpenRouterIsFree(true);
                      }}
                      style={{
                        padding: "0.5rem 0.65rem",
                        borderRadius: "6px",
                        border: openRouterIsFree ? "1.5px solid #34d399" : "1px solid #27272a",
                        background: openRouterIsFree ? "rgba(16, 185, 129, 0.12)" : "transparent",
                        color: openRouterIsFree ? "#fafafa" : "#a1a1aa",
                        cursor: "pointer",
                        fontSize: "0.78rem",
                        fontWeight: openRouterIsFree ? 700 : 500,
                        textAlign: "left",
                      }}
                    >
                      <div>Modelo Free (50 req/día)</div>
                      <div style={{ fontSize: "0.68rem", opacity: 0.7, marginTop: "2px" }}>Macro-chunks de 15m (ahorro de cuota)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (setOpenRouterIsFree) setOpenRouterIsFree(false);
                      }}
                      style={{
                        padding: "0.5rem 0.65rem",
                        borderRadius: "6px",
                        border: !openRouterIsFree ? "1.5px solid #60a5fa" : "1px solid #27272a",
                        background: !openRouterIsFree ? "rgba(96, 165, 250, 0.12)" : "transparent",
                        color: !openRouterIsFree ? "#fafafa" : "#a1a1aa",
                        cursor: "pointer",
                        fontSize: "0.78rem",
                        fontWeight: !openRouterIsFree ? 700 : 500,
                        textAlign: "left",
                      }}
                    >
                      <div>Modelo Pago (Sin Límite)</div>
                      <div style={{ fontSize: "0.68rem", opacity: 0.7, marginTop: "2px" }}>Inferencia directa sin pausas de ráfaga</div>
                    </button>
                  </div>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.35rem", display: "block" }}>
                    {openRouterIsFree
                      ? "Macro-compactación activa: comprime el stream en 2 o 3 bloques grandes para un video de 30m, permitiendo analizar hasta 15-20 grabaciones al día dentro de tus 50 peticiones gratuitas."
                      : "Modo sin restricciones de cuota diaria activa."}
                  </span>
                </div>

                {/* 4. Ventana de Contexto */}
                <div style={{ borderTop: "1px solid #202025", paddingTop: "0.65rem" }}>
                  <label style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--text-primary)", display: "block", marginBottom: "0.35rem" }}>
                    Ventana de Contexto (Context Window):
                  </label>
                  <select
                    className="form-select"
                    value={openRouterContextSize}
                    onChange={(e) => {
                      if (setOpenRouterContextSize) setOpenRouterContextSize(Number(e.target.value));
                    }}
                    style={{ width: "100%", padding: "0.4rem 0.65rem", fontSize: "0.82rem" }}
                  >
                    <option value={16384}>16,384 tokens (Recomendado - 2 a 3 peticiones por video)</option>
                    <option value={8192}>8,192 tokens (Estándar)</option>
                    <option value={32768}>32,768 tokens (Modelos grandes)</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* TARJETA 3: Instrucciones del Sistema (Prompt de Extracción) */}
          <div
            style={{
              padding: "1.1rem",
              borderRadius: "10px",
              background: "#16161b",
              border: "1px solid #27272a",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={16} color="#38bdf8" />
                <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fafafa" }}>
                  3. Prompt del Sistema para Detección de Momentos
                </span>
              </div>
              <button
                type="button"
                className="btn-cancel"
                style={{ height: "26px", padding: "0 8px", fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                onClick={() => {
                  setCustomMomentsPrompt("");
                  localStorage.removeItem("autoshorts_custom_moments_prompt");
                  syncConfig({ customMomentsPrompt: "" });
                }}
                title="Restablecer al prompt estándar"
              >
                <RefreshCw size={11} /> Restablecer por defecto
              </button>
            </div>

            <textarea
              className="form-textarea"
              rows={6}
              value={customMomentsPrompt || defaultMomentsPrompt}
              onChange={(e) => {
                setCustomMomentsPrompt(e.target.value);
                localStorage.setItem("autoshorts_custom_moments_prompt", e.target.value);
                syncConfig({ customMomentsPrompt: e.target.value });
              }}
              placeholder="Instrucciones para la IA..."
              style={{
                width: "100%",
                minHeight: "135px",
                maxHeight: "280px",
                fontSize: "0.78rem",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: "1.5",
                resize: "vertical",
                borderRadius: "6px",
                padding: "0.6rem 0.75rem",
              }}
            />
            {customMomentsPrompt && (
              <span style={{ fontSize: "0.72rem", color: "#38bdf8", fontFamily: "var(--font-mono, monospace)" }}>
                Prompt personalizado activo.
              </span>
            )}
          </div>
        </div>

        {/* Pie del Modal con Acciones */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.9rem 1.4rem",
            borderTop: "1px solid #1f1f23",
            background: "#16161a",
          }}
        >
          {confirmReset ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                className="btn-cancel"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  borderColor: "rgba(239, 68, 68, 0.4)",
                  color: "#f87171",
                  padding: "0 12px",
                  height: "32px",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                }}
                onClick={() => {
                  setConfirmReset(false);
                  onResetConfig();
                }}
              >
                ¿Confirmar restablecer?
              </button>
              <button
                type="button"
                className="btn-cancel"
                style={{
                  padding: "0 10px",
                  height: "32px",
                  fontSize: "0.75rem",
                }}
                onClick={() => setConfirmReset(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-cancel"
              style={{
                background: "rgba(239, 68, 68, 0.05)",
                borderColor: "rgba(239, 68, 68, 0.25)",
                color: "#f87171",
                padding: "0 14px",
                height: "32px",
                fontSize: "0.78rem",
              }}
              onClick={() => setConfirmReset(true)}
            >
              Restablecer valores por defecto
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "0.74rem", color: "#71717a" }}>
              Guardado automáticamente
            </span>
            <button
              type="button"
              className="btn-confirm"
              onClick={onClose}
              style={{ height: "34px", padding: "0 16px", fontSize: "0.82rem" }}
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
