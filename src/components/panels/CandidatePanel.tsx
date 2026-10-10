import React, { useState } from "react";
import {
  Scissors,
  Sparkles,
  Loader2,
  SlidersHorizontal,
  Play,
  Check,
  Copy,
  Ratio,
  Filter,
  FileText,
  CheckCheck,
} from "lucide-react";
import type {
  Candidate,
  Clip,
  ProjectDetail,
  BusyState,
  LlmEngine,
  TargetDuration,
  EnvironmentStatus,
} from "../../types";
import { formatTime } from "../../utils/format";

interface CandidatePanelProps {
  detail: ProjectDetail;
  selectedCount: number;
  llmEngine: LlmEngine;
  localLlmModel: string;
  busy: BusyState;
  environment: EnvironmentStatus | null;
  canUseActiveLlm: boolean;
  targetDuration: TargetDuration;
  setTargetDuration: (dur: TargetDuration) => void;
  aspectRatio: "original" | "9:16";
  setAspectRatio: (val: "original" | "9:16") => void;
  enableThinking: boolean;
  setEnableThinking: (val: boolean) => void;
  cutSelected: () => void;
  cancelMoments: () => void;
  moments: (force?: boolean) => void;
  updateClipCount: (count: number) => void;
  clipByCandidate: Map<string, Clip>;
  copiedDescId: string | null;
  copyDescription: (id: string, text: string) => void;
  openCandidatePreview: (candidate: Candidate) => void;
  cutCandidate: (candidateId: string) => void;
  renderingCandidateId: string | null;
  candidateProgress?: { message: string; current: number; total: number } | null;
  regenerateCandidateCopy?: (candidateId: string) => Promise<void>;
  regeneratingCopyCandidateId?: string | null;
}

export const CandidatePanel: React.FC<CandidatePanelProps> = ({
  detail,
  selectedCount,
  llmEngine,
  localLlmModel,
  busy,
  environment,
  canUseActiveLlm,
  targetDuration,
  setTargetDuration,
  aspectRatio,
  setAspectRatio,
  enableThinking,
  setEnableThinking,
  cutSelected,
  cancelMoments,
  moments,
  updateClipCount,
  clipByCandidate,
  copiedDescId,
  copyDescription,
  openCandidatePreview,
  cutCandidate,
  renderingCandidateId,
  candidateProgress,
  regenerateCandidateCopy,
  regeneratingCopyCandidateId,
}) => {
  const [filterTab, setFilterTab] = useState<"all" | "pending" | "exported">("all");
  const [copiedClipPathId, setCopiedClipPathId] = useState<string | null>(null);
  const [copiedHookId, setCopiedHookId] = useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filterTab]);

  const exportedCandidates = detail.candidates.filter((c) => {
    const clip = clipByCandidate.get(c.id);
    return clip?.status === "done" && Boolean(clip.outputPath);
  });

  const pendingCandidates = detail.candidates.filter((c) => {
    const clip = clipByCandidate.get(c.id);
    return !(clip?.status === "done" && Boolean(clip.outputPath));
  });

  const displayedCandidates =
    filterTab === "exported"
      ? exportedCandidates
      : filterTab === "pending"
      ? pendingCandidates
      : detail.candidates;

  const handleCopyPath = (candidateId: string, path: string) => {
    void navigator.clipboard.writeText(path);
    setCopiedClipPathId(candidateId);
    setTimeout(() => {
      setCopiedClipPathId((curr) => (curr === candidateId ? null : curr));
    }, 2000);
  };

  const handleCopyHook = (candidateId: string, hookText: string) => {
    void navigator.clipboard.writeText(hookText);
    setCopiedHookId(candidateId);
    setTimeout(() => {
      setCopiedHookId((curr) => (curr === candidateId ? null : curr));
    }, 2000);
  };
  return (
    <section className="panel candidate-panel">
      <div className="panel-heading">
        <div>
          <h3>Clip Candidates</h3>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "2px" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {detail.candidates.length ? `${selectedCount} seleccionados` : "Sin candidatos"}
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              IA: {llmEngine === "local" ? localLlmModel || "Ollama" : llmEngine.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="button-pair">
          <button
            onClick={cutSelected}
            disabled={busy !== "idle" || selectedCount === 0 || !environment?.hasFfmpeg}
            style={{
              background: busy !== "idle" || selectedCount === 0 ? "var(--bg-surface-raised)" : "#fafafa",
              color: busy !== "idle" || selectedCount === 0 ? "var(--text-muted)" : "#09090b",
              border: busy !== "idle" || selectedCount === 0 ? "1px solid var(--border-default)" : "1px solid #fafafa",
              fontWeight: 600,
            }}
          >
            {busy === "cut" ? <Loader2 className="spin" size={16} /> : <Scissors size={16} />}
            Cortar ({selectedCount})
          </button>
          {busy === "moments" ? (
            <button
              type="button"
              className="btn-cancel"
              onClick={cancelMoments}
              title="Detener la búsqueda y liberar VRAM"
              style={{
                padding: "0.4rem 0.8rem",
                fontSize: "0.82rem",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid #ef4444",
                color: "#f87171",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderRadius: "6px",
                fontWeight: 600,
              }}
            >
              <Loader2 className="spin" size={14} />
              Cancelar Búsqueda
            </button>
          ) : (
            <button
              onClick={() => void moments(false)}
              disabled={busy !== "idle" || !detail.transcript || !canUseActiveLlm}
              style={{
                background: "var(--bg-surface-raised)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-default)",
              }}
            >
              <Sparkles size={16} />
              Buscar Momentos
            </button>
          )}
        </div>
      </div>

      {/* Control bar: Duration, Aspect Ratio, Thinking Mode */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.6rem",
          padding: "0.5rem 1rem",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-default)",
          fontSize: "0.78rem",
        }}
      >
        {/* Duración */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>Duración:</span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
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
                  disabled={busy !== "idle"}
                  style={{
                    padding: "0.2rem 0.5rem",
                    borderRadius: "4px",
                    border: active ? "1px solid #fafafa" : "1px solid var(--border-default)",
                    background: active ? "#fafafa" : "var(--bg-surface-raised)",
                    color: active ? "#09090b" : "var(--text-secondary)",
                    cursor: "pointer",
                    fontSize: "0.72rem",
                    fontWeight: active ? 600 : 400,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {dur === "30s" ? "30s" : dur === "60s" ? "1m" : dur === "2m" ? "2m" : dur === "3m" ? "3m" : "5m"}
                </button>
              );
            })}
          </div>
        </div>

        {/* Formato de Relación de Aspecto */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "3px" }}>
            <Ratio size={12} />
            <span>Formato:</span>
          </span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <button
              type="button"
              onClick={() => setAspectRatio("original")}
              disabled={busy !== "idle"}
              title="Conserva la relación de aspecto nativa del video (panorámico 16:9, etc.)"
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "4px",
                border: aspectRatio === "original" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                background: aspectRatio === "original" ? "#fafafa" : "var(--bg-surface-raised)",
                color: aspectRatio === "original" ? "#09090b" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontWeight: aspectRatio === "original" ? 600 : 400,
              }}
            >
              Original (Nativo)
            </button>
            <button
              type="button"
              onClick={() => setAspectRatio("9:16")}
              disabled={busy !== "idle"}
              title="Recorte centrado 9:16 vertical para TikTok, Reels o YouTube Shorts"
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "4px",
                border: aspectRatio === "9:16" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                background: aspectRatio === "9:16" ? "#fafafa" : "var(--bg-surface-raised)",
                color: aspectRatio === "9:16" ? "#09090b" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.72rem",
                fontWeight: aspectRatio === "9:16" ? 600 : 400,
              }}
            >
              9:16 Vertical
            </button>
          </div>
        </div>

        {/* Modo Thinking */}
        <label
          style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.74rem" }}
          title="Desactívalo para análisis ultrarrápido (Recomendado para RTX 2060)"
        >
          <input
            type="checkbox"
            checked={enableThinking}
            onChange={(e) => {
              setEnableThinking(e.target.checked);
              localStorage.setItem("autoshorts_enable_thinking", String(e.target.checked));
            }}
            style={{ cursor: "pointer", width: "13px", height: "13px", accentColor: "#fafafa" }}
          />
          <span style={{ color: enableThinking ? "#f59e0b" : "var(--text-secondary)", fontWeight: enableThinking ? 600 : 400 }}>
            {enableThinking ? "Thinking CoT (Lento)" : "Modo Rápido"}
          </span>
        </label>
      </div>

      {busy === "moments" && (
        <div style={{ padding: "0.6rem 1rem", background: "var(--bg-surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem", fontSize: "0.78rem" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {candidateProgress?.message || "Buscando momentos clave con IA..."}
            </span>
            <span style={{ color: "#fafafa", fontWeight: 700, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {candidateProgress && candidateProgress.total > 0
                ? Math.round((candidateProgress.current / candidateProgress.total) * 100)
                : 0}
              %
            </span>
          </div>
          <div style={{ width: "100%", height: "4px", background: "var(--bg-base)", borderRadius: "2px", overflow: "hidden" }}>
            <div
              style={{
                width: `${
                  candidateProgress && candidateProgress.total > 0
                    ? Math.min(100, Math.round((candidateProgress.current / candidateProgress.total) * 100))
                    : 0
                }%`,
                height: "100%",
                background: "#fafafa",
                transition: "width 0.25s ease",
              }}
            />
          </div>
        </div>
      )}

      {!canUseActiveLlm && (
        <div className="api-warning">
          {llmEngine === "local"
            ? "El servidor local de Ollama no está respondiendo en http://localhost:11434. La detección de momentos requiere iniciar Ollama."
            : `Falta la clave API de ${llmEngine.toUpperCase()}. Configúrala en Ajustes para habilitar la identificación de momentos.`}
        </div>
      )}

      {detail.candidates.length > 0 && (
        <>
          {/* Barra de Filtros: Todos / Pendientes / Listos (Exportados) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0.5rem 1rem",
              background: "var(--bg-surface)",
              borderBottom: "1px solid var(--border-default)",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)", marginRight: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <Filter size={12} />
                <span>Ver:</span>
              </span>

              <button
                type="button"
                onClick={() => setFilterTab("all")}
                style={{
                  padding: "0.22rem 0.6rem",
                  borderRadius: "5px",
                  fontSize: "0.74rem",
                  fontWeight: filterTab === "all" ? 600 : 400,
                  background: filterTab === "all" ? "#fafafa" : "var(--bg-surface-raised)",
                  color: filterTab === "all" ? "#09090b" : "var(--text-secondary)",
                  border: filterTab === "all" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>Todos</span>
                <span style={{ fontSize: "0.7rem", opacity: 0.8, fontFamily: "var(--font-mono)" }}>
                  {detail.candidates.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("pending")}
                style={{
                  padding: "0.22rem 0.6rem",
                  borderRadius: "5px",
                  fontSize: "0.74rem",
                  fontWeight: filterTab === "pending" ? 600 : 400,
                  background: filterTab === "pending" ? "#fafafa" : "var(--bg-surface-raised)",
                  color: filterTab === "pending" ? "#09090b" : "var(--text-secondary)",
                  border: filterTab === "pending" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>Pendientes</span>
                <span style={{ fontSize: "0.7rem", opacity: 0.8, fontFamily: "var(--font-mono)" }}>
                  {pendingCandidates.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab("exported")}
                style={{
                  padding: "0.22rem 0.6rem",
                  borderRadius: "5px",
                  fontSize: "0.74rem",
                  fontWeight: filterTab === "exported" ? 600 : 400,
                  background: filterTab === "exported" ? "#fafafa" : "var(--bg-surface-raised)",
                  color: filterTab === "exported" ? "#09090b" : "var(--text-secondary)",
                  border: filterTab === "exported" ? "1px solid #fafafa" : "1px solid var(--border-default)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <CheckCheck size={12} color={filterTab === "exported" ? "#09090b" : "#4ade80"} />
                <span>Exportados</span>
                <span
                  style={{
                    fontSize: "0.68rem",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    padding: "1px 5px",
                    borderRadius: "8px",
                    background: filterTab === "exported" ? "#09090b" : "rgba(34, 197, 94, 0.2)",
                    color: filterTab === "exported" ? "#fafafa" : "#4ade80",
                  }}
                >
                  {exportedCandidates.length}
                </span>
              </button>
            </div>

            {filterTab === "all" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, justifyContent: "flex-end", minWidth: "220px" }}>
                <SlidersHorizontal size={14} color="var(--text-secondary)" />
                <input
                  type="range"
                  min="0"
                  max={detail.candidates.length}
                  value={selectedCount}
                  onChange={(event) => void updateClipCount(Number(event.target.value))}
                  style={{ width: "90px", accentColor: "#fafafa" }}
                />
                <strong style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: "0.76rem" }}>
                  {selectedCount}/{detail.candidates.length}
                </strong>
                <button
                  className="icon-button"
                  style={{ fontSize: "0.72rem", padding: "0.2rem 0.5rem", whiteSpace: "nowrap" }}
                  onClick={() => void updateClipCount(selectedCount === detail.candidates.length ? 0 : detail.candidates.length)}
                >
                  {selectedCount === detail.candidates.length ? "Deseleccionar" : "Todos"}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <div className="candidate-list" ref={listRef}>
        {displayedCandidates.map((candidate) => {
          const clip = clipByCandidate.get(candidate.id);
          const isCut = clip?.status === "done" && Boolean(clip.outputPath);
          return (
            <article key={candidate.id} className={`candidate-card ${candidate.selected ? "selected" : ""}`}>
              <div
                className="media-preview-container"
                onClick={() => openCandidatePreview(candidate)}
                style={{ cursor: "pointer" }}
                title="Haz clic para previsualizar este fragmento"
              >
                <div className="media-preview-thumb">
                  <div className="mock-video-active" style={{ opacity: isCut ? 1 : 0.85 }}>
                    <Play size={16} className="play-icon-mock" />
                  </div>
                  <span className="media-preview-dur">
                    {Math.round(candidate.endSec - candidate.startSec)}s
                  </span>
                </div>
                <div className="candidate-rank">
                  <span>#{candidate.rank}</span>
                  {candidate.selected && <Check size={12} color="#fafafa" />}
                </div>
              </div>

              <div className="candidate-body">
                <div className="candidate-meta">
                  <span>
                    {formatTime(candidate.startSec)} - {formatTime(candidate.endSec)}
                  </span>
                  <span className="candidate-score">{Math.round(candidate.score * 100)}% Match</span>
                  {isCut && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.72rem",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: "rgba(34, 197, 94, 0.15)",
                        color: "#4ade80",
                        border: "1px solid rgba(34, 197, 94, 0.3)",
                        fontWeight: 600,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                      }}
                    >
                      <CheckCheck size={11} />
                      Exportado
                    </span>
                  )}
                </div>
                {candidate.hookTitle && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: "rgba(234, 179, 8, 0.12)",
                      border: "1px solid rgba(234, 179, 8, 0.3)",
                      color: "#facc15",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      letterSpacing: "0.02em",
                      marginTop: "6px",
                      marginBottom: "2px",
                      width: "fit-content",
                    }}
                    title="Titular corto sugerido por IA para colocar en pantalla grande al inicio del clip"
                  >
                    <span style={{ opacity: 0.8 }}>TITULAR:</span>
                    <span>"{candidate.hookTitle}"</span>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginTop: candidate.hookTitle ? "2px" : "6px" }}>
                  <h4 style={{ margin: 0, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{candidate.hook}</h4>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyHook(candidate.id, candidate.hook);
                    }}
                    style={{
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-default)",
                      color: copiedHookId === candidate.id ? "#4ade80" : "var(--text-secondary)",
                      borderRadius: "4px",
                      padding: "2px 7px",
                      fontSize: "0.7rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      cursor: "pointer",
                      flexShrink: 0,
                      fontWeight: 500,
                      transition: "all 0.15s ease",
                    }}
                    title="Copiar título del clip"
                  >
                    {copiedHookId === candidate.id ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedHookId === candidate.id ? "Copiado" : "Copiar"}</span>
                  </button>
                </div>
                <p className="candidate-rationale">{candidate.rationale}</p>

                {candidate.virality && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px",
                      marginTop: "6px",
                      marginBottom: "4px",
                      padding: "5px 8px",
                      background: "rgba(24, 24, 27, 0.8)",
                      borderRadius: "6px",
                      border: "1px solid var(--border-default)",
                      fontSize: "0.71rem",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                    title="Desglose analítico de potencial viral calculado por IA"
                  >
                    <span style={{ fontWeight: 700, color: "#fafafa", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                      ⚡ Viral {candidate.virality.total_score}/100:
                    </span>
                    <span
                      style={{ color: "#38bdf8", background: "rgba(56, 189, 248, 0.1)", padding: "1px 5px", borderRadius: "3px", border: "1px solid rgba(56, 189, 248, 0.25)" }}
                      title="Hook (0-25): Fuerza del primer impacto"
                    >
                      🪝 Hook: {candidate.virality.hook_score}/25
                    </span>
                    <span
                      style={{ color: "#c084fc", background: "rgba(192, 132, 252, 0.1)", padding: "1px 5px", borderRadius: "3px", border: "1px solid rgba(192, 132, 252, 0.25)" }}
                      title="Engagement (0-25): Retención y emoción"
                    >
                      🔥 Engag: {candidate.virality.engagement_score}/25
                    </span>
                    <span
                      style={{ color: "#4ade80", background: "rgba(74, 222, 128, 0.1)", padding: "1px 5px", borderRadius: "3px", border: "1px solid rgba(74, 222, 128, 0.25)" }}
                      title="Valor (0-25): Interés y utilidad del clip"
                    >
                      💡 Valor: {candidate.virality.value_score}/25
                    </span>
                    <span
                      style={{ color: "#fb923c", background: "rgba(251, 146, 60, 0.1)", padding: "1px 5px", borderRadius: "3px", border: "1px solid rgba(251, 146, 60, 0.25)" }}
                      title="Compartir (0-25): Potencial de reenvío a amigos"
                    >
                      🚀 Share: {candidate.virality.shareability_score}/25
                    </span>
                    {candidate.virality.hook_type && (
                      <span
                        style={{ color: "#e4e4e7", background: "rgba(255, 255, 255, 0.06)", padding: "1px 5px", borderRadius: "3px", marginLeft: "auto", textTransform: "capitalize" }}
                        title="Tipo de gancho"
                      >
                        Tipo: {candidate.virality.hook_type}
                      </span>
                    )}
                  </div>
                )}

                {(candidate.description || isCut) && (
                  <div className="candidate-description-box">
                    <div className="desc-header">
                      <span className="desc-label">Descripción para Redes</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {candidate.description && (
                          <button
                            type="button"
                            className="desc-copy-btn"
                            onClick={() => {
                              const cleanDesc = candidate.description!.includes("```")
                                ? candidate.description!.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim()
                                : candidate.description!;
                              copyDescription(candidate.id, cleanDesc);
                            }}
                            title="Copiar texto para redes sociales"
                          >
                            <Copy size={11} />
                            <span>{copiedDescId === candidate.id ? "Copiado" : "Copiar"}</span>
                          </button>
                        )}
                        {regenerateCandidateCopy && (
                          <button
                            type="button"
                            className="desc-copy-btn"
                            onClick={() => void regenerateCandidateCopy(candidate.id)}
                            disabled={regeneratingCopyCandidateId === candidate.id || busy !== "idle"}
                            style={{ color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.3)" }}
                            title="Generar copy completo para redes sociales usando el .SRT del clip con IA"
                          >
                            {regeneratingCopyCandidateId === candidate.id ? (
                              <Loader2 className="spin" size={11} />
                            ) : (
                              <Sparkles size={11} />
                            )}
                            <span>
                              {regeneratingCopyCandidateId === candidate.id
                                ? "Redactando..."
                                : candidate.description
                                ? "Rehacer Copy"
                                : "Generar Copy con IA"}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                    {candidate.description ? (
                      <p className="desc-text">
                        {candidate.description.includes("```") || candidate.description.includes('"full_copy":')
                          ? (candidate.description.match(/"(?:full_copy|fullCopy)"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\n/g, "\n") ||
                             candidate.description.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim())
                          : candidate.description}
                      </p>
                    ) : (
                      <p className="desc-text" style={{ fontStyle: "italic", opacity: 0.6, fontSize: "0.78rem" }}>
                        Clip exportado con .SRT listo. Haz clic en "Generar Copy con IA" para redactar su texto viral.
                      </p>
                    )}
                  </div>
                )}

                <div className="candidate-actions">
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 }}>
                    <span className={`clip-status ${isCut ? "ready" : clip?.status === "error" ? "error" : ""}`}>
                      {isCut ? "Clip Renderizado" : clip?.status === "error" ? "Error en corte" : clip?.status ?? "Pendiente"}
                    </span>
                    {(clip?.captionPath || clip?.captionAssPath) && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "var(--bg-surface-raised)",
                          border: "1px solid var(--border-default)",
                          color: "var(--text-secondary)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          flexShrink: 0,
                        }}
                        title="Subtítulos exportados en la carpeta de clips"
                      >
                        <FileText size={10} />
                        .SRT
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                    <button
                      className="icon-button"
                      style={{ padding: "0.25rem 0.6rem", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "4px" }}
                      onClick={() => openCandidatePreview(candidate)}
                      title="Previsualizar y configurar corte / subtítulos"
                    >
                      <Play size={12} />
                      <span>{isCut ? "Ver" : "Previsualizar"}</span>
                    </button>
                    <button
                      className="cut-button"
                      onClick={() => void cutCandidate(candidate.id)}
                      disabled={busy !== "idle" || !environment?.hasFfmpeg}
                    >
                      {renderingCandidateId === candidate.id ? <Loader2 className="spin" size={13} /> : <Scissors size={13} />}
                      {renderingCandidateId === candidate.id ? "Cortando..." : isCut ? "Recortar" : "Cortar"}
                    </button>
                  </div>
                </div>

                {clip?.outputPath && (
                  <div
                    style={{
                      marginTop: "0.5rem",
                      padding: "0.35rem 0.6rem",
                      borderRadius: "6px",
                      background: "var(--bg-surface-raised)",
                      border: "1px solid var(--border-default)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                      fontSize: "0.72rem",
                      minWidth: 0,
                      maxWidth: "100%",
                      boxSizing: "border-box",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden", minWidth: 0, flex: 1 }}>
                      <span style={{ color: "#4ade80", fontWeight: 700, fontSize: "0.68rem", flexShrink: 0 }}>MP4</span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-secondary)",
                          minWidth: 0,
                          flex: 1,
                        }}
                        title={clip.outputPath}
                      >
                        {clip.outputPath}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyPath(candidate.id, clip.outputPath!)}
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-default)",
                        color: copiedClipPathId === candidate.id ? "#4ade80" : "var(--text-secondary)",
                        cursor: "pointer",
                        padding: "2px 7px",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        flexShrink: 0,
                      }}
                      title="Copiar ruta completa al portapapeles"
                    >
                      <Copy size={11} />
                      <span>{copiedClipPathId === candidate.id ? "Copiado" : "Copiar"}</span>
                    </button>
                  </div>
                )}
                {clip?.captionAssPath && clip.captionAssPath.toLowerCase().endsWith(".ass") && (
                  <div
                    style={{
                      marginTop: "4px",
                      padding: "0.3rem 0.6rem",
                      borderRadius: "6px",
                      background: "rgba(56, 189, 248, 0.06)",
                      border: "1px solid rgba(56, 189, 248, 0.2)",
                      fontSize: "0.7rem",
                      color: "#38bdf8",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      overflow: "hidden",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>ASS:</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)" }}>
                      {clip.captionAssPath}
                    </span>
                  </div>
                )}
                {clip?.renderLog && <div className="render-log">{clip.renderLog}</div>}
              </div>
            </article>
          );
        })}

        {/* Tab-specific Empty States */}
        {detail.candidates.length > 0 && displayedCandidates.length === 0 && (
          <div className="empty-state" style={{ padding: "2.5rem 1rem" }}>
            {filterTab === "exported" ? (
              <>
                <CheckCheck size={28} style={{ opacity: 0.4, color: "#4ade80" }} />
                <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 600 }}>
                  Aún no has exportado ningún clip
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "var(--text-muted)" }}>
                  Ve a la pestaña "Pendientes" o "Todos" y presiona "Cortar" en los momentos que desees renderizar.
                </p>
              </>
            ) : filterTab === "pending" ? (
              <>
                <CheckCheck size={28} style={{ opacity: 0.5, color: "#4ade80" }} />
                <p style={{ margin: "6px 0 0", fontSize: "0.85rem", color: "var(--text-primary)", fontWeight: 600 }}>
                  ¡Todos los clips han sido exportados!
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "0.76rem", color: "var(--text-muted)" }}>
                  Puedes verlos en la pestaña "Exportados" o buscar nuevos momentos virales.
                </p>
              </>
            ) : null}
          </div>
        )}

        {detail.candidates.length === 0 && (
          <div className="empty-state">
            <Sparkles size={28} style={{ opacity: 0.4 }} />
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              No se han identificado momentos virales todavía.
            </p>
            <p style={{ margin: 0, fontSize: "0.76rem", color: "var(--text-muted)" }}>
              Usa el botón "Buscar Momentos" para analizar la transcripción con IA.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
