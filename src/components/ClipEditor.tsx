import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  Crosshair,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  ASPECT_PRESETS,
  CAPTION_STYLES,
  DEFAULT_AUTO_EDIT,
  DEFAULT_CAPTION_STYLE,
  FONT_FAMILIES,
  autoEditSummary,
  canPlayDirectly,
  captionPreviewStyle,
  clampCues,
  cropObjectPosition,
  cueAt,
  isLinuxWebview,
  needsProxyFor,
  normalizeAspect,
  normalizeAutoEdit,
  resolveCaptionStyle,
  sanitizeHex,
  stageMaxWidth,
  toPreviewTime,
  toSourceTime,
} from "../lib/clipEditor";
import type {
  AutoEditSettings,
  CaptionCue,
  CaptionStyleOverride,
  ClipEdit,
  ClipEditor as ClipEditorData,
  ClipEditorCandidate,
  ClipPreview,
} from "../lib/clipEditor";
import { formatTime } from "../lib/format";

export type ClipEditorProps = {
  candidateId: string;
  onClose: () => void;
  onSaved?: (edit: ClipEdit) => void;
  onBulkSaved?: (edits: ClipEdit[]) => void;
  onRangeChanged?: (candidate: ClipEditorCandidate) => void;
  onRender?: () => void;
};

const CUE_LENGTH_SEC = 1.5;
/** Height budget for the preview stage, in vh. */
const STAGE_MAX_HEIGHT_VH = 52;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** `convertFileSrc` is unavailable in plain browser/test contexts. */
function safeConvertFileSrc(path: string): string {
  if (typeof convertFileSrc !== "function") return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

/**
 * Modal preview/edit surface shown before a candidate is cut.
 *
 * The user sees the actual crop window over the source video, picks the output
 * aspect ratio and fixes the captions that land inside the clip.
 */
export function ClipEditor({ candidateId, onClose, onSaved, onBulkSaved, onRangeChanged, onRender }: ClipEditorProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    cropX: number;
    cropY: number;
    width: number;
    height: number;
  } | null>(null);

  const [data, setData] = useState<ClipEditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [cropX, setCropX] = useState(0.5);
  const [cropY, setCropY] = useState(0.5);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [captionStyle, setCaptionStyle] = useState(DEFAULT_CAPTION_STYLE);
  const [captionOverride, setCaptionOverride] = useState<CaptionStyleOverride>({});
  const [autoEdit, setAutoEdit] = useState<AutoEditSettings>(DEFAULT_AUTO_EDIT);

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stageWidth, setStageWidth] = useState(0);
  // Clip window. Mirrors `data.candidate` but stays authoritative after the
  // user widens or shrinks the cut.
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [savingRange, setSavingRange] = useState(false);
  const [applyingStyle, setApplyingStyle] = useState(false);
  const [styleNotice, setStyleNotice] = useState<string | null>(null);

  // Preview source. When the webview cannot decode the source codecs (no
  // H.264/AAC decoder in WebKitGTK on a stock Linux install) the backend
  // transcodes the *whole* video once into a VP8/Opus WebM proxy and we seek
  // inside it, so every clip of the project shares a single cache entry.
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewOffset, setPreviewOffset] = useState(0);
  const [preparingPreview, setPreparingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const proxyRequestedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setPreviewError(null);
    proxyRequestedRef.current = false;
    try {
      const payload = await invoke<ClipEditorData>("get_clip_editor", { candidateId });
      setData(payload);
      setAspectRatio(normalizeAspect(payload.edit?.aspectRatio));
      setCropX(clamp01(payload.edit?.cropX ?? 0.5));
      setCropY(clamp01(payload.edit?.cropY ?? 0.5));
      setCues(Array.isArray(payload.cues) ? payload.cues : payload.edit?.captions ?? []);
      setCaptionStyle(payload.captionStyle || payload.edit?.captionStyle || DEFAULT_CAPTION_STYLE);
      setCaptionOverride(payload.edit?.captionOverride ?? {});
      setAutoEdit({ ...DEFAULT_AUTO_EDIT, ...(payload.edit?.autoEdit ?? {}) });
      setRangeStart(payload.candidate?.startSec ?? 0);
      setRangeEnd(payload.candidate?.endSec ?? 0);
      setStyleNotice(null);
      setCurrentTime(payload.candidate?.startSec ?? 0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Caption preview is sized in ASS canvas units, so it has to know how wide
  // the stage actually is on screen.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageWidth(stage.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [loading, loadError, data]);

  const startSec = rangeStart;
  const endSec = rangeEnd;
  const clipDuration = Math.max(0, endSec - startSec);
  const sourceDuration = data?.sourceDurationSec ?? 0;

  const preset = ASPECT_PRESETS.find((item) => item.id === aspectRatio) ?? ASPECT_PRESETS[0];

  const resolvedStyle = resolveCaptionStyle(captionStyle, captionOverride);
  const captionCss = captionPreviewStyle(resolvedStyle, stageWidth);

  /** Transcode the whole source once and switch the player to the proxy. */
  const prepareProxy = useCallback(async () => {
    if (proxyRequestedRef.current) return;
    const projectId = data?.candidate?.projectId;
    if (!projectId) return;
    proxyRequestedRef.current = true;
    setPreparingPreview(true);
    setPreviewError(null);
    try {
      const preview = await invoke<ClipPreview>("prepare_project_preview", { projectId });
      setPreviewOffset(Number.isFinite(preview.startSec) ? preview.startSec : 0);
      // Loopback HTTP, not `convertFileSrc`: WebKitGTK's media pipeline cannot
      // open the `asset:` scheme at all.
      setPreviewSrc(preview.url || safeConvertFileSrc(preview.path));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparingPreview(false);
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;
    // On Linux `canPlayType` lies for MP4 (container support without a
    // decoder), so the probed codec decides there instead of the probe.
    const linux = isLinuxWebview();
    const useProxy = linux
      ? needsProxyFor(data.sourceVideoCodec, true)
      : canPlayDirectly(data.sourceVideoCodec, data.sourceAudioCodec, (mime) =>
          typeof document === "undefined" ? "" : document.createElement("video").canPlayType(mime),
        ) === false;
    console.info(
      "[clip-editor] preview mode",
      useProxy ? "proxy" : "direct",
      { codec: data.sourceVideoCodec, audio: data.sourceAudioCodec, linux },
    );
    if (useProxy) {
      void prepareProxy();
      return;
    }
    setPreviewOffset(0);
    setPreviewSrc(data.sourcePath ? safeConvertFileSrc(data.sourcePath) : "");
  }, [data, prepareProxy]);

  function handleVideoError() {
    const code = videoRef.current?.error?.code;
    if (proxyRequestedRef.current) {
      setPreviewError(
        `Não foi possível carregar a pré-visualização deste vídeo (código ${code ?? "?"}).`,
      );
      return;
    }
    // Unknown codecs reach this branch: try a transcoded proxy before giving up.
    console.warn("[clip-editor] source failed to load, building proxy", { code });
    void prepareProxy();
  }

  const activeCue = cueAt(cues, currentTime);

  const visibleCues = useMemo(
    () => cues.filter((cue) => cue.end > startSec && cue.start < endSec),
    [cues, startSec, endSec],
  );

  const relativeTime = Math.max(0, currentTime - startSec);

  function seek(time: number) {
    const video = videoRef.current;
    const next = Math.min(Math.max(time, startSec), endSec);
    if (video) {
      try {
        video.currentTime = Math.max(0, toPreviewTime(next, previewOffset));
      } catch {
        /* jsdom / unsupported seek */
      }
    }
    setCurrentTime(next);
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = Math.max(0, toPreviewTime(startSec, previewOffset));
    } catch {
      /* ignore */
    }
    setCurrentTime(startSec);
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    const time = toSourceTime(video.currentTime, previewOffset);
    if (!Number.isFinite(time)) return;

    if (time >= endSec || time < startSec - 0.001) {
      try {
        video.currentTime = Math.max(0, toPreviewTime(startSec, previewOffset));
      } catch {
        /* ignore */
      }
      setCurrentTime(startSec);
      return;
    }
    setCurrentTime(time);
  }

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      setPlaying(false);
      return;
    }
    if (currentTime < startSec || currentTime >= endSec) {
      seek(startSec);
    }
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      cropX,
      cropY,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom */
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.width;
    const dy = (event.clientY - drag.startY) / drag.height;
    // Grab semantics: dragging the picture right reveals what is on the left.
    setCropX(clamp01(drag.cropX - dx));
    setCropY(clamp01(drag.cropY - dy));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function addCaptionAtPlayhead() {
    const start = Math.min(Math.max(currentTime, startSec), Math.max(startSec, endSec - 0.1));
    const end = Math.min(endSec, start + CUE_LENGTH_SEC);
    const cue: CaptionCue = { start, end: end > start ? end : start + 0.1, text: "" };
    setCues((current) => [...current, cue].sort((a, b) => a.start - b.start));
  }

  function updateCue(index: number, patch: Partial<CaptionCue>) {
    setCues((current) => current.map((cue, i) => (i === index ? { ...cue, ...patch } : cue)));
  }

  function deleteCue(index: number) {
    setCues((current) => current.filter((_, i) => i !== index));
  }

  function updateOverride(patch: CaptionStyleOverride) {
    setCaptionOverride((current) => ({ ...current, ...patch }));
  }

  function updateAutoEdit(patch: Partial<AutoEditSettings>) {
    setAutoEdit((current) => ({ ...current, ...patch }));
  }

  /** Drop every override so the preset renders untouched again. */
  function resetOverride() {
    setCaptionOverride({});
  }

  async function resetToTranscript() {
    try {
      const payload = await invoke<ClipEditorData>("get_clip_editor", { candidateId });
      setCues(Array.isArray(payload.cues) ? payload.cues : []);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Persist a new clip window, then reload the cues that fall inside it. */
  async function applyRange(nextStart: number, nextEnd: number) {
    if (!data || savingRange) return;
    const projectId = data.candidate?.projectId;
    if (!projectId) return;
    const safeStart = Math.max(0, Number.isFinite(nextStart) ? nextStart : 0);
    const rawEnd = Number.isFinite(nextEnd) ? nextEnd : safeStart + 0.1;
    const limit = sourceDuration > 0 ? sourceDuration : rawEnd;
    const safeEnd = Math.min(Math.max(rawEnd, safeStart + 0.1), Math.max(limit, safeStart + 0.1));
    setSavingRange(true);
    setSaveError(null);
    try {
      const updated = await invoke<ClipEditorCandidate>("update_candidate_range", {
        candidateId,
        startSec: safeStart,
        endSec: safeEnd,
      });
      setRangeStart(updated.startSec);
      setRangeEnd(updated.endSec);
      setCurrentTime(updated.startSec);
      setData((current) =>
        current ? { ...current, candidate: { ...current.candidate, ...updated } } : current,
      );
      const nextCues = await invoke<CaptionCue[]>("caption_cues_for_range", {
        projectId,
        startSec: updated.startSec,
        endSec: updated.endSec,
      });
      if (Array.isArray(nextCues)) setCues(nextCues);
      onRangeChanged?.(updated);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingRange(false);
    }
  }

  /** Broadcast the current caption look to every clip of the project. */
  async function applyStyleToAll() {
    if (!data || applyingStyle) return;
    const projectId = data.candidate?.projectId;
    if (!projectId) return;
    const hasOverride = Object.values(captionOverride).some(
      (value) => value !== null && value !== undefined,
    );
    setApplyingStyle(true);
    setStyleNotice(null);
    setSaveError(null);
    try {
      const edits = await invoke<ClipEdit[]>("apply_caption_style_to_project", {
        projectId,
        captionStyle: captionStyle || DEFAULT_CAPTION_STYLE,
        captionOverride: hasOverride ? captionOverride : null,
      });
      const list = Array.isArray(edits) ? edits : [];
      if (onBulkSaved) onBulkSaved(list);
      else list.forEach((edit) => onSaved?.(edit));
      setStyleNotice(`Estilo aplicado a ${list.length} clipe(s).`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingStyle(false);
    }
  }

  async function handleSave(andCut: boolean) {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    const hasOverride = Object.values(captionOverride).some(
      (value) => value !== null && value !== undefined,
    );
    const edit: ClipEdit = {
      candidateId,
      aspectRatio: normalizeAspect(aspectRatio),
      cropX: clamp01(cropX),
      cropY: clamp01(cropY),
      captions: clampCues(cues, 0, Number.POSITIVE_INFINITY),
      captionStyle: captionStyle || DEFAULT_CAPTION_STYLE,
      captionOverride: hasOverride ? captionOverride : null,
      autoEdit: autoEdit.enabled ? normalizeAutoEdit(autoEdit) : null,
    };
    try {
      const saved = await invoke<ClipEdit>("save_clip_edit", { edit });
      onSaved?.(saved ?? edit);
      if (andCut) {
        onClose();
        onRender?.();
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="clip-editor-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="clip-editor-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Clip editor ${candidateId}`}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="clip-editor-header">
          <div>
            <h3>Edit clip</h3>
            {data && (
              <p className="clip-editor-subtitle">
                {formatTime(startSec)} - {formatTime(endSec)} · {formatTime(clipDuration)} long
              </p>
            )}
          </div>
          <button className="clip-editor-close" onClick={onClose} aria-label="Close clip editor">
            <X size={18} />
          </button>
        </header>

        {loading && (
          <div className="clip-editor-status">
            <Loader2 className="spin" size={20} />
            Loading clip…
          </div>
        )}

        {!loading && loadError && (
          <div className="clip-editor-status error" role="alert">
            <span>{loadError}</span>
            <div className="clip-editor-status-actions">
              <button className="btn-confirm" onClick={() => void load()}>
                Retry
              </button>
              <button className="btn-cancel" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {!loading && !loadError && data && (
          <>
            <div className="clip-editor-body">
              <div className="clip-editor-preview-column">
                <div
                  className="clip-editor-stage"
                  ref={stageRef}
                  style={{
                    aspectRatio: `${preset.width} / ${preset.height}`,
                    // Cap the width so `max-height` can never squash the ratio.
                    maxWidth: stageMaxWidth(aspectRatio, STAGE_MAX_HEIGHT_VH),
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  aria-label="Crop preview"
                >
                  <video
                    ref={videoRef}
                    data-testid="clip-editor-video"
                    className="clip-editor-video"
                    src={previewSrc}
                    onError={handleVideoError}
                    muted
                    playsInline
                    preload="auto"
                    onLoadedMetadata={handleLoadedMetadata}
                    onTimeUpdate={handleTimeUpdate}
                    style={{ objectPosition: cropObjectPosition(cropX, cropY) }}
                  />
                  <div className="clip-editor-thumbs" aria-hidden="true">
                    <span className="thirds-v" />
                    <span className="thirds-v" />
                    <span className="thirds-h" />
                    <span className="thirds-h" />
                  </div>
                  <div className="clip-editor-crop-frame" aria-hidden="true" />
                  {activeCue && (
                    <div
                      className="clip-editor-caption"
                      data-style={captionStyle}
                      data-testid="clip-editor-caption"
                      style={captionCss}
                    >
                      {resolvedStyle.uppercase ? activeCue.text.toUpperCase() : activeCue.text}
                    </div>
                  )}
                  {(preparingPreview || previewError) && (
                    <div
                      className={`clip-editor-stage-status ${previewError ? "error" : ""}`}
                      role={previewError ? "alert" : "status"}
                    >
                      {previewError ? (
                        <span>{previewError}</span>
                      ) : (
                        <>
                          <Loader2 className="spin" size={18} />
                          <span>
                            Preparando pré-visualização do vídeo inteiro… acontece uma vez por
                            projeto.
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="clip-editor-transport">
                  <button
                    className="clip-editor-play"
                    onClick={() => void togglePlay()}
                    aria-label={playing ? "Pause" : "Play"}
                  >
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <input
                    type="range"
                    aria-label="Playhead"
                    min={startSec}
                    max={endSec > startSec ? endSec : startSec + 0.1}
                    step={0.05}
                    value={currentTime}
                    onChange={(event) => seek(Number(event.target.value))}
                  />
                  <span className="clip-editor-time">
                    {formatTime(relativeTime)} / {formatTime(clipDuration)}
                  </span>
                </div>

                <div className="clip-editor-range">
                  <label>
                    <span>Início</span>
                    <input
                      type="range"
                      aria-label="Início do corte"
                      min={0}
                      max={Math.max(0, (sourceDuration || endSec) - 0.1)}
                      step={0.05}
                      value={startSec}
                      disabled={savingRange}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setRangeStart(next);
                        if (next >= rangeEnd) setRangeEnd(next + 0.1);
                      }}
                      onPointerUp={() => void applyRange(rangeStart, rangeEnd)}
                      onKeyUp={() => void applyRange(rangeStart, rangeEnd)}
                    />
                    <input
                      type="number"
                      aria-label="Início do corte em segundos"
                      step={0.1}
                      min={0}
                      value={Number(startSec.toFixed(2))}
                      disabled={savingRange}
                      onChange={(event) => setRangeStart(Number(event.target.value) || 0)}
                      onBlur={() => void applyRange(rangeStart, rangeEnd)}
                    />
                  </label>
                  <label>
                    <span>Fim</span>
                    <input
                      type="range"
                      aria-label="Fim do corte"
                      min={startSec + 0.1}
                      max={Math.max(startSec + 0.1, sourceDuration || endSec)}
                      step={0.05}
                      value={endSec}
                      disabled={savingRange}
                      onChange={(event) => setRangeEnd(Number(event.target.value))}
                      onPointerUp={() => void applyRange(rangeStart, rangeEnd)}
                      onKeyUp={() => void applyRange(rangeStart, rangeEnd)}
                    />
                    <input
                      type="number"
                      aria-label="Fim do corte em segundos"
                      step={0.1}
                      min={0}
                      value={Number(endSec.toFixed(2))}
                      disabled={savingRange}
                      onChange={(event) => setRangeEnd(Number(event.target.value) || 0)}
                      onBlur={() => void applyRange(rangeStart, rangeEnd)}
                    />
                  </label>
                  <button
                    className="clip-editor-center"
                    onClick={() => void applyRange(rangeStart, rangeEnd)}
                    disabled={savingRange}
                  >
                    {savingRange ? <Loader2 className="spin" size={14} /> : null}
                    Aplicar período
                  </button>
                </div>

                <div className="clip-editor-aspect">
                  {ASPECT_PRESETS.map((item) => (
                    <button
                      key={item.id}
                      className={`clip-editor-aspect-btn ${aspectRatio === item.id ? "active" : ""}`}
                      aria-pressed={aspectRatio === item.id}
                      title={item.label}
                      onClick={() => setAspectRatio(item.id)}
                    >
                      {item.id}
                    </button>
                  ))}
                </div>

                <div className="clip-editor-crop-controls">
                  <label>
                    <span>Horizontal</span>
                    <input
                      type="range"
                      aria-label="Horizontal crop"
                      min={0}
                      max={1}
                      step={0.01}
                      value={cropX}
                      onChange={(event) => setCropX(clamp01(Number(event.target.value)))}
                    />
                  </label>
                  <label>
                    <span>Vertical</span>
                    <input
                      type="range"
                      aria-label="Vertical crop"
                      min={0}
                      max={1}
                      step={0.01}
                      value={cropY}
                      onChange={(event) => setCropY(clamp01(Number(event.target.value)))}
                    />
                  </label>
                  <button
                    className="clip-editor-center"
                    onClick={() => {
                      setCropX(0.5);
                      setCropY(0.5);
                    }}
                  >
                    <Crosshair size={14} />
                    Center
                  </button>
                </div>
              </div>

              <div className="clip-editor-side">
                <details className="clip-editor-style clip-editor-autoedit" open>
                  <summary>Auto-edit: cortar silêncios</summary>

                  <div className="clip-editor-toggles">
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Ativar auto-edit"
                        checked={autoEdit.enabled}
                        onChange={(event) => updateAutoEdit({ enabled: event.target.checked })}
                      />
                      Deixar o vídeo dinâmico
                    </label>
                  </div>

                  <p className="clip-editor-autoedit-summary" role="status">
                    {autoEditSummary(autoEdit)}
                  </p>

                  {autoEdit.enabled && (
                    <>
                      <div className="clip-editor-field">
                        <label htmlFor="clip-editor-autoedit-threshold">
                          Limite de silêncio{" "}
                          <span>{Math.round(autoEdit.silenceThresholdDb)} dB</span>
                        </label>
                        <input
                          id="clip-editor-autoedit-threshold"
                          type="range"
                          min={-60}
                          max={-8}
                          step={1}
                          value={autoEdit.silenceThresholdDb}
                          onChange={(event) =>
                            updateAutoEdit({ silenceThresholdDb: Number(event.target.value) })
                          }
                        />
                      </div>

                      <div className="clip-editor-field">
                        <label htmlFor="clip-editor-autoedit-min">
                          Pausa mínima{" "}
                          <span>{autoEdit.minSilenceSec.toFixed(2)}s</span>
                        </label>
                        <input
                          id="clip-editor-autoedit-min"
                          type="range"
                          min={0.15}
                          max={3}
                          step={0.05}
                          value={autoEdit.minSilenceSec}
                          onChange={(event) =>
                            updateAutoEdit({ minSilenceSec: Number(event.target.value) })
                          }
                        />
                      </div>

                      <div className="clip-editor-field">
                        <label htmlFor="clip-editor-autoedit-padding">
                          Respiro nas bordas{" "}
                          <span>{Math.round(autoEdit.paddingSec * 1000)}ms</span>
                        </label>
                        <input
                          id="clip-editor-autoedit-padding"
                          type="range"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={autoEdit.paddingSec}
                          onChange={(event) =>
                            updateAutoEdit({ paddingSec: Number(event.target.value) })
                          }
                        />
                      </div>

                      <div className="clip-editor-field">
                        <label htmlFor="clip-editor-autoedit-mode">Nas pausas</label>
                        <select
                          id="clip-editor-autoedit-mode"
                          value={autoEdit.silenceMode}
                          onChange={(event) =>
                            updateAutoEdit({
                              silenceMode: event.target.value === "speed" ? "speed" : "cut",
                            })
                          }
                        >
                          <option value="cut">Cortar (jump cut)</option>
                          <option value="speed">Acelerar</option>
                        </select>
                      </div>

                      {autoEdit.silenceMode === "speed" && (
                        <div className="clip-editor-field">
                          <label htmlFor="clip-editor-autoedit-speed">
                            Velocidade da pausa{" "}
                            <span>{autoEdit.silenceSpeed.toFixed(2)}x</span>
                          </label>
                          <input
                            id="clip-editor-autoedit-speed"
                            type="range"
                            min={1.1}
                            max={4}
                            step={0.1}
                            value={autoEdit.silenceSpeed}
                            onChange={(event) =>
                              updateAutoEdit({ silenceSpeed: Number(event.target.value) })
                            }
                          />
                        </div>
                      )}

                      <div className="clip-editor-field">
                        <label htmlFor="clip-editor-autoedit-punch">
                          Zoom dinâmico{" "}
                          <span>
                            {autoEdit.punchInZoom > 1
                              ? `${autoEdit.punchInZoom.toFixed(2)}x`
                              : "desligado"}
                          </span>
                        </label>
                        <input
                          id="clip-editor-autoedit-punch"
                          type="range"
                          min={1}
                          max={1.4}
                          step={0.01}
                          value={autoEdit.punchInZoom}
                          onChange={(event) =>
                            updateAutoEdit({ punchInZoom: Number(event.target.value) })
                          }
                        />
                      </div>

                      <div className="clip-editor-style-actions">
                        <button
                          className="clip-editor-center"
                          onClick={() => setAutoEdit(DEFAULT_AUTO_EDIT)}
                        >
                          <RotateCcw size={14} />
                          Resetar auto-edit
                        </button>
                      </div>
                    </>
                  )}
                </details>

                <div className="clip-editor-field">
                  <label htmlFor="clip-editor-caption-style">Caption style</label>
                  <select
                    id="clip-editor-caption-style"
                    value={captionStyle}
                    onChange={(event) => setCaptionStyle(event.target.value)}
                  >
                    {CAPTION_STYLES.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </div>

                <details className="clip-editor-style" open>
                  <summary>Legenda: cor, fonte e área</summary>

                  <div className="clip-editor-field">
                    <label htmlFor="clip-editor-font">Fonte</label>
                    <select
                      id="clip-editor-font"
                      value={resolvedStyle.fontFamily}
                      onChange={(event) => updateOverride({ fontFamily: event.target.value })}
                    >
                      {FONT_FAMILIES.map((font) => (
                        <option key={font.id} value={font.id}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="clip-editor-field">
                    <label htmlFor="clip-editor-font-size">
                      Tamanho <span>{Math.round(resolvedStyle.fontSize)}</span>
                    </label>
                    <input
                      id="clip-editor-font-size"
                      type="range"
                      min={24}
                      max={200}
                      step={1}
                      value={resolvedStyle.fontSize}
                      onChange={(event) => updateOverride({ fontSize: Number(event.target.value) })}
                    />
                  </div>

                  <div className="clip-editor-colors">
                    <label>
                      <span>Texto</span>
                      <input
                        type="color"
                        aria-label="Cor do texto"
                        value={resolvedStyle.textColor}
                        onChange={(event) =>
                          updateOverride({ textColor: sanitizeHex(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      <span>Contorno</span>
                      <input
                        type="color"
                        aria-label="Cor do contorno"
                        value={resolvedStyle.outlineColor}
                        onChange={(event) =>
                          updateOverride({ outlineColor: sanitizeHex(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      <span>Caixa</span>
                      <input
                        type="color"
                        aria-label="Cor da caixa"
                        value={resolvedStyle.boxColor}
                        onChange={(event) =>
                          updateOverride({ boxColor: sanitizeHex(event.target.value) })
                        }
                      />
                    </label>
                  </div>

                  <div className="clip-editor-toggles">
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Caixa sólida"
                        checked={resolvedStyle.borderStyle === 3}
                        onChange={(event) =>
                          updateOverride({ borderStyle: event.target.checked ? 3 : 1 })
                        }
                      />
                      Caixa sólida
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Negrito"
                        checked={resolvedStyle.bold}
                        onChange={(event) => updateOverride({ bold: event.target.checked })}
                      />
                      Negrito
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Maiúsculas"
                        checked={resolvedStyle.uppercase}
                        onChange={(event) => updateOverride({ uppercase: event.target.checked })}
                      />
                      Maiúsculas
                    </label>
                  </div>

                  <div className="clip-editor-field">
                    <label htmlFor="clip-editor-caption-pos">
                      Posição vertical <span>{Math.round(resolvedStyle.position * 100)}%</span>
                    </label>
                    <input
                      id="clip-editor-caption-pos"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={resolvedStyle.position}
                      onChange={(event) => updateOverride({ position: Number(event.target.value) })}
                    />
                  </div>

                  <div className="clip-editor-field">
                    <label htmlFor="clip-editor-caption-width">
                      Largura da área <span>{Math.round(resolvedStyle.maxWidth * 100)}%</span>
                    </label>
                    <input
                      id="clip-editor-caption-width"
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.01}
                      value={resolvedStyle.maxWidth}
                      onChange={(event) => updateOverride({ maxWidth: Number(event.target.value) })}
                    />
                  </div>

                  <div className="clip-editor-style-actions">
                    <button className="clip-editor-center" onClick={resetOverride}>
                      <RotateCcw size={14} />
                      Resetar estilo
                    </button>
                    <button
                      className="clip-editor-center apply-all"
                      onClick={() => void applyStyleToAll()}
                      disabled={applyingStyle}
                    >
                      {applyingStyle ? <Loader2 className="spin" size={14} /> : null}
                      Aplicar a todos os clipes
                    </button>
                  </div>
                  {styleNotice && (
                    <p className="clip-editor-style-notice" role="status">
                      {styleNotice}
                    </p>
                  )}
                </details>

                <div className="clip-editor-cues" aria-label="Captions">
                  <div className="clip-editor-cues-header">
                    <strong>Captions</strong>
                    <div className="clip-editor-cues-actions">
                      <button onClick={addCaptionAtPlayhead}>
                        <Plus size={14} />
                        Add caption
                      </button>
                      <button onClick={() => void resetToTranscript()}>
                        <RotateCcw size={14} />
                        Reset to transcript
                      </button>
                    </div>
                  </div>

                  {visibleCues.length === 0 && (
                    <p className="clip-editor-cues-empty">No captions inside this clip.</p>
                  )}

                  {visibleCues.map((cue) => {
                    const index = cues.indexOf(cue);
                    const invalid = !(cue.end > cue.start);
                    return (
                      <div
                        key={`${cue.start}-${index}`}
                        className={`clip-editor-cue ${invalid ? "invalid" : ""} ${
                          activeCue === cue ? "active" : ""
                        }`}
                      >
                        <div className="clip-editor-cue-times">
                          <input
                            type="number"
                            step={0.1}
                            aria-label={`Caption ${index + 1} start`}
                            aria-invalid={invalid}
                            value={Number.isFinite(cue.start) ? cue.start : 0}
                            onChange={(event) =>
                              updateCue(index, { start: Number(event.target.value) })
                            }
                          />
                          <span>-</span>
                          <input
                            type="number"
                            step={0.1}
                            aria-label={`Caption ${index + 1} end`}
                            aria-invalid={invalid}
                            value={Number.isFinite(cue.end) ? cue.end : 0}
                            onChange={(event) =>
                              updateCue(index, { end: Number(event.target.value) })
                            }
                          />
                          <button
                            className="clip-editor-cue-delete"
                            aria-label={`Delete caption ${index + 1}`}
                            onClick={() => deleteCue(index)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <input
                          type="text"
                          aria-label={`Caption ${index + 1} text`}
                          value={cue.text}
                          onChange={(event) => updateCue(index, { text: event.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <footer className="clip-editor-footer">
              {saveError && (
                <span className="clip-editor-save-error" role="alert">
                  {saveError}
                </span>
              )}
              <button className="btn-cancel" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn-confirm secondary"
                onClick={() => void handleSave(false)}
                disabled={saving}
              >
                {saving ? <Loader2 className="spin" size={16} /> : null}
                Save
              </button>
              <button
                className="btn-confirm"
                onClick={() => void handleSave(true)}
                disabled={saving}
              >
                {saving ? <Loader2 className="spin" size={16} /> : null}
                Save &amp; Cut
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default ClipEditor;
