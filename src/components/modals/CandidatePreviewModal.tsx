import React, { useState, useEffect, useRef } from "react";
import {
  Scissors,
  X,
  Type,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  Clock,
  Play,
  Pause,
  Eye,
  Palette,
  Heart,
  Sparkles,
} from "lucide-react";
import { Candidate, Clip, ProjectDetail } from "../../types";
import { formatTime } from "../../utils/format";

// Strips any emojis that the LLM may output
function cleanHook(text: string): string {
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]/gu, '').trim();
}

interface CandidatePreviewModalProps {
  candidate: Candidate | null;
  detail: ProjectDetail | null;
  onClose: () => void;
  trimStart: number;
  setTrimStart: (val: number | ((prev: number) => number)) => void;
  trimEnd: number;
  setTrimEnd: (val: number | ((prev: number) => number)) => void;
  isSavingTrim: boolean;
  onSaveTrim: () => Promise<void>;
  onCutCandidate: (candidateId: string, options?: any) => Promise<void>;
  clipByCandidate: Map<string, Clip>;
  busy: string;
}

export function CandidatePreviewModal({
  candidate,
  detail,
  onClose,
  trimStart,
  setTrimStart,
  trimEnd,
  setTrimEnd,
  isSavingTrim,
  onSaveTrim,
  onCutCandidate,
  clipByCandidate,
  busy,
}: CandidatePreviewModalProps) {
  if (!candidate || !detail) return null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentPlayTime, setCurrentPlayTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);

  const [burnSubtitles, setBurnSubtitles] = useState<boolean>(() => {
    const saved = localStorage.getItem("autoshorts_burn_subtitles");
    return saved !== null ? saved === "true" : true;
  });

  const [captionStyle, setCaptionStyle] = useState<string>(() => {
    return localStorage.getItem("autoshorts_caption_style") || "tiktok-karaoke";
  });

  const [captionPosition, setCaptionPosition] = useState<"bottom" | "center" | "top">(() => {
    return (localStorage.getItem("autoshorts_caption_position") as "bottom" | "center" | "top") || "bottom";
  });

  const [captionColor, setCaptionColor] = useState<string>(() => {
    return localStorage.getItem("autoshorts_caption_color") || "#ffffff";
  });

  const [captionHighlight, setCaptionHighlight] = useState<string>(() => {
    return localStorage.getItem("autoshorts_caption_highlight") || "#facc15";
  });

  const [captionLines, setCaptionLines] = useState<"1" | "2">(() => {
    return (localStorage.getItem("autoshorts_caption_lines") as "1" | "2") || "1";
  });

  const [ctaEnabled, setCtaEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem("autoshorts_cta_enabled");
    return saved !== null ? saved === "true" : false;
  });

  const [ctaText, setCtaText] = useState<string>(() => {
    return localStorage.getItem("autoshorts_cta_text") || "❤️ ¡Sígueme y dale like!";
  });

  const [ctaPosition, setCtaPosition] = useState<"top" | "center" | "bottom">(() => {
    return (localStorage.getItem("autoshorts_cta_position") as "top" | "center" | "bottom") || "top";
  });

  useEffect(() => {
    localStorage.setItem("autoshorts_burn_subtitles", String(burnSubtitles));
  }, [burnSubtitles]);

  useEffect(() => {
    localStorage.setItem("autoshorts_caption_style", captionStyle);
  }, [captionStyle]);

  useEffect(() => {
    localStorage.setItem("autoshorts_caption_position", captionPosition);
  }, [captionPosition]);

  useEffect(() => {
    localStorage.setItem("autoshorts_caption_color", captionColor);
  }, [captionColor]);

  useEffect(() => {
    localStorage.setItem("autoshorts_caption_highlight", captionHighlight);
  }, [captionHighlight]);

  useEffect(() => {
    localStorage.setItem("autoshorts_caption_lines", captionLines);
  }, [captionLines]);

  useEffect(() => {
    localStorage.setItem("autoshorts_cta_enabled", String(ctaEnabled));
  }, [ctaEnabled]);

  useEffect(() => {
    localStorage.setItem("autoshorts_cta_text", ctaText);
  }, [ctaText]);

  useEffect(() => {
    localStorage.setItem("autoshorts_cta_position", ctaPosition);
  }, [ctaPosition]);

  const clipDuration = Math.max(0.1, trimEnd - trimStart);
  const isExported = Boolean(clipByCandidate.get(candidate.id)?.outputPath);

  useEffect(() => {
    if (!videoRef.current || isExported) return;
    const curr = videoRef.current.currentTime;
    if (curr < trimStart || curr > trimEnd) {
      videoRef.current.currentTime = trimStart;
    }
  }, [trimStart, trimEnd, isExported]);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const time = videoRef.current.currentTime;
    if (isExported) {
      setCurrentPlayTime(time);
    } else {
      const rel = Math.max(0, Math.min(clipDuration, time - trimStart));
      setCurrentPlayTime(rel);
      if (time >= trimEnd) {
        videoRef.current.currentTime = trimStart;
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newRelTime = parseFloat(e.target.value);
    setCurrentPlayTime(newRelTime);
    if (videoRef.current) {
      videoRef.current.currentTime = isExported ? newRelTime : trimStart + newRelTime;
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const absoluteCurrentTime = isExported ? currentPlayTime : trimStart + currentPlayTime;

  const renderCtaBadgePreview = () => {
    const isTwitch = ctaText.toLowerCase().includes("twitch");
    const isFire = ctaText.includes("🔥") || ctaText.toLowerCase().includes("fuego");
    const isYoutube = ctaText.includes("🔔") || ctaText.toLowerCase().includes("youtube");

    let borderColor = "rgba(244, 63, 94, 0.85)";
    let shadowColor = "rgba(244, 63, 94, 0.35)";

    if (isTwitch) {
      borderColor = "rgba(145, 70, 255, 0.85)";
      shadowColor = "rgba(145, 70, 255, 0.4)";
    } else if (isFire) {
      borderColor = "rgba(251, 146, 60, 0.85)";
      shadowColor = "rgba(251, 146, 60, 0.4)";
    } else if (isYoutube) {
      borderColor = "rgba(239, 68, 68, 0.85)";
      shadowColor = "rgba(239, 68, 68, 0.4)";
    }

    return (
      <div
        className="motionmaxxing-badge"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          background: "rgba(16, 16, 22, 0.92)",
          border: `1.5px solid ${borderColor}`,
          boxShadow: `0 4px 14px ${shadowColor}, 0 2px 6px rgba(0,0,0,0.8)`,
          padding: "5px 14px",
          borderRadius: "9999px",
          color: "#ffffff",
          fontSize: "0.78rem",
          fontWeight: 700,
          letterSpacing: "0.02em",
          zIndex: 2,
        }}
      >
        <span style={{ display: "inline-block" }}>{ctaText}</span>
      </div>
    );
  };

  const renderCaptionPreview = () => {
    switch (captionStyle) {
      case "loud-viral":
        return (
          <div style={{ textAlign: "center", fontFamily: "Impact, 'Arial Black', sans-serif", fontSize: "1.08rem", textTransform: "uppercase", letterSpacing: "0.04em", userSelect: "none" }}>
            <span style={{ color: "#ffffff", textShadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 10px rgba(0,0,0,0.9)", marginRight: "6px" }}>
              ESTA
            </span>
            <span
              style={{
                display: "inline-block",
                color: captionHighlight || "#facc15",
                transform: "scale(1.22)",
                transformOrigin: "center bottom",
                textShadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 5px 12px rgba(0,0,0,1)",
                fontWeight: 900,
                marginRight: "6px",
              }}
            >
              JUGADA
            </span>
            <span style={{ color: "#fb923c", fontWeight: 900, textShadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 4px 10px rgba(0,0,0,0.9)" }}>
              ÉPICA!
            </span>
          </div>
        );
      case "arcade-retro":
        return (
          <div style={{ textAlign: "center", fontFamily: "'Trebuchet MS', 'Arial Black', sans-serif", fontSize: "1.02rem", textTransform: "uppercase", letterSpacing: "0.03em", userSelect: "none" }}>
            <span style={{ color: "#ffffff", textShadow: "-2px -2px 0 #ec4899, 2px -2px 0 #ec4899, -2px 2px 0 #ec4899, 2px 2px 0 #ec4899", marginRight: "6px" }}>
              ESTA
            </span>
            <span
              style={{
                display: "inline-block",
                color: "#06b6d4",
                transform: "scale(1.18)",
                transformOrigin: "center bottom",
                textShadow: "-2px -2px 0 #ec4899, 2px -2px 0 #ec4899, -2px 2px 0 #ec4899, 2px 2px 0 #ec4899, 0 0 10px #06b6d4",
                fontWeight: 900,
                marginRight: "6px",
              }}
            >
              JUGADA
            </span>
            <span style={{ color: "#ffffff", textShadow: "-2px -2px 0 #ec4899, 2px -2px 0 #ec4899, -2px 2px 0 #ec4899, 2px 2px 0 #ec4899" }}>
              ÉPICA!
            </span>
          </div>
        );
      case "cyber-terminal":
        return (
          <div style={{ textAlign: "center", fontFamily: "Consolas, 'Courier New', monospace", fontSize: "0.92rem", letterSpacing: "0.02em", color: "#10b981", background: "rgba(10, 20, 15, 0.85)", padding: "4px 12px", borderRadius: "4px", border: "1px solid #10b981", boxShadow: "0 0 10px rgba(16, 185, 129, 0.3)" }}>
            &gt; ESTA <span style={{ color: "#38bdf8", fontWeight: 700 }}>[JUGADA]</span> ÉPICA!
          </div>
        );
      case "clean-editorial":
        return (
          <div style={{ textAlign: "center", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: "0.96rem", fontWeight: 600, letterSpacing: "0.01em", userSelect: "none" }}>
            <span style={{ color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.8)", marginRight: "5px" }}>
              Esta
            </span>
            <span style={{ color: captionHighlight || "#fde047", textShadow: "0 2px 8px rgba(0,0,0,0.9)", fontWeight: 700, marginRight: "5px" }}>
              jugada
            </span>
            <span style={{ color: "#ffffff", textShadow: "0 2px 6px rgba(0,0,0,0.8)" }}>
              épica!
            </span>
          </div>
        );
      case "modern-box":
        return (
          <div style={{ background: "rgba(0, 0, 0, 0.82)", padding: "4px 12px", borderRadius: "6px", color: captionColor, fontFamily: "Arial, sans-serif", fontWeight: 700, fontSize: "0.88rem", letterSpacing: "0.02em", textTransform: "uppercase", border: "1px solid rgba(255, 255, 255, 0.15)" }}>
            ESTA <span style={{ color: captionHighlight }}>JUGADA</span> ÉPICA!
          </div>
        );
      case "classic-outline":
        return (
          <div style={{ color: captionHighlight, fontFamily: "'Arial Black', Impact, sans-serif", fontWeight: 900, fontSize: "1.02rem", textTransform: "uppercase", letterSpacing: "0.03em", textShadow: "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 3px 6px #000" }}>
            ESTA JUGADA ÉPICA!
          </div>
        );
      case "minimal-shadow":
        return (
          <div style={{ color: captionColor, fontFamily: "system-ui, -apple-system, sans-serif", fontWeight: 600, fontSize: "0.92rem", textShadow: "0 2px 6px rgba(0, 0, 0, 0.9)", letterSpacing: "0.02em" }}>
            Esta jugada épica!
          </div>
        );
      case "tiktok-karaoke":
      default:
        return (
          <div style={{ textAlign: "center", fontFamily: "'Arial Black', Impact, sans-serif", fontSize: "1.02rem", textTransform: "uppercase", letterSpacing: "0.03em", userSelect: "none" }}>
            <span style={{ color: captionColor, textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,0.8)", marginRight: "6px" }}>
              ESTA
            </span>
            <span
              style={{
                display: "inline-block",
                color: captionHighlight,
                transform: "scale(1.16)",
                transformOrigin: "center bottom",
                textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 8px rgba(0,0,0,0.9)",
                fontWeight: 900,
                marginRight: "6px",
              }}
            >
              JUGADA
            </span>
            <span style={{ color: captionColor, textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 3px 6px rgba(0,0,0,0.8)" }}>
              ÉPICA!
            </span>
          </div>
        );
    }
  };

  return (
    <div className="style-modal-overlay" onClick={onClose}>
      <div className="style-modal" style={{ maxWidth: "720px", maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="style-modal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.1rem 1.5rem", borderBottom: "1px solid var(--border-default)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>Previsualizar Clip #{candidate.rank}</h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {formatTime(trimStart)} - {formatTime(trimEnd)} ({clipDuration.toFixed(1)}s de duración)
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Cerrar modal"
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: "1.2rem 1.5rem", overflowY: "auto", flex: 1 }}>
          <h4 style={{ color: "#fafafa", marginBottom: "0.75rem", fontSize: "1.02rem", fontWeight: 600 }}>
            "{cleanHook(candidate.hook)}"
          </h4>

          {/* Reproductor de Video Optimizado sin desmontaje destructivo */}
          <div style={{ background: "#000", borderRadius: "8px 8px 0 0", overflow: "hidden", maxHeight: "360px", display: "flex", justifyContent: "center" }}>
            <video
              ref={videoRef}
              key={candidate.id}
              src={`http://127.0.0.1:1422/stream?file=${encodeURIComponent(
                clipByCandidate.get(candidate.id)?.outputPath || detail.project.sourcePath
              )}`}
              autoPlay
              preload="auto"
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  videoRef.current.currentTime = isExported ? 0 : trimStart;
                }
              }}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={togglePlayPause}
              style={{ maxHeight: "360px", maxWidth: "100%", cursor: "pointer" }}
            />
          </div>

          {/* Barra de Tiempo en Vivo Tipo VLC */}
          <div
            style={{
              background: "#18181b",
              borderLeft: "1px solid var(--border-default)",
              borderRight: "1px solid var(--border-default)",
              borderBottom: "1px solid var(--border-default)",
              borderRadius: "0 0 8px 8px",
              padding: "0.55rem 0.85rem",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {/* Botón Play / Pause */}
              <button
                type="button"
                onClick={togglePlayPause}
                style={{
                  background: "var(--bg-surface-raised)",
                  border: "1px solid var(--border-default)",
                  color: "#fafafa",
                  cursor: "pointer",
                  padding: "5px 7px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "5px",
                }}
                title={isPlaying ? "Pausar video" : "Reproducir video"}
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>

              {/* Tiempo en Vivo (VLC Izquierda: ej 00:18) */}
              <span
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 700,
                  color: "#38bdf8",
                  fontFamily: "var(--font-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: "46px",
                }}
                title="Tiempo actual reproducido dentro del clip"
              >
                {formatTime(currentPlayTime)}
              </span>

              {/* Barra Deslizadora estilo VLC (Azul con cursor) */}
              <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="range"
                  min={0}
                  max={clipDuration}
                  step={0.1}
                  value={Math.min(currentPlayTime, clipDuration)}
                  onChange={handleSeek}
                  style={{
                    width: "100%",
                    height: "7px",
                    borderRadius: "4px",
                    accentColor: "#0284c7",
                    cursor: "pointer",
                    outline: "none",
                  }}
                  title="Arrastra para avanzar o retroceder en el clip"
                />
              </div>

              {/* Duración Total del Clip (VLC Derecha: ej 01:19) */}
              <span
                style={{
                  fontSize: "0.86rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                  minWidth: "46px",
                  textAlign: "right",
                }}
                title="Duración total del recorte"
              >
                {formatTime(clipDuration)}
              </span>
            </div>

            {/* Lectura en tiempo real para guiar los botones de recorte */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", color: "var(--text-muted)", paddingLeft: "34px", flexWrap: "wrap", gap: "6px" }}>
              <span>
                Tiempo clip: <strong style={{ color: "#38bdf8", fontFamily: "var(--font-mono)" }}>{currentPlayTime.toFixed(1)}s</strong> / {clipDuration.toFixed(1)}s
              </span>
              <span>
                Posición en video original: <strong style={{ color: "#fafafa", fontFamily: "var(--font-mono)" }}>{formatTime(absoluteCurrentTime)} ({absoluteCurrentTime.toFixed(1)}s)</strong>
              </span>
            </div>
          </div>

          {/* Ajuste Fino de Recorte (Trim Controls) */}
          <div style={{ marginTop: "1rem", padding: "0.85rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={14} color="var(--text-secondary)" />
                <span style={{ fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.02em", color: "var(--text-secondary)" }}>
                  AJUSTE FINO DE RECORTE (TRIM)
                </span>
              </div>
              <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                Duración: <strong style={{ color: "#fafafa" }}>{clipDuration.toFixed(1)}s</strong>
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.75rem" }}>
              {/* Inicio */}
              <div style={{ background: "var(--bg-surface-raised)", padding: "0.6rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Inicio: <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{formatTime(trimStart)}</strong></span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{trimStart.toFixed(1)}s</span>
                </div>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimStart((curr) => Math.max(0, Number((curr - 5).toFixed(1))))}
                    title="Retroceder inicio 5 segundos"
                  >
                    -5s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimStart((curr) => Math.max(0, Number((curr - 1).toFixed(1))))}
                    title="Retroceder inicio 1 segundo"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimStart((curr) => Math.min(trimEnd - 1, Number((curr + 1).toFixed(1))))}
                    title="Avanzar inicio 1 segundo"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimStart((curr) => Math.min(trimEnd - 1, Number((curr + 5).toFixed(1))))}
                    title="Avanzar inicio 5 segundos"
                  >
                    +5s
                  </button>
                </div>
              </div>

              {/* Fin */}
              <div style={{ background: "var(--bg-surface-raised)", padding: "0.6rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border-default)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Fin: <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{formatTime(trimEnd)}</strong></span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono, monospace)", fontVariantNumeric: "tabular-nums" }}>{trimEnd.toFixed(1)}s</span>
                </div>
                <div style={{ display: "flex", gap: "0.3rem" }}>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimEnd((curr) => Math.max(trimStart + 1, Number((curr - 5).toFixed(1))))}
                    title="Acortar fin 5 segundos"
                  >
                    -5s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimEnd((curr) => Math.max(trimStart + 1, Number((curr - 1).toFixed(1))))}
                    title="Acortar fin 1 segundo"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimEnd((curr) => Number((curr + 1).toFixed(1)))}
                    title="Extender fin 1 segundo"
                  >
                    +1s
                  </button>
                  <button
                    type="button"
                    className="btn-cancel"
                    style={{ flex: 1, padding: 0, height: "26px", minHeight: "26px", fontSize: "0.72rem", fontFamily: "var(--font-mono, monospace)" }}
                    onClick={() => setTrimEnd((curr) => Number((curr + 5).toFixed(1)))}
                    title="Extender fin 5 segundos"
                  >
                    +5s
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem" }}>
              {(trimStart !== candidate.startSec || trimEnd !== candidate.endSec) && (
                <span style={{ fontSize: "0.74rem", opacity: 0.7, marginRight: "auto" }}>
                  Ajustado (Original: {formatTime(candidate.startSec)} - {formatTime(candidate.endSec)})
                </span>
              )}
              <button
                type="button"
                className="btn-cancel"
                style={{ minHeight: "30px", fontSize: "0.76rem", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart(candidate.startSec);
                  setTrimEnd(candidate.endSec);
                }}
                disabled={trimStart === candidate.startSec && trimEnd === candidate.endSec}
              >
                Restablecer
              </button>
              <button
                type="button"
                className="btn-confirm"
                style={{ minHeight: "30px", fontSize: "0.76rem", padding: "0 14px" }}
                onClick={onSaveTrim}
                disabled={isSavingTrim || trimStart >= trimEnd}
              >
                {isSavingTrim ? "Guardando..." : "Guardar Ajuste"}
              </button>
            </div>
          </div>

          {/* Opciones de Subtítulos y Posicionamiento para Exportación con Vista Previa en Vivo */}
          <div style={{ marginTop: "1rem", padding: "0.85rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Type size={14} color="var(--text-secondary)" />
                <span style={{ fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.02em", color: "var(--text-secondary)" }}>
                  SUBTÍTULOS PARA EL CLIP
                </span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.76rem" }}>
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  onChange={(e) => setBurnSubtitles(e.target.checked)}
                  style={{ accentColor: "#fafafa", cursor: "pointer" }}
                />
                <span style={{ color: burnSubtitles ? "#fafafa" : "var(--text-secondary)", fontWeight: burnSubtitles ? 600 : 400 }}>
                  Incrustar en el video
                </span>
              </label>
            </div>

            <p style={{ margin: "0 0 0.75rem", fontSize: "0.74rem", color: "var(--text-muted)" }}>
              {burnSubtitles
                ? "Los subtítulos se renderizarán sobre el video en la posición que elijas. También se guardará el archivo .srt editable por separado."
                : "El video se exportará limpio (sin subtítulos incrustados) y se creará un archivo .srt sincronizado por separado."}
            </p>

            {burnSubtitles && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", paddingTop: "0.25rem", borderTop: "1px dashed var(--border-default)" }}>
                  {/* Estilo de Subtítulo */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.74rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                      Estilo de animación:
                    </label>
                    <select
                      value={captionStyle}
                      onChange={(e) => setCaptionStyle(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.38rem 0.5rem",
                        borderRadius: "6px",
                        background: "var(--bg-surface-raised)",
                        border: "1px solid var(--border-default)",
                        color: "#fafafa",
                        fontSize: "0.76rem",
                        cursor: "pointer",
                      }}
                    >
                      <option value="loud-viral">🔥 Loud Viral (HyperFrames Impact 3D)</option>
                      <option value="arcade-retro">🎮 Arcade Retro (Gaming HUD Neón)</option>
                      <option value="cyber-terminal">💻 Cyber Terminal (Matrix Monospace)</option>
                      <option value="clean-editorial">✨ Clean Editorial (Elegante & Suave)</option>
                      <option value="tiktok-karaoke">🟡 TikTok Karaoke (Palabra Resaltada)</option>
                      <option value="modern-box">⬛ Caja Moderna (Fondo Oscuro)</option>
                      <option value="classic-outline">🟨 Clásico Contorno (Amarillo y Negro)</option>
                      <option value="minimal-shadow">⬜ Minimalista (Blanco con Sombra)</option>
                    </select>
                  </div>

                  {/* Posición en Pantalla (Evitar estorbar cámaras / HUD) */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.74rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                      Posición de subtítulo:
                    </label>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        type="button"
                        onClick={() => setCaptionPosition("bottom")}
                        title="Abajo (Estándar para reels/shorts)"
                        style={{
                          flex: 1,
                          padding: "0.38rem 0.2rem",
                          borderRadius: "5px",
                          border: captionPosition === "bottom" ? "1px solid #38bdf8" : "1px solid var(--border-default)",
                          background: captionPosition === "bottom" ? "#0284c7" : "var(--bg-surface-raised)",
                          color: "#fafafa",
                          fontSize: "0.72rem",
                          fontWeight: captionPosition === "bottom" ? 700 : 400,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                        }}
                      >
                        <AlignVerticalJustifyEnd size={12} />
                        Abajo
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptionPosition("center")}
                        title="Centro (No tapa la interfaz del juego ni subtítulos inferiores)"
                        style={{
                          flex: 1,
                          padding: "0.38rem 0.2rem",
                          borderRadius: "5px",
                          border: captionPosition === "center" ? "1px solid #38bdf8" : "1px solid var(--border-default)",
                          background: captionPosition === "center" ? "#0284c7" : "var(--bg-surface-raised)",
                          color: "#fafafa",
                          fontSize: "0.72rem",
                          fontWeight: captionPosition === "center" ? 700 : 400,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                        }}
                      >
                        <AlignVerticalJustifyCenter size={12} />
                        Centro
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptionPosition("top")}
                        title="Arriba (No estorba la cámara del streamer ni HUD inferior)"
                        style={{
                          flex: 1,
                          padding: "0.38rem 0.2rem",
                          borderRadius: "5px",
                          border: captionPosition === "top" ? "1px solid #38bdf8" : "1px solid var(--border-default)",
                          background: captionPosition === "top" ? "#0284c7" : "var(--bg-surface-raised)",
                          color: "#fafafa",
                          fontSize: "0.72rem",
                          fontWeight: captionPosition === "top" ? 700 : 400,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                        }}
                      >
                        <AlignVerticalJustifyStart size={12} />
                        Arriba
                      </button>
                    </div>
                  </div>
                </div>

                {/* Paleta de Colores de Subtítulos */}
                <div style={{ marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px dashed var(--border-default)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  {/* Color Principal */}
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.73rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      <Palette size={12} color="#38bdf8" />
                      Color de texto:
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {[
                          { color: "#ffffff", name: "Blanco" },
                          { color: "#fef08a", name: "Crema" },
                          { color: "#e0f2fe", name: "Celeste" },
                          { color: "#fce7f3", name: "Rosa" },
                          { color: "#d4d4d8", name: "Plata" },
                        ].map((swatch) => (
                          <button
                            key={swatch.color}
                            type="button"
                            onClick={() => setCaptionColor(swatch.color)}
                            title={swatch.name}
                            style={{
                              width: "20px",
                              height: "20px",
                              borderRadius: "4px",
                              background: swatch.color,
                              border: captionColor.toLowerCase() === swatch.color.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.2)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                      <input
                        type="color"
                        value={captionColor}
                        onChange={(e) => setCaptionColor(e.target.value)}
                        title="Personalizar color de texto"
                        style={{
                          width: "26px",
                          height: "24px",
                          padding: "0 1px",
                          borderRadius: "4px",
                          border: "1px solid var(--border-default)",
                          background: "var(--bg-surface-raised)",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </div>

                  {/* Color de Resaltado / Karaoke */}
                  <div>
                    <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "0.73rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      <Sparkles size={12} color="#facc15" />
                      Color de resaltado (Karaoke):
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ display: "flex", gap: "4px" }}>
                        {[
                          { color: "#facc15", name: "Amarillo" },
                          { color: "#38bdf8", name: "Cyan" },
                          { color: "#4ade80", name: "Verde Neón" },
                          { color: "#f43f5e", name: "Rojo Fresa" },
                          { color: "#fb923c", name: "Naranja" },
                          { color: "#c084fc", name: "Púrpura" },
                        ].map((swatch) => (
                          <button
                            key={swatch.color}
                            type="button"
                            onClick={() => setCaptionHighlight(swatch.color)}
                            title={swatch.name}
                            style={{
                              width: "20px",
                              height: "20px",
                              borderRadius: "4px",
                              background: swatch.color,
                              border: captionHighlight.toLowerCase() === swatch.color.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.2)",
                              cursor: "pointer",
                              padding: 0,
                            }}
                          />
                        ))}
                      </div>
                      <input
                        type="color"
                        value={captionHighlight}
                        onChange={(e) => setCaptionHighlight(e.target.value)}
                        title="Personalizar color de resaltado"
                        style={{
                          width: "26px",
                          height: "24px",
                          padding: "0 1px",
                          borderRadius: "4px",
                          border: "1px solid var(--border-default)",
                          background: "var(--bg-surface-raised)",
                          cursor: "pointer",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Formato de Líneas (1 Sola Línea vs 2 Líneas) */}
                <div style={{ marginTop: "0.6rem", paddingTop: "0.5rem", borderTop: "1px dashed var(--border-default)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.73rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                      Distribución de líneas:
                    </label>
                    <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                      {captionLines === "1" ? "⚡ Obligar a 1 sola línea (rápido y directo)" : "Dividir en 2 líneas si es largo"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button
                      type="button"
                      onClick={() => setCaptionLines("1")}
                      title="Obligar a 1 sola línea fija (estilo TikTok/Shorts)"
                      style={{
                        padding: "0.3rem 0.6rem",
                        borderRadius: "5px",
                        border: captionLines === "1" ? "1px solid #38bdf8" : "1px solid var(--border-default)",
                        background: captionLines === "1" ? "#0284c7" : "var(--bg-surface-raised)",
                        color: "#fafafa",
                        fontSize: "0.72rem",
                        fontWeight: captionLines === "1" ? 700 : 400,
                        cursor: "pointer",
                      }}
                    >
                      1 Sola Línea
                    </button>
                    <button
                      type="button"
                      onClick={() => setCaptionLines("2")}
                      title="Permitir hasta 2 líneas de texto"
                      style={{
                        padding: "0.3rem 0.6rem",
                        borderRadius: "5px",
                        border: captionLines === "2" ? "1px solid #38bdf8" : "1px solid var(--border-default)",
                        background: captionLines === "2" ? "#0284c7" : "var(--bg-surface-raised)",
                        color: "#fafafa",
                        fontSize: "0.72rem",
                        fontWeight: captionLines === "2" ? 700 : 400,
                        cursor: "pointer",
                      }}
                    >
                      2 Líneas
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* SECCIÓN CTA ANIMADO ("Sígueme y dale like / Apóyame") */}
          <div style={{ marginTop: "0.75rem", padding: "0.85rem", borderRadius: "8px", background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.45rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Heart size={14} color="#f43f5e" />
                <span style={{ fontWeight: 600, fontSize: "0.8rem", letterSpacing: "0.02em", color: "var(--text-secondary)" }}>
                  LLAMADO A LA ACCIÓN (CTA ANIMADO)
                </span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.76rem" }}>
                <input
                  type="checkbox"
                  checked={ctaEnabled}
                  onChange={(e) => setCtaEnabled(e.target.checked)}
                  style={{ accentColor: "#f43f5e", cursor: "pointer" }}
                />
                <span style={{ color: ctaEnabled ? "#fafafa" : "var(--text-secondary)", fontWeight: ctaEnabled ? 600 : 400 }}>
                  Incrustar en el video
                </span>
              </label>
            </div>

            <p style={{ margin: "0 0 0.6rem", fontSize: "0.73rem", color: "var(--text-muted)" }}>
              {ctaEnabled
                ? "Incrusta una insignia animada emergente (bounce & fade) para incentivar likes y seguidores en redes sociales."
                : "No se agregará insignia de llamado a la acción al clip."}
            </p>

            {ctaEnabled && (
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "0.75rem", paddingTop: "0.3rem", borderTop: "1px dashed var(--border-default)" }}>
                {/* Texto del CTA */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                    <label style={{ fontSize: "0.73rem", color: "var(--text-secondary)" }}>
                      Texto del llamado:
                    </label>
                    <select
                      onChange={(e) => {
                        if (e.target.value) setCtaText(e.target.value);
                      }}
                      defaultValue=""
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#38bdf8",
                        fontSize: "0.68rem",
                        cursor: "pointer",
                      }}
                    >
                      <option value="" disabled>Elegir sugerencia...</option>
                      <option value="❤️ ¡Sígueme y dale like!">❤️ ¡Sígueme y dale like!</option>
                      <option value="🔥 ¡Apóyame con tu follow!">🔥 ¡Apóyame con tu follow!</option>
                      <option value="🔔 ¡Suscríbete para más clips!">🔔 ¡Suscríbete para más clips!</option>
                      <option value="💬 ¡Comenta qué opinas!">💬 ¡Comenta qué opinas!</option>
                      <option value="⭐ ¡Guarda este video!">⭐ ¡Guarda este video!</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    placeholder="Ej. ❤️ ¡Sígueme y dale like!"
                    style={{
                      width: "100%",
                      padding: "0.38rem 0.6rem",
                      borderRadius: "6px",
                      background: "var(--bg-surface-raised)",
                      border: "1px solid var(--border-default)",
                      color: "#fafafa",
                      fontSize: "0.76rem",
                    }}
                  />
                </div>

                {/* Posición del CTA en Pantalla */}
                <div>
                  <label style={{ display: "block", fontSize: "0.73rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                    Posición en pantalla:
                  </label>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button
                      type="button"
                      onClick={() => setCtaPosition("top")}
                      title="Arriba"
                      style={{
                        flex: 1,
                        padding: "0.38rem 0.2rem",
                        borderRadius: "5px",
                        border: ctaPosition === "top" ? "1px solid #f43f5e" : "1px solid var(--border-default)",
                        background: ctaPosition === "top" ? "#e11d48" : "var(--bg-surface-raised)",
                        color: "#fafafa",
                        fontSize: "0.72rem",
                        fontWeight: ctaPosition === "top" ? 700 : 400,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <AlignVerticalJustifyStart size={12} />
                      Arriba
                    </button>
                    <button
                      type="button"
                      onClick={() => setCtaPosition("center")}
                      title="Medio"
                      style={{
                        flex: 1,
                        padding: "0.38rem 0.2rem",
                        borderRadius: "5px",
                        border: ctaPosition === "center" ? "1px solid #f43f5e" : "1px solid var(--border-default)",
                        background: ctaPosition === "center" ? "#e11d48" : "var(--bg-surface-raised)",
                        color: "#fafafa",
                        fontSize: "0.72rem",
                        fontWeight: ctaPosition === "center" ? 700 : 400,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <AlignVerticalJustifyCenter size={12} />
                      Medio
                    </button>
                    <button
                      type="button"
                      onClick={() => setCtaPosition("bottom")}
                      title="Abajo"
                      style={{
                        flex: 1,
                        padding: "0.38rem 0.2rem",
                        borderRadius: "5px",
                        border: ctaPosition === "bottom" ? "1px solid #f43f5e" : "1px solid var(--border-default)",
                        background: ctaPosition === "bottom" ? "#e11d48" : "var(--bg-surface-raised)",
                        color: "#fafafa",
                        fontSize: "0.72rem",
                        fontWeight: ctaPosition === "bottom" ? 700 : 400,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <AlignVerticalJustifyEnd size={12} />
                      Abajo
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* VISTA PREVIA EN VIVO COMPARTIDA (SUBTÍTULOS + CTA) */}
          {(burnSubtitles || ctaEnabled) && (
            <div style={{ marginTop: "0.75rem", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border-default)", background: "#09090b" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.35rem 0.75rem", background: "var(--bg-surface-raised)", borderBottom: "1px solid var(--border-default)", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                  <Eye size={12} color="#38bdf8" />
                  Simulación de pantalla (Subtítulos & CTA):
                </span>
                <span style={{ fontSize: "0.68rem", opacity: 0.8, fontFamily: "var(--font-mono)" }}>
                  {burnSubtitles ? `Subs: ${captionPosition} (${captionLines === "1" ? "1 línea" : "2 líneas"})` : "Sin subs"} | {ctaEnabled ? `CTA: ${ctaPosition} (inicio & final)` : "Sin CTA"}
                </span>
              </div>

              <div
                style={{
                  position: "relative",
                  height: "140px",
                  background: "radial-gradient(ellipse at center, #18181b 0%, #09090b 100%)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: "6px", left: "10px", fontSize: "0.62rem", color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono)" }}>
                  [SIMULACIÓN EN PANTALLA]
                </div>

                {/* Insignia CTA Animada en Posición ARRIBA */}
                {ctaEnabled && ctaPosition === "top" && renderCtaBadgePreview()}

                {/* Subtítulo si está ARRIBA */}
                {burnSubtitles && captionPosition === "top" && (
                  <div style={{ marginTop: ctaEnabled && ctaPosition === "top" ? "4px" : "12px", zIndex: 1 }}>
                    {renderCaptionPreview()}
                  </div>
                )}

                {/* Centro (Subtítulo y/o CTA) */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", margin: "auto 0", zIndex: 1 }}>
                  {ctaEnabled && ctaPosition === "center" && renderCtaBadgePreview()}
                  {burnSubtitles && captionPosition === "center" && (
                    <div>{renderCaptionPreview()}</div>
                  )}
                </div>

                {/* Subtítulo si está ABAJO */}
                {burnSubtitles && captionPosition === "bottom" && (
                  <div style={{ marginBottom: ctaEnabled && ctaPosition === "bottom" ? "4px" : "4px", zIndex: 1 }}>
                    {renderCaptionPreview()}
                  </div>
                )}

                {/* Insignia CTA Animada en Posición ABAJO */}
                {ctaEnabled && ctaPosition === "bottom" && renderCtaBadgePreview()}
              </div>
            </div>
          )}

          <div style={{ marginTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-secondary)", flex: 1 }}>
              {candidate.rationale}
            </p>
            <button
              type="button"
              className="btn-confirm"
              onClick={() => {
                const id = candidate.id;
                onClose();
                void onCutCandidate(id, {
                  burnSubtitles,
                  captionStyle,
                  captionPosition,
                  captionColor,
                  captionHighlight,
                  captionLines,
                  ctaEnabled,
                  ctaText,
                  ctaPosition,
                  aspectRatio: (localStorage.getItem("autoshorts_clip_aspect_ratio") as "original" | "9:16") || "original",
                  startSec: trimStart,
                  endSec: trimEnd,
                });
              }}
              disabled={busy !== "idle"}
              style={{ whiteSpace: "nowrap", padding: "0.5rem 1rem", fontSize: "0.85rem" }}
            >
              <Scissors size={14} />
              <span>Cortar y Exportar Clip</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
