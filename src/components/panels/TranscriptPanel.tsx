import React from "react";
import { AudioLines, Crosshair, Flame, Loader2, Sparkles } from "lucide-react";
import { BusyState, NormalizedTranscript, ProjectDetail } from "../../types";
import { formatTime } from "../../utils/format";
import { EmptyState } from "../common/EmptyState";
import { invoke } from "../../apiBridge";

interface TranscriptPanelProps {
  detail: ProjectDetail;
  transcript: NormalizedTranscript | null;
  busy: BusyState;
  canTranscribe: boolean;
  transcriptionEngine: string;
  isRefiningTranscript: boolean;
  isDetectingActionCues?: boolean;
  transcriptionProgress?: { percentage: number; message: string } | null;
  onRefineTranscript: () => Promise<void>;
  onDetectActionCues?: () => Promise<void>;
  onCancelTranscription: () => Promise<void>;
  onTranscribe: () => Promise<void>;
}

export function TranscriptPanel({
  detail,
  transcript,
  busy,
  canTranscribe,
  transcriptionEngine,
  isRefiningTranscript,
  isDetectingActionCues = false,
  transcriptionProgress,
  onRefineTranscript,
  onDetectActionCues,
  onCancelTranscription,
  onTranscribe,
}: TranscriptPanelProps) {
  return (
    <section className="panel transcript-panel">
      <div className="panel-heading">
        <div>
          <h3>Transcript</h3>
          <p>{transcript ? `${transcript.segments.length} segments (haz clic para editar texto)` : "No transcript"}</p>
        </div>
        <div className="button-pair">
          {detail?.transcript && (
            <>
              {onDetectActionCues && (
                <button
                  type="button"
                  className="secondary-action"
                  style={{ fontSize: "0.78rem", padding: "0 10px", height: "30px", minHeight: "30px", display: "inline-flex", alignItems: "center", gap: "5px" }}
                  onClick={onDetectActionCues}
                  disabled={isDetectingActionCues || busy !== "idle"}
                  title="Escanear acústicamente disparos en silencios y gritos de streamer"
                >
                  {isDetectingActionCues ? <Loader2 className="spin" size={13} /> : <Crosshair size={13} color="#f87171" />}
                  <span>{isDetectingActionCues ? "Escaneando..." : "Detectar Disparos"}</span>
                </button>
              )}
              <button
                type="button"
                className="secondary-action"
                style={{ fontSize: "0.78rem", padding: "0 10px", height: "30px", minHeight: "30px", display: "inline-flex", alignItems: "center", gap: "5px" }}
                onClick={onRefineTranscript}
                disabled={isRefiningTranscript || busy !== "idle"}
                title="Corregir ortografía, tildes y jerga gamer preservando los timestamps"
              >
                {isRefiningTranscript ? <Loader2 className="spin" size={13} /> : <Sparkles size={13} color="#fafafa" />}
                <span>{isRefiningTranscript ? "Puliendo..." : "Pulir con IA"}</span>
              </button>
            </>
          )}
          {busy === "transcribe" ? (
            <button
              className="btn-cancel"
              onClick={onCancelTranscription}
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                color: "#f87171",
                border: "1px solid #ef4444",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                fontSize: "0.82rem",
              }}
              title="Detener transcripción y liberar recursos"
            >
              <Loader2 className="spin" size={14} />
              Cancelar Transcripción
            </button>
          ) : (
            <button
              onClick={onTranscribe}
              disabled={busy !== "idle" || !canTranscribe}
              style={{
                background: busy !== "idle" || !canTranscribe ? "var(--bg-surface-raised)" : "#fafafa",
                color: busy !== "idle" || !canTranscribe ? "var(--text-muted)" : "#09090b",
                border: busy !== "idle" || !canTranscribe ? "1px solid var(--border-default)" : "1px solid #fafafa",
                fontWeight: 600,
              }}
            >
              <AudioLines size={16} />
              {detail?.transcript ? "Volver a Transcribir" : "Transcribir"}
            </button>
          )}
        </div>
      </div>

      {(busy === "transcribe" || isRefiningTranscript) && (
        <div style={{ padding: "0.6rem 1rem", background: "var(--bg-surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", fontSize: "0.78rem" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {transcriptionProgress?.message || (isRefiningTranscript ? "Puliendo transcripción con IA..." : "Transcribiendo con Whisper...")}
            </span>
            <span style={{ color: "#fafafa", fontWeight: 700, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {transcriptionProgress?.percentage ?? 0}%
            </span>
          </div>
          <div style={{ width: "100%", height: "4px", background: "var(--bg-base)", borderRadius: "2px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(0, transcriptionProgress?.percentage ?? 0))}%`,
                height: "100%",
                background: "#fafafa",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        </div>
      )}

      {!canTranscribe && (
        <div className="api-warning">
          {transcriptionEngine === "local"
            ? `Local Whisper (Python package 'openai-whisper') no está instalado o faltan modelos. Ejecuta 'pip3 install openai-whisper'.`
            : "Falta la API Key de Deepgram. La transcripción no funcionará hasta configurarla en Ajustes."}
        </div>
      )}

      <div className="transcript-list">
        {transcript?.segments.map((segment, index) => {
          const isSFX = segment.speaker === "SFX" || segment.text.includes("(DISPAROS");
          const isShout = segment.text.includes("(GRITOS");
          return (
            <article
              key={`${segment.start}-${index}`}
              className="segment-row"
              style={{
                borderLeft: isSFX ? "3px solid #ef4444" : isShout ? "3px solid #f59e0b" : undefined,
                background: isSFX ? "rgba(239, 68, 68, 0.05)" : isShout ? "rgba(245, 158, 11, 0.04)" : undefined,
                transition: "background 0.2s ease",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                {isSFX && (
                  <span title="Disparos / Acción Acústica" style={{ display: "inline-flex", alignItems: "center" }}>
                    <Crosshair size={12} color="#ef4444" />
                  </span>
                )}
                {isShout && (
                  <span title="Gritos / Euforia de Streamer" style={{ display: "inline-flex", alignItems: "center" }}>
                    <Flame size={12} color="#f59e0b" />
                  </span>
                )}
                {formatTime(segment.start)}
              </span>
              <p
                contentEditable
                suppressContentEditableWarning
                title="Haz clic para editar este texto"
                style={{
                  cursor: "text",
                  outline: "none",
                  borderRadius: "4px",
                  padding: "2px 4px",
                  color: isSFX ? "#fca5a5" : undefined,
                  fontWeight: isSFX ? 600 : undefined,
                }}
                onBlur={(e) => {
                  const newText = e.currentTarget.textContent || "";
                  if (newText !== segment.text) {
                    void invoke("update_transcript_segment", {
                      projectId: detail.project.id,
                      index,
                      text: newText
                    });
                  }
                }}
              >
                {segment.text}
              </p>
            </article>
          );
        }) ?? <EmptyState icon={<AudioLines size={28} />} label="Transcript pending" />}
      </div>
    </section>
  );
}
