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
  const [activeTab, setActiveTab] = useState<"trim" | "subs" | "cta">("trim");

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

  const [ctaAnimation, setCtaAnimation] = useState<string>(() => {
    return localStorage.getItem("autoshorts_cta_animation") || "bounce-land";
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

  useEffect(() => {
    localStorage.setItem("autoshorts_cta_animation", ctaAnimation);
  }, [ctaAnimation]);

  const exportedClip = clipByCandidate.get(candidate.id);
  const exportedPath = exportedClip?.status === "done" && exportedClip.outputPath ? exportedClip.outputPath : null;
  const isExported = Boolean(exportedPath);
  const clipDuration = Math.max(0.1, isExported ? (candidate.endSec - candidate.startSec) : (trimEnd - trimStart));

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

    let animClass = "motionmaxxing-badge";
    if (ctaAnimation === "slide-up") {
      animClass = "cta-anim-slide-up";
    } else if (ctaAnimation === "pulse-glow") {
      animClass = "cta-anim-pulse-glow";
    } else if (ctaAnimation === "fade-smooth") {
      animClass = "cta-anim-fade-smooth";
    }

    return (
      <div
        className={animClass}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          background: "rgba(16, 16, 22, 0.92)",
          border: `1.4px solid ${borderColor}`,
          boxShadow: `0 3px 12px ${shadowColor}, 0 2px 5px rgba(0,0,0,0.8)`,
          padding: "4px 13px",
          borderRadius: "9999px",
          color: "#ffffff",
          fontSize: "0.76rem",
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
      <div className="clip-studio-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header con Hook y Metadatos */}
        <div className="clip-studio-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  background: "#0284c7",
                  color: "#fff",
                  fontSize: "0.72rem",
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                Clip #{candidate.rank}
              </span>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>
                "{cleanHook(candidate.hook)}"
              </h3>
            </div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: "0.78rem",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatTime(trimStart)} - {formatTime(trimEnd)} ({clipDuration.toFixed(1)}s de duración)
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            title="Cerrar modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cuerpo Principal Dividido en 2 Columnas de Estudio */}
        <div className="clip-studio-body">
          {/* COLUMNA IZQUIERDA: LIENZO EN VIVO (SMARTPHONE 9:16) & CONTROLES VLC */}
          <div className="clip-studio-preview-col">
            {isExported && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.4rem 0.75rem",
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "6px",
                  fontSize: "0.72rem",
                  color: "#34d399",
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                <span>✨ Mostrando Clip Exportado (Incrustado)</span>
                <span style={{ fontSize: "0.66rem", opacity: 0.85, color: "#a7f3d0", fontFamily: "var(--font-mono)" }}>
                  {exportedPath ? exportedPath.split(/[\\/]/).pop() : ""}
                </span>
              </div>
            )}

            {/* Pantalla Smartphone 9:16 con Reproductor y Overlays en Vivo */}
            <div className="clip-phone-stage" onClick={togglePlayPause} style={{ cursor: "pointer" }}>
              <video
                ref={videoRef}
                key={`${candidate.id}_${isExported ? 'exported_' + exportedPath : 'source'}`}
                src={`http://127.0.0.1:1422/stream?file=${encodeURIComponent(
                  exportedPath || detail.project.sourcePath
                )}`}
                autoPlay
                loop={isExported}
                playsInline
                preload="auto"
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = isExported ? 0 : trimStart;
                    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
                  }
                }}
                onEnded={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = isExported ? 0 : trimStart;
                    videoRef.current.play().catch(() => {});
                  }
                }}
                onTimeUpdate={handleTimeUpdate}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />

              {/* Botón Central de Play cuando está pausado */}
              {!isPlaying && (
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    background: "rgba(0, 0, 0, 0.65)",
                    backdropFilter: "blur(4px)",
                    color: "#ffffff",
                    borderRadius: "50%",
                    width: "56px",
                    height: "56px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.6)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                  }}
                >
                  <Play size={26} style={{ marginLeft: "4px" }} />
                </div>
              )}

              {/* Lienzo Dinámico sobre el Video: Subtítulos y CTA en Tiempo Real (solo en fuente original) */}
              {!isExported && (burnSubtitles || ctaEnabled) && (
                <div className="clip-phone-overlay-container">
                  {/* ZONA SUPERIOR */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                    {ctaEnabled && ctaPosition === "top" && renderCtaBadgePreview()}
                    {burnSubtitles && captionPosition === "top" && (
                      <div style={{ marginTop: ctaEnabled && ctaPosition === "top" ? "4px" : "8px" }}>
                        {renderCaptionPreview()}
                      </div>
                    )}
                  </div>

                  {/* ZONA CENTRAL */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                    {ctaEnabled && ctaPosition === "center" && renderCtaBadgePreview()}
                    {burnSubtitles && captionPosition === "center" && (
                      <div>{renderCaptionPreview()}</div>
                    )}
                  </div>

                  {/* ZONA INFERIOR */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                    {burnSubtitles && captionPosition === "bottom" && (
                      <div style={{ marginBottom: ctaEnabled && ctaPosition === "bottom" ? "4px" : "0" }}>
                        {renderCaptionPreview()}
                      </div>
                    )}
                    {ctaEnabled && ctaPosition === "bottom" && renderCtaBadgePreview()}
                  </div>
                </div>
              )}
            </div>

            {/* Barra de Transporte VLC Compacta */}
            <div
              style={{
                background: "#12141c",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "0.55rem 0.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "5px",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    color: "#fafafa",
                    cursor: "pointer",
                    padding: "4px 8px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "5px",
                  }}
                  title={isPlaying ? "Pausar" : "Reproducir"}
                >
                  {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                </button>

                <span
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "#38bdf8",
                    fontFamily: "var(--font-mono, monospace)",
                    fontVariantNumeric: "tabular-nums",
                    minWidth: "42px",
                  }}
                  title="Tiempo actual del clip"
                >
                  {formatTime(currentPlayTime)}
                </span>

                <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                  <input
                    type="range"
                    min={0}
                    max={clipDuration}
                    step={0.1}
                    value={Math.min(currentPlayTime, clipDuration)}
                    onChange={handleSeek}
                    style={{
                      width: "100%",
                      height: "6px",
                      borderRadius: "3px",
                      accentColor: "#0284c7",
                      cursor: "pointer",
                      outline: "none",
                    }}
                  />
                </div>

                <span
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontVariantNumeric: "tabular-nums",
                    minWidth: "42px",
                    textAlign: "right",
                  }}
                  title="Duración del clip"
                >
                  {formatTime(clipDuration)}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                  paddingLeft: "4px",
                }}
              >
                <span>
                  Clip: <strong style={{ color: "#38bdf8", fontFamily: "var(--font-mono)" }}>{currentPlayTime.toFixed(1)}s</strong> / {clipDuration.toFixed(1)}s
                </span>
                <span>
                  Original: <strong style={{ color: "#fafafa", fontFamily: "var(--font-mono)" }}>{formatTime(absoluteCurrentTime)}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* COLUMNA DERECHA: HERRAMIENTAS ORGANIZADAS EN PESTAÑAS */}
          <div className="clip-studio-tools-col">
            {/* Barra de Pestañas Superior */}
            <div className="studio-tabs-bar">
              <button
                type="button"
                className={`studio-tab-btn ${activeTab === "trim" ? "active" : ""}`}
                onClick={() => setActiveTab("trim")}
              >
                <Clock size={14} />
                <span>1. Recorte (Trim)</span>
              </button>
              <button
                type="button"
                className={`studio-tab-btn ${activeTab === "subs" ? "active" : ""}`}
                onClick={() => setActiveTab("subs")}
              >
                <Type size={14} />
                <span>2. Subtítulos</span>
              </button>
              <button
                type="button"
                className={`studio-tab-btn ${activeTab === "cta" ? "active" : ""}`}
                onClick={() => setActiveTab("cta")}
              >
                <Heart size={14} />
                <span>3. CTA Animado</span>
              </button>
            </div>

            {/* PESTAÑA 1: RECORTE Y TIEMPOS */}
            {activeTab === "trim" && (
              <div className="studio-tab-pane">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--text-primary)" }}>
                      Ajuste Fino de Tiempos
                    </h4>
                    <p style={{ margin: "2px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                      Extiende o acorta el clip con precisión quirúrgica de décimas de segundo.
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)",
                      background: "rgba(255, 255, 255, 0.05)",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    Duración: <strong style={{ color: "#38bdf8" }}>{clipDuration.toFixed(1)}s</strong>
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
                  {/* Inicio */}
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      padding: "0.75rem",
                      borderRadius: "8px",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 600 }}>Punto de Inicio</span>
                      <span style={{ fontSize: "0.76rem", color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                        {formatTime(trimStart)} ({trimStart.toFixed(1)}s)
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimStart((curr) => Math.max(0, Number((curr - 5).toFixed(1))))}
                        title="Retroceder inicio 5s"
                      >
                        -5s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimStart((curr) => Math.max(0, Number((curr - 1).toFixed(1))))}
                        title="Retroceder inicio 1s"
                      >
                        -1s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimStart((curr) => Math.min(trimEnd - 1, Number((curr + 1).toFixed(1))))}
                        title="Avanzar inicio 1s"
                      >
                        +1s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimStart((curr) => Math.min(trimEnd - 1, Number((curr + 5).toFixed(1))))}
                        title="Avanzar inicio 5s"
                      >
                        +5s
                      </button>
                    </div>
                  </div>

                  {/* Fin */}
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      padding: "0.75rem",
                      borderRadius: "8px",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 600 }}>Punto de Fin</span>
                      <span style={{ fontSize: "0.76rem", color: "#38bdf8", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                        {formatTime(trimEnd)} ({trimEnd.toFixed(1)}s)
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimEnd((curr) => Math.max(trimStart + 1, Number((curr - 5).toFixed(1))))}
                        title="Acortar fin 5s"
                      >
                        -5s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimEnd((curr) => Math.max(trimStart + 1, Number((curr - 1).toFixed(1))))}
                        title="Acortar fin 1s"
                      >
                        -1s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimEnd((curr) => Number((curr + 1).toFixed(1)))}
                        title="Extender fin 1s"
                      >
                        +1s
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        style={{ flex: 1, padding: 0, height: "28px", minHeight: "28px", fontSize: "0.74rem", fontFamily: "var(--font-mono)" }}
                        onClick={() => setTrimEnd((curr) => Number((curr + 5).toFixed(1)))}
                        title="Extender fin 5s"
                      >
                        +5s
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.5rem" }}>
                  {trimStart !== candidate.startSec || trimEnd !== candidate.endSec ? (
                    <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                      Original IA: {formatTime(candidate.startSec)} - {formatTime(candidate.endSec)}
                    </span>
                  ) : (
                    <div />
                  )}

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn-cancel"
                      style={{ minHeight: "32px", fontSize: "0.76rem", padding: "0 12px" }}
                      onClick={() => {
                        setTrimStart(candidate.startSec);
                        setTrimEnd(candidate.endSec);
                      }}
                      disabled={trimStart === candidate.startSec && trimEnd === candidate.endSec}
                    >
                      Restablecer Original
                    </button>
                    <button
                      type="button"
                      className="btn-confirm"
                      style={{ minHeight: "32px", fontSize: "0.76rem", padding: "0 16px" }}
                      onClick={onSaveTrim}
                      disabled={isSavingTrim || trimStart >= trimEnd}
                    >
                      {isSavingTrim ? "Guardando..." : "Guardar Ajuste"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 2: SUBTÍTULOS DINÁMICOS */}
            {activeTab === "subs" && (
              <div className="studio-tab-pane">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--text-primary)" }}>
                      Subtítulos Dinámicos (Motionmaxxing)
                    </h4>
                    <p style={{ margin: "2px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                      Renderizado en vivo con tipografías hiper-legibles y resaltado por palabra.
                    </p>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.78rem" }}>
                    <input
                      type="checkbox"
                      checked={burnSubtitles}
                      onChange={(e) => setBurnSubtitles(e.target.checked)}
                      style={{ accentColor: "#0284c7", cursor: "pointer" }}
                    />
                    <span style={{ color: burnSubtitles ? "#38bdf8" : "var(--text-secondary)", fontWeight: 700 }}>
                      Incrustar Subtítulos
                    </span>
                  </label>
                </div>

                {burnSubtitles ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "0.85rem", paddingTop: "0.25rem" }}>
                      {/* Estilo */}
                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.4rem", fontWeight: 600 }}>
                          Estilo de animación:
                        </label>
                        <select
                          value={captionStyle}
                          onChange={(e) => setCaptionStyle(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.45rem 0.6rem",
                            borderRadius: "6px",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            color: "#fafafa",
                            fontSize: "0.78rem",
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

                      {/* Posición */}
                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.4rem", fontWeight: 600 }}>
                          Posición en pantalla:
                        </label>
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button
                            type="button"
                            onClick={() => setCaptionPosition("top")}
                            title="Arriba"
                            style={{
                              flex: 1,
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: captionPosition === "top" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: captionPosition === "top" ? "#0284c7" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: captionPosition === "top" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                            }}
                          >
                            <AlignVerticalJustifyStart size={12} />
                            Arriba
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptionPosition("center")}
                            title="Centro"
                            style={{
                              flex: 1,
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: captionPosition === "center" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: captionPosition === "center" ? "#0284c7" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: captionPosition === "center" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                            }}
                          >
                            <AlignVerticalJustifyCenter size={12} />
                            Centro
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptionPosition("bottom")}
                            title="Abajo"
                            style={{
                              flex: 1,
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: captionPosition === "bottom" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: captionPosition === "bottom" ? "#0284c7" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: captionPosition === "bottom" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                            }}
                          >
                            <AlignVerticalJustifyEnd size={12} />
                            Abajo
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Paletas de Colores */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "0.85rem",
                        background: "rgba(255, 255, 255, 0.02)",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <div>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)",
                            marginBottom: "0.4rem",
                            fontWeight: 600,
                          }}
                        >
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
                                  width: "22px",
                                  height: "22px",
                                  borderRadius: "4px",
                                  background: swatch.color,
                                  border: captionColor.toLowerCase() === swatch.color.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.2)",
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
                              width: "28px",
                              height: "24px",
                              padding: "0 1px",
                              borderRadius: "4px",
                              border: "1px solid rgba(255, 255, 255, 0.2)",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)",
                            marginBottom: "0.4rem",
                            fontWeight: 600,
                          }}
                        >
                          <Sparkles size={12} color="#facc15" />
                          Resaltado (Karaoke):
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
                                  width: "22px",
                                  height: "22px",
                                  borderRadius: "4px",
                                  background: swatch.color,
                                  border: captionHighlight.toLowerCase() === swatch.color.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.2)",
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
                              width: "28px",
                              height: "24px",
                              padding: "0 1px",
                              borderRadius: "4px",
                              border: "1px solid rgba(255, 255, 255, 0.2)",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Distribución de Líneas */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "rgba(255, 255, 255, 0.02)",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <div>
                        <label style={{ display: "block", fontSize: "0.76rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                          Distribución de líneas:
                        </label>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {captionLines === "1" ? "⚡ 1 sola línea fija (estilo TikTok / Shorts)" : "Dividir en hasta 2 líneas"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        <button
                          type="button"
                          onClick={() => setCaptionLines("1")}
                          style={{
                            padding: "0.35rem 0.75rem",
                            borderRadius: "5px",
                            border: captionLines === "1" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                            background: captionLines === "1" ? "#0284c7" : "rgba(255, 255, 255, 0.04)",
                            color: "#fafafa",
                            fontSize: "0.74rem",
                            fontWeight: captionLines === "1" ? 700 : 400,
                            cursor: "pointer",
                          }}
                        >
                          1 Sola Línea
                        </button>
                        <button
                          type="button"
                          onClick={() => setCaptionLines("2")}
                          style={{
                            padding: "0.35rem 0.75rem",
                            borderRadius: "5px",
                            border: captionLines === "2" ? "1px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.1)",
                            background: captionLines === "2" ? "#0284c7" : "rgba(255, 255, 255, 0.04)",
                            color: "#fafafa",
                            fontSize: "0.74rem",
                            fontWeight: captionLines === "2" ? 700 : 400,
                            cursor: "pointer",
                          }}
                        >
                          2 Líneas
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: "1.5rem",
                      textAlign: "center",
                      background: "rgba(255, 255, 255, 0.02)",
                      borderRadius: "8px",
                      border: "1px dashed rgba(255, 255, 255, 0.1)",
                      color: "var(--text-muted)",
                      fontSize: "0.8rem",
                    }}
                  >
                    Los subtítulos incrustados están desactivados. El video se exportará limpio y se creará un archivo .srt sincronizado por separado.
                  </div>
                )}
              </div>
            )}

            {/* PESTAÑA 3: CTA ANIMADO */}
            {activeTab === "cta" && (
              <div className="studio-tab-pane">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "0.92rem", fontWeight: 700, color: "var(--text-primary)" }}>
                      Llamado a la Acción (CTA Animado)
                    </h4>
                    <p style={{ margin: "2px 0 0", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                      Insignia flotante dinámica para maximizar likes, comentarios y suscripciones.
                    </p>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.78rem" }}>
                    <input
                      type="checkbox"
                      checked={ctaEnabled}
                      onChange={(e) => setCtaEnabled(e.target.checked)}
                      style={{ accentColor: "#f43f5e", cursor: "pointer" }}
                    />
                    <span style={{ color: ctaEnabled ? "#f43f5e" : "var(--text-secondary)", fontWeight: 700 }}>
                      Incrustar Insignia
                    </span>
                  </label>
                </div>

                {ctaEnabled ? (
                  <>
                    <div
                      style={{
                        background: "rgba(255, 255, 255, 0.02)",
                        padding: "0.75rem",
                        borderRadius: "8px",
                        border: "1px solid rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600 }}>
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
                            fontSize: "0.72rem",
                            cursor: "pointer",
                          }}
                        >
                          <option value="" disabled>Elegir sugerencia rápida...</option>
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
                          padding: "0.45rem 0.65rem",
                          borderRadius: "6px",
                          background: "rgba(255, 255, 255, 0.05)",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          color: "#fafafa",
                          fontSize: "0.78rem",
                        }}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "0.85rem" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.4rem", fontWeight: 600 }}>
                          Estilo de animación:
                        </label>
                        <select
                          value={ctaAnimation}
                          onChange={(e) => setCtaAnimation(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "0.45rem 0.6rem",
                            borderRadius: "6px",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            color: "#fafafa",
                            fontSize: "0.76rem",
                            cursor: "pointer",
                          }}
                        >
                          <option value="bounce-land">💥 Impacto & Rebote (Bounce Land)</option>
                          <option value="slide-up">⬆️ Deslizamiento Suave (Slide Up)</option>
                          <option value="pulse-glow">💓 Latido Neón Continuo (Pulse Glow)</option>
                          <option value="fade-smooth">✨ Fundido Elegante (Fade Smooth)</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.4rem", fontWeight: 600 }}>
                          Posición en pantalla:
                        </label>
                        <div style={{ display: "flex", gap: "0.3rem" }}>
                          <button
                            type="button"
                            onClick={() => setCtaPosition("top")}
                            title="Arriba"
                            style={{
                              flex: 1,
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: ctaPosition === "top" ? "1px solid #f43f5e" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: ctaPosition === "top" ? "#e11d48" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: ctaPosition === "top" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                            }}
                          >
                            <AlignVerticalJustifyStart size={12} />
                            Arriba
                          </button>
                          <button
                            type="button"
                            onClick={() => setCtaPosition("center")}
                            title="Centro"
                            style={{
                              flex: 1,
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: ctaPosition === "center" ? "1px solid #f43f5e" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: ctaPosition === "center" ? "#e11d48" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: ctaPosition === "center" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
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
                              padding: "0.42rem 0.2rem",
                              borderRadius: "5px",
                              border: ctaPosition === "bottom" ? "1px solid #f43f5e" : "1px solid rgba(255, 255, 255, 0.1)",
                              background: ctaPosition === "bottom" ? "#e11d48" : "rgba(255, 255, 255, 0.04)",
                              color: "#fafafa",
                              fontSize: "0.72rem",
                              fontWeight: ctaPosition === "bottom" ? 700 : 400,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "3px",
                            }}
                          >
                            <AlignVerticalJustifyEnd size={12} />
                            Abajo
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      padding: "1.5rem",
                      textAlign: "center",
                      background: "rgba(255, 255, 255, 0.02)",
                      borderRadius: "8px",
                      border: "1px dashed rgba(255, 255, 255, 0.1)",
                      color: "var(--text-muted)",
                      fontSize: "0.8rem",
                    }}
                  >
                    El CTA animado está desactivado para este clip.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3. FOOTER DEL ESTUDIO */}
        <div className="clip-studio-footer">
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
            <span
              style={{
                background: "rgba(2, 132, 199, 0.15)",
                color: "#38bdf8",
                border: "1px solid rgba(2, 132, 199, 0.3)",
                fontSize: "0.72rem",
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: "9999px",
                whiteSpace: "nowrap",
              }}
            >
              ● Score IA: {Math.round(candidate.score * 10)}/100
            </span>
            <p
              style={{
                margin: 0,
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={candidate.rationale}
            >
              {candidate.rationale}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              style={{ minHeight: "36px", padding: "0 16px", fontSize: "0.82rem" }}
            >
              Descartar
            </button>
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
                  ctaAnimation,
                  aspectRatio: (localStorage.getItem("autoshorts_clip_aspect_ratio") as "original" | "9:16") || "original",
                  startSec: trimStart,
                  endSec: trimEnd,
                });
              }}
              disabled={busy !== "idle"}
              style={{
                minHeight: "36px",
                padding: "0 18px",
                fontSize: "0.82rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                background: "#0284c7",
                color: "#ffffff",
                border: "1px solid #0284c7",
                fontWeight: 700,
                borderRadius: "6px",
                boxShadow: "0 2px 10px rgba(2, 132, 199, 0.4)",
                cursor: "pointer",
              }}
            >
              <Scissors size={15} />
              <span>Cortar y Exportar Clip</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
