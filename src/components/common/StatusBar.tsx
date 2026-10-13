import React from "react";
import { Cpu, Activity, Database, Thermometer } from "lucide-react";
import type { EnvironmentStatus, HardwareTelemetry, LlmMemoryStatus } from "../../types";

interface StatusBarProps {
  environment: EnvironmentStatus | null;
  telemetry: HardwareTelemetry | null;
  canUseCloudKey: boolean;
  canUseOpenrouter?: boolean;
  llmMemoryStatus?: LlmMemoryStatus | null;
  onUnloadLlm?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  environment,
  telemetry,
  canUseCloudKey,
  canUseOpenrouter = false,
  llmMemoryStatus,
  onUnloadLlm,
}) => {
  return (
    <footer className="status-bar">
      <div className="status-bar-left" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <span className="app-status-indicator" style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>System Ready</span>
        {llmMemoryStatus?.isLoaded && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.72rem",
              fontFamily: "var(--font-mono)",
              background: "rgba(16, 185, 129, 0.12)",
              color: "#34d399",
              padding: "2px 8px",
              borderRadius: "4px",
              border: "1px solid rgba(16, 185, 129, 0.3)",
            }}
            title={`Modelo en memoria: ${llmMemoryStatus.loadedModel || 'Cargado'}. Clic en ✕ para liberar RAM.`}
          >
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
            <span>IA en RAM {llmMemoryStatus.sizeMb ? `(${(llmMemoryStatus.sizeMb / 1024).toFixed(1)} GB)` : ""}</span>
            {onUnloadLlm && (
              <button
                type="button"
                onClick={onUnloadLlm}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#f87171",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  lineHeight: 1,
                  padding: "0 2px",
                  marginLeft: "2px",
                  fontWeight: "bold",
                }}
                title="Descargar modelo y liberar memoria VRAM/RAM ahora"
              >
                ✕
              </button>
            )}
          </span>
        )}
        {telemetry && (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", fontSize: "0.74rem", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Uso de Procesador (CPU)">
              <Cpu size={12} color="#a1a1aa" />
              <span>CPU: {telemetry.cpuUsagePercent}%</span>
            </span>
            {telemetry.hasGpu && (
              <>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title={telemetry.gpuName}>
                  <Activity size={12} color="#10b981" />
                  <span>GPU: {telemetry.gpuUsagePercent}%</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Memoria de Video VRAM Usada">
                  <Database size={12} color="#f59e0b" />
                  <span>
                    VRAM: {(telemetry.vramUsedMb / 1024).toFixed(1)} / {(telemetry.vramTotalMb / 1024).toFixed(1)} GB ({telemetry.vramUsagePercent}%)
                  </span>
                </span>
                {telemetry.gpuTempC > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }} title="Temperatura de GPU">
                    <Thermometer size={12} color={telemetry.gpuTempC > 75 ? "#ef4444" : "#10b981"} />
                    <span>{telemetry.gpuTempC}°C</span>
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="status-bar-right">
        <div className="status-indicators">
          <span className={`indicator ${environment?.hasFfmpeg ? "active" : ""}`} title="FFmpeg status">
            ffmpeg
          </span>
          <span className={`indicator ${environment?.hasFfprobe ? "active" : ""}`} title="FFprobe status">
            ffprobe
          </span>
          <span className={`indicator ${environment?.hasYtdlp ? "active" : ""}`} title="yt-dlp status">
            yt-dlp
          </span>
          <span className={`indicator ${environment?.hasLocalWhisperModel ? "active" : ""}`} title="Whisper Model status">
            Whisper Model
          </span>
          <span className={`indicator ${environment?.hasOllama ? "active" : ""}`} title="Ollama status">
            Ollama
          </span>
          <span className={`indicator ${environment?.hasLmStudio ? "active" : ""}`} title="LM Studio status">
            LM Studio
          </span>
          <span className={`indicator ${canUseCloudKey ? "active" : ""}`} title="Deepgram Key status">
            Deepgram
          </span>
          <span className={`indicator ${canUseOpenrouter ? "active" : ""}`} title="OpenRouter Key status">
            OpenRouter
          </span>
        </div>
      </div>
    </footer>
  );
};
