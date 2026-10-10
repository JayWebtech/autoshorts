import React from "react";
import { Cpu, Activity, Database, Thermometer } from "lucide-react";
import type { EnvironmentStatus, HardwareTelemetry } from "../../types";

interface StatusBarProps {
  environment: EnvironmentStatus | null;
  telemetry: HardwareTelemetry | null;
  canUseCloudKey: boolean;
  canUseOpenrouter?: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  environment,
  telemetry,
  canUseCloudKey,
  canUseOpenrouter = false,
}) => {
  return (
    <footer className="status-bar">
      <div className="status-bar-left" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <span className="app-status-indicator" style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>System Ready</span>
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
