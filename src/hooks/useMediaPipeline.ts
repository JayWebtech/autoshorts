import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke, listen } from "../apiBridge";
import type {
  Candidate,
  ContentType,
  CopyResult,
  EnvironmentStatus,
  NormalizedTranscript,
  ProjectDetail,
  TargetDuration,
  Transcript,
} from "../types";
export interface CutClipOptions {
  burnSubtitles?: boolean;
  captionStyle?: string;
  captionPosition?: "bottom" | "center" | "top";
  captionColor?: string;
  captionHighlight?: string;
  captionLines?: "1" | "2";
  captionX?: number;
  captionY?: number;
  captionFontSize?: number;
  captionAlignH?: "left" | "center" | "right";
  ctaEnabled?: boolean;
  ctaText?: string;
  ctaPosition?: "top" | "center" | "bottom";
  ctaAnimation?: string;
  ctaX?: number;
  ctaY?: number;
  ctaScale?: number;
  aspectRatio?: "original" | "16:9" | "9:16";
  startSec?: number;
  endSec?: number;
  subRanges?: Array<{ start: number; end: number }>;
  transition?: string;
  fps?: number;
}

interface UseMediaPipelineOptions {
  detail: ProjectDetail | null;
  setDetail: React.Dispatch<React.SetStateAction<ProjectDetail | null>>;
  refresh: (projectId?: string) => Promise<void>;
  setError: (err: string | null) => void;
  busy: import("../types").BusyState;
  setBusy: (busy: import("../types").BusyState) => void;
  transcriptionEngine: string;
  whisperModel: string;
  llmEngine: string;
  localLlmModel: string;
  lmstudioModel: string;
  enableThinking: boolean;
  customMomentsPrompt: string;
  customOutputDir: string;
  selectedContentType: ContentType;
  targetDuration: TargetDuration;
  autoDetectMoments: boolean;
  pullModelDirectly: (modelName: string) => Promise<void>;
}

export function useMediaPipeline(options: UseMediaPipelineOptions) {
  const {
    detail,
    setDetail,
    refresh,
    setError,
    busy,
    setBusy,
    transcriptionEngine,
    whisperModel,
    llmEngine,
    localLlmModel,
    lmstudioModel,
    enableThinking,
    customMomentsPrompt,
    customOutputDir,
    selectedContentType,
    targetDuration,
    autoDetectMoments,
    pullModelDirectly,
  } = options;

  const [candidateProgress, setCandidateProgress] = useState<{ message: string; current: number; total: number } | null>(null);
  const [transcriptionProgress, setTranscriptionProgress] = useState<{ percentage: number; message: string } | null>(null);
  const [isRefiningTranscript, setIsRefiningTranscript] = useState<boolean>(false);
  const [isDetectingActionCues, setIsDetectingActionCues] = useState<boolean>(false);
  const [renderingCandidateId, setRenderingCandidateId] = useState<string | null>(null);
  const [clipAspectRatio, setClipAspectRatio] = useState<"original" | "16:9" | "9:16">(() => {
    return (localStorage.getItem("autoshorts_clip_aspect_ratio") as any) || "original";
  });

  // Candidate trim preview
  const [previewCandidate, setPreviewCandidate] = useState<Candidate | null>(null);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(0);
  const [isSavingTrim, setIsSavingTrim] = useState(false);

  // Social copy
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showQuickCopyModal, setShowQuickCopyModal] = useState(false);
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const [copyResult, setCopyResult] = useState<CopyResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copyExtraContext, setCopyExtraContext] = useState<string>("");
  const [copiedDescId, setCopiedDescId] = useState<string | null>(null);

  // Derived transcript & clip maps
  const transcript = useMemo(() => {
    if (!detail?.transcript) return null;
    try {
      return JSON.parse(detail.transcript.rawJson) as NormalizedTranscript;
    } catch {
      return null;
    }
  }, [detail?.transcript]);

  const selectedCount = detail?.candidates.filter((candidate) => candidate.selected).length ?? 0;
  const clipByCandidate = useMemo(() => {
    return new Map(detail?.clips.map((clip) => [clip.candidateId, clip]) ?? []);
  }, [detail?.clips]);
  const selectedCandidates = useMemo(() => {
    return detail?.candidates.filter((candidate) => candidate.selected) ?? [];
  }, [detail?.candidates]);

  const selectedCutCount = selectedCandidates.filter((candidate) => {
    const clip = clipByCandidate.get(candidate.id);
    return clip?.status === "done" && Boolean(clip.outputPath);
  }).length;
  const selectedCaptionsCount = selectedCandidates.filter((candidate) => {
    const clip = clipByCandidate.get(candidate.id);
    return clip?.status === "done" && Boolean(clip.captionAssPath);
  }).length;

  // Listeners for progress
  useEffect(() => {
    let unlistenProgress: (() => void) | null = null;
    void listen<{ message: string; current: number; total: number }>("candidate-progress", (event) => {
      setCandidateProgress(event.payload);
    }).then((unsub) => {
      unlistenProgress = unsub;
    });

    let unlistenTranscribe: (() => void) | null = null;
    void listen<{ percentage: number; message: string }>("transcription-progress", (event) => {
      setTranscriptionProgress(event.payload);
    }).then((unsub) => {
      unlistenTranscribe = unsub;
    });

    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenTranscribe) unlistenTranscribe();
    };
  }, []);

  const getActiveLlmConfig = useCallback(() => {
    const activeLlmModel =
      llmEngine === "local"
        ? localLlmModel.trim()
        : llmEngine === "lmstudio"
        ? lmstudioModel.trim() || null
        : null;
    return { activeLlmKey: "", activeLlmModel };
  }, [llmEngine, localLlmModel, lmstudioModel]);

  const transcribe = useCallback(async () => {
    if (!detail) return;
    setBusy("transcribe");
    setTranscriptionProgress({ percentage: 0, message: "Iniciando transcripción con faster-whisper..." });
    setError(null);
    try {
      const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
      await invoke<Transcript>("transcribe_project", {
        projectId: detail.project.id,
        provider: transcriptionEngine,
        apiKey: null,
        whisperModel,
        refineWithLlm: false,
        llmEngine,
        llmModel: activeLlmModel,
        llmApiKey: activeLlmKey || null,
        enableThinking,
      });
      await refresh(detail.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
      setTranscriptionProgress(null);
    }
  }, [
    detail,
    getActiveLlmConfig,
    transcriptionEngine,
    whisperModel,
    llmEngine,
    enableThinking,
    refresh,
    setError,
    setBusy,
  ]);

  const cancelTranscription = useCallback(async () => {
    try {
      await invoke("cancel_transcription");
      setTranscriptionProgress({ percentage: 0, message: "Cancelando transcripción..." });
      setTimeout(() => {
        setBusy("idle");
        setTranscriptionProgress(null);
        if (detail) {
          void refresh(detail.project.id);
        }
      }, 400);
    } catch (err) {
      console.error("Error al cancelar transcripción:", err);
      setBusy("idle");
      setTranscriptionProgress(null);
    }
  }, [detail, refresh, setBusy]);

  const refineTranscript = useCallback(async () => {
    if (!detail?.transcript) return;
    try {
      setIsRefiningTranscript(true);
      setError(null);
      const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
      await invoke("refine_project_transcript", {
        projectId: detail.project.id,
        provider: llmEngine,
        modelName: activeLlmModel,
        apiKey: activeLlmKey || null,
        enableThinking,
      });
      await refresh(detail.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefiningTranscript(false);
      setCandidateProgress(null);
    }
  }, [detail, getActiveLlmConfig, llmEngine, enableThinking, refresh, setError]);

  const detectActionCues = useCallback(async () => {
    if (!detail?.transcript) return;
    try {
      setIsDetectingActionCues(true);
      setError(null);
      await invoke("inject_acoustic_cues", {
        projectId: detail.project.id,
      });
      await refresh(detail.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDetectingActionCues(false);
    }
  }, [detail, refresh, setError]);

  const cancelMoments = useCallback(async () => {
    try {
      await invoke("cancel_candidate_generation");
      setCandidateProgress({ message: "Cancelando y liberando VRAM...", current: 0, total: 1 });
      setTimeout(() => {
        setBusy("idle");
        setCandidateProgress(null);
        if (detail) {
          void refresh(detail.project.id);
        }
      }, 500);
    } catch (err) {
      console.error("Error al cancelar momentos:", err);
      setBusy("idle");
      setCandidateProgress(null);
    }
  }, [detail, refresh, setBusy]);

  const moments = useCallback(
    async (allowDemo: boolean = false) => {
      if (!detail) return;
      setBusy("moments");
      setError(null);
      try {
        const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
        const gamingSubgenre = localStorage.getItem("autoshorts_gaming_subgenre") || "competitive";
        const gameContext = localStorage.getItem("autoshorts_game_context") || "";
        await invoke<Candidate[]>("generate_candidates", {
          projectId: detail.project.id,
          apiKey: activeLlmKey || null,
          provider: llmEngine,
          modelName: activeLlmModel,
          contentType: selectedContentType,
          targetDuration,
          allowDemo,
          enableThinking,
          customPrompt: customMomentsPrompt.trim() || null,
          gamingSubgenre,
          gameContext,
        });
        await refresh(detail.project.id);
      } catch (err) {
        const errMsg = String(err);
        if (llmEngine === "local" && (errMsg.includes("not found") || errMsg.includes("404"))) {
          if (window.confirm(`Ollama model "${localLlmModel}" is not downloaded. Would you like to download it now?`)) {
            setTimeout(() => {
              void pullModelDirectly(localLlmModel).then(() => {
                void refresh(detail.project.id);
              });
            }, 100);
            return;
          }
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy("idle");
      }
    },
    [
      detail,
      getActiveLlmConfig,
      llmEngine,
      selectedContentType,
      targetDuration,
      enableThinking,
      customMomentsPrompt,
      localLlmModel,
      pullModelDirectly,
      refresh,
      setError,
      setBusy,
    ]
  );

  const runAutoPipeline = useCallback(
    async (
      projectId: string,
      contentType: string = selectedContentType,
      durationTarget: TargetDuration = targetDuration
    ) => {
      setError(null);
      const env = await invoke<EnvironmentStatus>("environment_status");

      if (transcriptionEngine === "local") {
        if (!env.hasLocalWhisperModel) {
          setError(
            "Import successful. Local Whisper model is missing in your models directory. Please add it to start transcription."
          );
          return;
        }
      }

      if (llmEngine === "local") {
        if (!env.hasOllama) {
          setError(
            "Import successful. Local Ollama server is not running at http://localhost:11434. Please start it to find viral moments."
          );
          return;
        }
      } else if (llmEngine === "lmstudio") {
        if (!env.hasLmStudio) {
          setError(
            "Import successful. LM Studio is not running at http://127.0.0.1:1234. Please start LM Studio local server to find viral moments."
          );
          return;
        }
      }

      // 1. Transcription
      try {
        setBusy("transcribe");
        const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
        await invoke<Transcript>("transcribe_project", {
          projectId,
          provider: transcriptionEngine,
          apiKey: null,
          whisperModel,
          refineWithLlm: false,
          llmEngine,
          llmModel: activeLlmModel,
          llmApiKey: activeLlmKey || null,
          enableThinking,
        });
        await refresh(projectId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy("idle");
        return;
      }

      // 2. LLM Moments
      if (!autoDetectMoments) {
        setBusy("idle");
        return;
      }

      try {
        setBusy("moments");
        const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
        const gamingSubgenre = localStorage.getItem("autoshorts_gaming_subgenre") || "competitive";
        const gameContext = localStorage.getItem("autoshorts_game_context") || "";
        await invoke<Candidate[]>("generate_candidates", {
          projectId,
          apiKey: activeLlmKey || null,
          provider: llmEngine,
          modelName: activeLlmModel,
          contentType,
          targetDuration: durationTarget,
          allowDemo: false,
          enableThinking,
          customPrompt: customMomentsPrompt.trim() || null,
          gamingSubgenre,
          gameContext,
        });
        await refresh(projectId);
      } catch (err) {
        const errMsg = String(err);
        if (llmEngine === "local" && (errMsg.includes("not found") || errMsg.includes("404"))) {
          if (window.confirm(`Ollama model "${localLlmModel}" is not downloaded. Would you like to download it now?`)) {
            setTimeout(() => {
              void pullModelDirectly(localLlmModel).then(() => {
                void refresh(projectId);
              });
            }, 100);
            return;
          }
        }
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy("idle");
      }
    },
    [
      selectedContentType,
      targetDuration,
      transcriptionEngine,
      llmEngine,
      getActiveLlmConfig,
      whisperModel,
      enableThinking,
      autoDetectMoments,
      customMomentsPrompt,
      localLlmModel,
      pullModelDirectly,
      refresh,
      setError,
      setBusy,
    ]
  );

  const openCandidatePreview = useCallback((candidate: Candidate) => {
    setPreviewCandidate(candidate);
    setTrimStart(candidate.startSec);
    setTrimEnd(candidate.endSec);
  }, []);

  const saveCandidateTrim = useCallback(async () => {
    if (!previewCandidate || !detail) return;
    try {
      setIsSavingTrim(true);
      const updated = await invoke<Candidate>("update_candidate_trim", {
        candidateId: previewCandidate.id,
        startSec: trimStart,
        endSec: trimEnd,
      });
      setPreviewCandidate(updated);
      await refresh(detail.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingTrim(false);
    }
  }, [previewCandidate, detail, trimStart, trimEnd, refresh, setError]);

  const updateClipCount = useCallback(
    async (count: number) => {
      if (!detail) return;
      try {
        const candidates = await invoke<Candidate[]>("set_selected_clip_count", {
          projectId: detail.project.id,
          count,
        });
        setDetail({ ...detail, candidates });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [detail, setDetail, setError]
  );

  const toggleCandidateDismissed = useCallback(
    async (candidateId: string, dismissed: boolean) => {
      if (!detail) return;
      const prevCandidates = detail.candidates;
      const updatedCandidates = detail.candidates.map((c) =>
        c.id === candidateId ? { ...c, dismissed } : c
      );
      setDetail({ ...detail, candidates: updatedCandidates });

      try {
        await invoke("toggle_candidate_dismissed", {
          candidateId,
          dismissed,
        });
      } catch (err) {
        setDetail({ ...detail, candidates: prevCandidates });
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [detail, setDetail, setError]
  );

  const cutCandidate = useCallback(
    async (candidateId: string, options?: CutClipOptions) => {
      if (!detail) return;
      setRenderingCandidateId(candidateId);
      setBusy("cut");
      setError(null);
      try {
        const savedBurn = localStorage.getItem("autoshorts_burn_subtitles");
        const burnSubtitles =
          options?.burnSubtitles !== undefined
            ? options.burnSubtitles
            : savedBurn !== null
            ? savedBurn === "true"
            : true;
        const captionStyle =
          options?.captionStyle || localStorage.getItem("autoshorts_caption_style") || "tiktok-karaoke";
        const captionPosition =
          options?.captionPosition || (localStorage.getItem("autoshorts_caption_position") as "bottom" | "center" | "top") || "bottom";
        const captionColor =
          options?.captionColor || localStorage.getItem("autoshorts_caption_color") || "#ffffff";
        const captionHighlight =
          options?.captionHighlight || localStorage.getItem("autoshorts_caption_highlight") || "#facc15";
        const captionLines =
          options?.captionLines || (localStorage.getItem("autoshorts_caption_lines") as "1" | "2") || "1";
        const ctaEnabled =
          options?.ctaEnabled !== undefined
            ? options.ctaEnabled
            : localStorage.getItem("autoshorts_cta_enabled") === "true";
        const ctaText =
          options?.ctaText || localStorage.getItem("autoshorts_cta_text") || "❤️ ¡Sígueme y dale like!";
        const ctaPosition =
          options?.ctaPosition || (localStorage.getItem("autoshorts_cta_position") as "top" | "center" | "bottom") || "top";
        const ctaAnimation =
          options?.ctaAnimation || localStorage.getItem("autoshorts_cta_animation") || "bounce-land";
        const aspectRatio = options?.aspectRatio || clipAspectRatio;

        await invoke<string>("render_flat_clip_for_candidate", {
          candidateId,
          outputDir: customOutputDir || null,
          aspectRatio,
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
          ...(options?.captionX !== undefined ? { captionX: options.captionX } : {}),
          ...(options?.captionY !== undefined ? { captionY: options.captionY } : {}),
          ...(options?.captionFontSize !== undefined ? { captionFontSize: options.captionFontSize } : {}),
          ...(options?.captionAlignH !== undefined ? { captionAlignH: options.captionAlignH } : {}),
          ...(options?.ctaX !== undefined ? { ctaX: options.ctaX } : {}),
          ...(options?.ctaY !== undefined ? { ctaY: options.ctaY } : {}),
          ...(options?.ctaScale !== undefined ? { ctaScale: options.ctaScale } : {}),
          ...(options?.startSec !== undefined ? { startSec: options.startSec } : {}),
          ...(options?.endSec !== undefined ? { endSec: options.endSec } : {}),
          ...(options?.subRanges ? { subRanges: options.subRanges } : {}),
          ...(options?.transition ? { transition: options.transition } : {}),
          ...(options?.fps ? { fps: options.fps } : {}),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRenderingCandidateId(null);
        setBusy("idle");
        await refresh(detail.project.id);
      }
    },
    [detail, customOutputDir, clipAspectRatio, refresh, setError, setBusy]
  );

  const cutSelected = useCallback(async () => {
    if (!detail) return;
    setBusy("cut");
    setError(null);
    try {
      const savedBurn = localStorage.getItem("autoshorts_burn_subtitles");
      const burnSubtitles = savedBurn !== null ? savedBurn === "true" : true;
      const captionStyle = localStorage.getItem("autoshorts_caption_style") || "tiktok-karaoke";
      const captionPosition = (localStorage.getItem("autoshorts_caption_position") as "bottom" | "center" | "top") || "bottom";
      const ctaEnabled = localStorage.getItem("autoshorts_cta_enabled") === "true";
      const ctaText = localStorage.getItem("autoshorts_cta_text") || "❤️ ¡Sígueme y dale like!";
      const ctaPosition = (localStorage.getItem("autoshorts_cta_position") as "top" | "center" | "bottom") || "top";
      const ctaAnimation = localStorage.getItem("autoshorts_cta_animation") || "bounce-land";

      for (const candidate of selectedCandidates) {
        setRenderingCandidateId(candidate.id);
        await invoke<string>("render_flat_clip_for_candidate", {
          candidateId: candidate.id,
          outputDir: customOutputDir || null,
          aspectRatio: clipAspectRatio,
          burnSubtitles,
          captionStyle,
          captionPosition,
          ctaEnabled,
          ctaText,
          ctaPosition,
          ctaAnimation,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingCandidateId(null);
      setBusy("idle");
      await refresh(detail.project.id);
    }
  }, [detail, selectedCandidates, customOutputDir, clipAspectRatio, refresh, setError, setBusy]);

  const generateSocialCopy = useCallback(
    async (extraContextOverride?: string) => {
      if (!detail) return;
      setIsGeneratingCopy(true);
      setError(null);
      try {
        const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
        const res = await invoke<CopyResult>("generate_project_copy", {
          projectId: detail.project.id,
          provider: llmEngine,
          modelName: activeLlmModel,
          apiKey: activeLlmKey || null,
          enableThinking,
          extraContext: (extraContextOverride !== undefined ? extraContextOverride : copyExtraContext).trim() || null,
        });
        setCopyResult(res);
      } catch (err: any) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGeneratingCopy(false);
      }
    },
    [detail, getActiveLlmConfig, llmEngine, enableThinking, copyExtraContext, setError]
  );

  const copyTextToClipboard = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => {
      setCopiedField((curr) => (curr === key ? null : curr));
    }, 2000);
  }, []);

  const copyDescription = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedDescId(id);
    setTimeout(() => {
      setCopiedDescId((curr) => (curr === id ? null : curr));
    }, 2500);
  }, []);

  const [regeneratingCopyCandidateId, setRegeneratingCopyCandidateId] = useState<string | null>(null);

  const regenerateCandidateCopy = useCallback(
    async (candidateId: string) => {
      if (!detail) return;
      setRegeneratingCopyCandidateId(candidateId);
      setError(null);
      try {
        const { activeLlmKey, activeLlmModel } = getActiveLlmConfig();
        await invoke<{ candidateId: string; fullCopy: string; copyData: CopyResult }>("regenerate_candidate_copy", {
          candidateId,
          provider: llmEngine,
          modelName: activeLlmModel,
          apiKey: activeLlmKey || null,
          enableThinking,
        });
        await refresh(detail.project.id);
      } catch (err: any) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRegeneratingCopyCandidateId(null);
      }
    },
    [detail, getActiveLlmConfig, llmEngine, enableThinking, refresh, setError]
  );

  return {
    candidateProgress,
    transcriptionProgress,
    isRefiningTranscript,
    isDetectingActionCues,
    renderingCandidateId,
    clipAspectRatio,
    setClipAspectRatio,
    transcript,
    selectedCount,
    clipByCandidate,
    selectedCandidates,
    selectedCutCount,
    selectedCaptionsCount,
    transcribe,
    cancelTranscription,
    refineTranscript,
    detectActionCues,
    cancelMoments,
    moments,
    runAutoPipeline,
    openCandidatePreview,
    saveCandidateTrim,
    updateClipCount,
    toggleCandidateDismissed,
    cutCandidate,
    cutSelected,
    previewCandidate,
    setPreviewCandidate,
    trimStart,
    setTrimStart,
    trimEnd,
    setTrimEnd,
    isSavingTrim,
    // Social Copy
    showCopyModal,
    setShowCopyModal,
    showQuickCopyModal,
    setShowQuickCopyModal,
    isGeneratingCopy,
    copyResult,
    copiedField,
    copyExtraContext,
    setCopyExtraContext,
    generateSocialCopy,
    copyTextToClipboard,
    copiedDescId,
    copyDescription,
    regenerateCandidateCopy,
    regeneratingCopyCandidateId,
  };
}
