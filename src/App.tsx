import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  AudioLines,
  BadgeCheck,
  Captions,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  FileVideo,
  Loader2,
  Play,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  Copy,
  Database,
  Cloud,
  Crop,
  Youtube,
  AlertTriangle,
} from "lucide-react";
import { EmptyState, PipelineStep } from "./components/common";
import { ClipEditor } from "./components/ClipEditor";
import type { CandidateThumbnail, ClipEdit } from "./lib/clipEditor";
import { normalizeAspect } from "./lib/clipEditor";
import { fileName, formatEncoderLabel, formatModelSize, formatTime } from "./lib/format";
import "./styles.css";

type EnvironmentStatus = {
  dataDir: string;
  hasFfmpeg: boolean;
  hasFfprobe: boolean;
  hasDeepgramKey: boolean;
  hasAnthropicKey: boolean;
  hasDeepseekKey: boolean;
  hasGeminiKey: boolean;
  hasOpenaiKey: boolean;
  hasOpenrouterKey: boolean;
  hasGroqKey: boolean;
  hasOpenaiCompatibleKey: boolean;
  openaiBaseUrl: string | null;
  llmProvider: string;
  hasLocalWhisperModel: boolean;
  hasOllama: boolean;
  hasYtdlp: boolean;
  gpuAccel: boolean;
  videoEncoder: string;
};

type Project = {
  id: string;
  name: string | null;
  sourcePath: string;
  sourceDuration: number | null;
  status: string;
  transcriptionMode: string;
  captionStyle?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Transcript = {
  id: string;
  projectId: string;
  engine: string;
  rawJson: string;
  language: string | null;
  createdAt: string;
};

type Candidate = {
  id: string;
  projectId: string;
  startSec: number;
  endSec: number;
  score: number;
  hook: string;
  rationale: string;
  rank: number;
  selected: boolean;
};

type Clip = {
  id: string;
  candidateId: string;
  status: string;
  outputPath: string | null;
  faceTrackJson: string | null;
  captionAssPath: string | null;
  renderLog: string | null;
};

type ProjectDetail = {
  project: Project;
  transcript: Transcript | null;
  candidates: Candidate[];
  clips: Clip[];
  clipEdits?: ClipEdit[];
};

type NormalizedTranscript = {
  language: string;
  duration: number;
  speakers: string[];
  segments: Array<{
    start: number;
    end: number;
    speaker: string | null;
    text: string;
  }>;
};

type BusyState =
  | "idle"
  | "import"
  | "transcribe"
  | "demoTranscript"
  | "moments"
  | "clipCount"
  | "cut";

type WhisperModelInfo = {
  id: string;
  label: string;
  sizeMb: number;
  downloaded: boolean;
  path: string | null;
};

type WhisperDownloadState = {
  model: string;
  status: string;
  percentage: number;
};

// Mirrors `python_env::PythonEnvStatus` on the Rust side: the app owns a venv
// under its data dir so `openai-whisper` ships without a manual pip install.
type PythonEnvStatus = {
  ready: boolean;
  venvCreated: boolean;
  venvDir: string;
  python: string | null;
  systemPython: string | null;
  whisperCli: string | null;
};

type PythonInstallState = {
  status: string;
  percentage: number;
};

type PipelineProgressState = {
  stage: string;
  label: string;
  percentage: number | null;
};

function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  // candidateId -> loopback thumbnail URL, rendered in the candidate cards.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbVersion, setThumbVersion] = useState(0);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [renderingCandidateId, setRenderingCandidateId] = useState<string | null>(null);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("modern-box");
  const [mediaPathToImport, setMediaPathToImport] = useState<string | null>(null);
  const [editingCandidateId, setEditingCandidateId] = useState<string | null>(null);

  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeStatus, setYoutubeStatus] = useState<"idle" | "checking" | "warning" | "downloading">("idle");
  const [youtubeWarningLicense, setYoutubeWarningLicense] = useState<string | null>(null);

  // Persistence logic from localStorage
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  const [transcriptionEngine, setTranscriptionEngine] = useState<"deepgram" | "local">(() => {
    return (localStorage.getItem("autoshorts_transcription_engine") as "deepgram" | "local") || "local";
  });
  type LlmEngine = "claude" | "deepseek" | "local" | "gemini" | "openai" | "openai-compatible" | "openrouter" | "groq";
  const [llmEngine, setLlmEngine] = useState<LlmEngine>(() => {
    return (localStorage.getItem("autoshorts_llm_engine") as LlmEngine) || "local";
  });
  const [localLlmModel, setLocalLlmModel] = useState(() => {
    return localStorage.getItem("autoshorts_local_llm_model") || "llama3.2";
  });
  const [deepgramKey, setDeepgramKey] = useState(() => {
    return localStorage.getItem("autoshorts_deepgram_key") || "";
  });
  const [anthropicKey, setAnthropicKey] = useState(() => {
    return localStorage.getItem("autoshorts_anthropic_key") || "";
  });
  const [deepseekKey, setDeepseekKey] = useState(() => {
    return localStorage.getItem("autoshorts_deepseek_key") || "";
  });
  const [deepseekModel, setDeepseekModel] = useState(() => {
    return localStorage.getItem("autoshorts_deepseek_model") || "";
  });
  const [geminiKey, setGeminiKey] = useState(() => {
    return localStorage.getItem("autoshorts_gemini_key") || "";
  });
  const [openaiKey, setOpenaiKey] = useState(() => {
    return localStorage.getItem("autoshorts_openai_key") || "";
  });
  const [openrouterKey, setOpenrouterKey] = useState(() => {
    return localStorage.getItem("autoshorts_openrouter_key") || "";
  });
  const [groqKey, setGroqKey] = useState(() => {
    return localStorage.getItem("autoshorts_groq_key") || "";
  });
  const [openrouterModel, setOpenrouterModel] = useState(() => {
    return localStorage.getItem("autoshorts_openrouter_model") || "";
  });
  const [openaiCompatibleKey, setOpenaiCompatibleKey] = useState(() => {
    return localStorage.getItem("autoshorts_openai_compatible_key") || "";
  });
  const [openaiCompatibleBaseUrl, setOpenaiCompatibleBaseUrl] = useState(() => {
    return localStorage.getItem("autoshorts_openai_compatible_base_url") || "";
  });
  const [openaiCompatibleModel, setOpenaiCompatibleModel] = useState(() => {
    return localStorage.getItem("autoshorts_openai_compatible_model") || "";
  });

  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [modelDownloadStatus, setModelDownloadStatus] = useState("");
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);

  const [whisperModel, setWhisperModel] = useState(() => {
    return localStorage.getItem("autoshorts_whisper_model") || "base";
  });
  const [whisperModels, setWhisperModels] = useState<WhisperModelInfo[]>([]);
  const [whisperDownload, setWhisperDownload] = useState<WhisperDownloadState | null>(null);
  const [pythonEnv, setPythonEnv] = useState<PythonEnvStatus | null>(null);
  const [pythonInstall, setPythonInstall] = useState<PythonInstallState | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgressState | null>(null);
  const pipelineHideTimer = useRef<number | null>(null);

  // Single global progress bar fed by the backend `pipeline-progress` event,
  // emitted by every long-running command (import, extract, transcribe,
  // moments, cut, youtube).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<PipelineProgressState>("pipeline-progress", (event) => {
      const payload = event.payload;
      if (pipelineHideTimer.current !== null) {
        window.clearTimeout(pipelineHideTimer.current);
        pipelineHideTimer.current = null;
      }
      setPipelineProgress(payload);
      if (payload.percentage !== null && payload.percentage >= 100) {
        pipelineHideTimer.current = window.setTimeout(() => {
          setPipelineProgress(null);
          pipelineHideTimer.current = null;
        }, 1200);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
      if (pipelineHideTimer.current !== null) {
        window.clearTimeout(pipelineHideTimer.current);
      }
    };
  }, []);

  // The bar is only cleared by a 100% event, so a command that failed before
  // finishing (missing output folder, ffmpeg error, panic) used to leave a
  // frozen "Rendering clip #1… 0%". Clear it whenever the command settles.
  function clearPipelineProgress(stage?: string) {
    if (pipelineHideTimer.current !== null) {
      window.clearTimeout(pipelineHideTimer.current);
      pipelineHideTimer.current = null;
    }
    setPipelineProgress((current) => {
      if (!current) return current;
      if (stage && current.stage !== stage) return current;
      return null;
    });
  }

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
  const clipEditByCandidate = useMemo(() => {
    return new Map((detail?.clipEdits ?? []).map((edit) => [edit.candidateId, edit]));
  }, [detail?.clipEdits]);
  const selectedCandidates = detail?.candidates.filter((candidate) => candidate.selected) ?? [];
  const selectedCutCount = selectedCandidates.filter((candidate) => {
    const clip = clipByCandidate.get(candidate.id);
    return clip?.status === "done" && Boolean(clip.outputPath);
  }).length;
  const selectedCaptionsCount = selectedCandidates.filter((candidate) => {
    const clip = clipByCandidate.get(candidate.id);
    return clip?.status === "done" && Boolean(clip.captionAssPath);
  }).length;
  const canUseCloudKey = environment?.hasDeepgramKey || deepgramKey.trim().length > 0;
  const canUseClaude = environment?.hasAnthropicKey || anthropicKey.trim().length > 0;
  const canUseDeepseek = environment?.hasDeepseekKey || deepseekKey.trim().length > 0;
  const canUseGemini = environment?.hasGeminiKey || geminiKey.trim().length > 0;
  const canUseOpenai = environment?.hasOpenaiKey || openaiKey.trim().length > 0;
  const canUseOpenrouter = environment?.hasOpenrouterKey || openrouterKey.trim().length > 0;
  const canUseGroq = environment?.hasGroqKey || groqKey.trim().length > 0;
  // Custom endpoints only need a base URL; the API key is optional for local servers.
  const canUseOpenaiCompatible = openaiCompatibleBaseUrl.trim().length > 0 || Boolean(environment?.openaiBaseUrl);

  const canTranscribe = transcriptionEngine === "local"
    ? Boolean(environment?.hasLocalWhisperModel)
    : canUseCloudKey;

  const canUseActiveLlm = llmEngine === "local"
    ? Boolean(environment?.hasOllama)
    : llmEngine === "claude"
      ? canUseClaude
      : llmEngine === "deepseek"
        ? canUseDeepseek
        : llmEngine === "gemini"
          ? canUseGemini
          : llmEngine === "openai"
            ? canUseOpenai
            : llmEngine === "openrouter"
              ? canUseOpenrouter
              : llmEngine === "openai-compatible"
                ? canUseOpenaiCompatible
                : llmEngine === "groq"
                  ? canUseGroq
                  : false;

  useEffect(() => {
    void refresh();
    const value = localStorage.getItem("autoshorts_onboarded");
    if (value === "true") {
      setIsOnboarded(true);
    } else {
      setIsOnboarded(false);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("autoshorts_transcription_engine", transcriptionEngine);
  }, [transcriptionEngine]);

  useEffect(() => {
    localStorage.setItem("autoshorts_llm_engine", llmEngine);
  }, [llmEngine]);

  useEffect(() => {
    localStorage.setItem("autoshorts_local_llm_model", localLlmModel);
  }, [localLlmModel]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepgram_key", deepgramKey);
  }, [deepgramKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_anthropic_key", anthropicKey);
  }, [anthropicKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepseek_key", deepseekKey);
  }, [deepseekKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepseek_model", deepseekModel);
  }, [deepseekModel]);

  useEffect(() => {
    localStorage.setItem("autoshorts_gemini_key", geminiKey);
  }, [geminiKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_key", openaiKey);
  }, [openaiKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openrouter_key", openrouterKey);
  }, [openrouterKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_groq_key", groqKey);
  }, [groqKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openrouter_model", openrouterModel);
  }, [openrouterModel]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_compatible_key", openaiCompatibleKey);
  }, [openaiCompatibleKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_compatible_base_url", openaiCompatibleBaseUrl);
  }, [openaiCompatibleBaseUrl]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_compatible_model", openaiCompatibleModel);
  }, [openaiCompatibleModel]);

  useEffect(() => {
    localStorage.setItem("autoshorts_whisper_model", whisperModel);
  }, [whisperModel]);

  useEffect(() => {
    void loadWhisperModels();
    void loadPythonEnv();
  }, []);

  // Candidate thumbnails: extracted once per project (cached on disk) and
  // re-extracted when a cut window changes.
  useEffect(() => {
    const projectId = detail?.project.id;
    if (!projectId) {
      setThumbnails({});
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke<CandidateThumbnail[]>("prepare_project_thumbnails", {
          projectId,
        });
        if (cancelled) return;
        const next: Record<string, string> = {};
        (Array.isArray(list) ? list : []).forEach((item) => {
          if (item?.candidateId && item.url) next[item.candidateId] = item.url;
        });
        setThumbnails(next);
      } catch {
        /* thumbnails are a nicety, never block the view */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail?.project.id, detail?.candidates.length, thumbVersion]);

  const pullModelDirectly = async (modelName: string) => {
    setDownloadingModelName(modelName);
    setModelDownloadProgress(0);
    setModelDownloadStatus("Connecting to Ollama...");
    try {
      const unlisten = await listen<{
        status: string;
        completed?: number;
        total?: number;
        percentage?: number;
      }>("ollama-pull-progress", (event) => {
        const payload = event.payload;
        setModelDownloadStatus(payload.status);
        if (payload.percentage !== undefined && payload.percentage !== null) {
          setModelDownloadProgress(Math.round(payload.percentage));
        }
      });

      await invoke("pull_ollama_model", { modelName });
      unlisten();
      setModelDownloadStatus("Download complete!");
      setModelDownloadProgress(100);
      setTimeout(() => setDownloadingModelName(null), 500);
    } catch (err) {
      alert("Failed to download model: " + String(err));
      setDownloadingModelName(null);
    }
  };

  async function loadWhisperModels() {
    try {
      const models = await invoke<WhisperModelInfo[]>("list_whisper_models");
      setWhisperModels(models);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadPythonEnv() {
    try {
      setPythonEnv(await invoke<PythonEnvStatus>("python_env_status"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Provisions the app-managed venv and installs `openai-whisper` in it. The
  // backend streams pip output through `python-env-progress`.
  async function installPythonEnv() {
    setError(null);
    setPythonInstall({ status: "Preparando ambiente Python…", percentage: 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ status: string; percentage?: number | null }>(
        "python-env-progress",
        (event) => {
          const payload = event.payload;
          setPythonInstall((previous) => ({
            status: payload.status,
            percentage:
              payload.percentage !== undefined && payload.percentage !== null
                ? Math.round(payload.percentage)
                : previous?.percentage ?? 0,
          }));
        },
      );

      await invoke("install_python_env");
      await Promise.all([loadPythonEnv(), loadWhisperModels()]);
      setPythonInstall({ status: "Whisper instalado!", percentage: 100 });
      setTimeout(() => setPythonInstall(null), 1500);
      await refresh();
    } catch (err) {
      setPythonInstall(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      unlisten?.();
    }
  }

  async function downloadWhisperModel(modelId: string) {
    setError(null);
    setWhisperDownload({ model: modelId, status: "Preparing download...", percentage: 0 });
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ status: string; percentage?: number | null }>(
        "whisper-model-progress",
        (event) => {
          const payload = event.payload;
          setWhisperDownload((previous) => ({
            model: modelId,
            status: payload.status,
            percentage:
              payload.percentage !== undefined && payload.percentage !== null
                ? Math.round(payload.percentage)
                : previous?.percentage ?? 0,
          }));
        },
      );

      await invoke("download_whisper_model", { modelName: modelId });
      setWhisperModel(modelId);
      await loadWhisperModels();
      setWhisperDownload({ model: modelId, status: "Download complete!", percentage: 100 });
      setTimeout(() => setWhisperDownload(null), 1200);
    } catch (err) {
      setWhisperDownload(null);
      alert("Failed to download Whisper model: " + String(err));
    } finally {
      unlisten?.();
    }
  }

  async function refresh(nextProjectId?: string) {
    setError(null);
    const [env, projectList] = await Promise.all([
      invoke<EnvironmentStatus>("environment_status"),
      invoke<Project[]>("list_projects"),
    ]);
    setEnvironment(env);
    setProjects(projectList);

    if (nextProjectId) {
      const nextDetail = await invoke<ProjectDetail>("get_project_detail", { projectId: nextProjectId });
      setDetail(nextDetail);
    } else {
      setDetail(null);
    }
  }

  async function run(action: BusyState, task: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
      clearPipelineProgress();
    }
  }

  async function importMedia() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "Media",
          extensions: ["mp4", "mov", "mp3", "wav", "m4a"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setMediaPathToImport(selected);
    setShowStyleModal(true);
  }

  async function handleYoutubeImport() {
    if (!youtubeUrl) return;
    setYoutubeStatus("checking");
    setError(null);
    try {
      const result = await invoke<{isSafe: boolean; license: string | null}>("check_youtube_copyright", { url: youtubeUrl });
      if (!result.isSafe) {
        setYoutubeWarningLicense(result.license || "Unknown / Not specified");
        setYoutubeStatus("warning");
        return;
      }
      await executeYoutubeDownload();
    } catch (err: any) {
      setError(err.toString());
      setYoutubeStatus("idle");
    }
  }

  async function executeYoutubeDownload() {
    setYoutubeStatus("downloading");
    setError(null);
    try {
      const downloadedPath = await invoke<string>("download_youtube_video", { url: youtubeUrl });
      setYoutubeModalOpen(false);
      setYoutubeUrl("");
      setYoutubeStatus("idle");
      setMediaPathToImport(downloadedPath);
      setShowStyleModal(true);
    } catch (err: any) {
      setError(err.toString());
      setYoutubeStatus("idle");
    }
  }

  async function confirmImport(style: string) {
    if (!mediaPathToImport) return;
    const selected = mediaPathToImport;
    setMediaPathToImport(null);
    setShowStyleModal(false);

    let newProjectId: string | null = null;
    await run("import", async () => {
      const project = await invoke<Project>("create_project_from_path", {
        path: selected,
        transcriptionMode: transcriptionEngine === "local" ? "local" : "cloud",
        captionStyle: style,
      });
      newProjectId = project.id;
      await refresh(project.id);
    });

    if (newProjectId) {
      await runAutoPipeline(newProjectId);
    }
  }

  async function runAutoPipeline(projectId: string) {
    setError(null);
    const env = await invoke<EnvironmentStatus>("environment_status");

    if (transcriptionEngine === "local") {
      if (!env.hasLocalWhisperModel) {
        setError("Importação concluída. O Whisper local não está instalado. Abra as configurações e clique em \"Instalar Whisper\" para começar a transcrever.");
        return;
      }
    } else {
      const hasDG = env.hasDeepgramKey || deepgramKey.trim().length > 0;
      if (!hasDG) {
        setError("Import successful. Deepgram key is missing. Please add it to start transcription.");
        return;
      }
    }

    if (llmEngine === "local") {
      if (!env.hasOllama) {
        setError("Import successful. Local Ollama server is not running at http://localhost:11434. Please start it to find viral moments.");
        return;
      }
    } else {
      const activeKey =
        llmEngine === "claude" ? anthropicKey :
          llmEngine === "deepseek" ? deepseekKey :
            llmEngine === "gemini" ? geminiKey :
              llmEngine === "openai" ? openaiKey :
                llmEngine === "openai-compatible" ? openaiCompatibleKey :
                  llmEngine === "openrouter" ? openrouterKey :
                    llmEngine === "groq" ? groqKey : "";
      const hasActiveKey =
        llmEngine === "openai-compatible" ? (Boolean(env.openaiBaseUrl) || openaiCompatibleBaseUrl.trim().length > 0) :
          llmEngine === "claude" ? (env.hasAnthropicKey || activeKey.trim().length > 0) :
          llmEngine === "deepseek" ? (env.hasDeepseekKey || activeKey.trim().length > 0) :
            llmEngine === "gemini" ? (env.hasGeminiKey || activeKey.trim().length > 0) :
              llmEngine === "openai" ? (env.hasOpenaiKey || activeKey.trim().length > 0) :
                llmEngine === "openrouter" ? (env.hasOpenrouterKey || activeKey.trim().length > 0) :
                  llmEngine === "groq" ? (env.hasGroqKey || activeKey.trim().length > 0) : false;
      if (!hasActiveKey) {
        const engineName =
          llmEngine === "claude" ? "Claude" :
            llmEngine === "deepseek" ? "DeepSeek" :
              llmEngine === "gemini" ? "Gemini" :
                llmEngine === "openai" ? "OpenAI" :
                  llmEngine === "openai-compatible" ? "OpenAI-compatible" :
                    llmEngine === "openrouter" ? "OpenRouter" :
                      llmEngine === "groq" ? "Groq" : "LLM";
        setError(`Transcription complete. ${engineName} configuration is missing. Please add it in settings to analyze viral moments.`);
        return;
      }
    }

    // 1. Transcription
    try {
      setBusy("transcribe");
      await invoke<Transcript>("transcribe_project", {
        projectId,
        provider: transcriptionEngine,
        apiKey: transcriptionEngine === "deepgram" ? (deepgramKey.trim() || null) : null,
        whisperModel: transcriptionEngine === "local" ? whisperModel : null,
      });
      await refresh(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy("idle");
      return;
    }

    // 2. LLM Moments
    try {
      setBusy("moments");
      const activeKey =
        llmEngine === "claude" ? anthropicKey.trim() :
          llmEngine === "deepseek" ? deepseekKey.trim() :
            llmEngine === "gemini" ? geminiKey.trim() :
              llmEngine === "openai" ? openaiKey.trim() :
                llmEngine === "openai-compatible" ? openaiCompatibleKey.trim() :
                  llmEngine === "openrouter" ? openrouterKey.trim() :
                    llmEngine === "groq" ? groqKey.trim() : "";
      await invoke<Candidate[]>("generate_candidates", {
        projectId,
        apiKey: activeKey || null,
        provider: llmEngine,
        modelName: llmEngine === "local"
          ? localLlmModel.trim()
          : llmEngine === "deepseek"
            ? (deepseekModel.trim() || null)
            : llmEngine === "openrouter"
              ? (openrouterModel.trim() || null)
              : llmEngine === "openai-compatible"
                ? (openaiCompatibleModel.trim() || null)
                : null,
        baseUrl: llmEngine === "openai-compatible" ? (openaiCompatibleBaseUrl.trim() || null) : null,
        allowDemo: false,
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
  }

  async function renameProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const currentName = project.name || fileName(project.sourcePath);
    const newName = window.prompt("Rename Project:", currentName);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      await invoke("rename_project", { projectId, name: trimmed });
      await refresh(detail?.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteProject(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    const name = project.name || fileName(project.sourcePath);
    if (!window.confirm(`Are you sure you want to delete the project "${name}"?`)) return;

    try {
      await invoke("delete_project", { projectId });
      const nextActiveId = detail?.project.id === projectId ? null : detail?.project.id;
      await refresh(nextActiveId ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function selectProject(projectId: string) {
    await run("idle", async () => {
      const nextDetail = await invoke<ProjectDetail>("get_project_detail", { projectId });
      setDetail(nextDetail);
    });
  }

  async function transcribe() {
    if (!detail) return;
    await run("transcribe", async () => {
      await invoke<Transcript>("transcribe_project", {
        projectId: detail.project.id,
        provider: transcriptionEngine,
        apiKey: transcriptionEngine === "deepgram" ? (deepgramKey.trim() || null) : null,
        whisperModel: transcriptionEngine === "local" ? whisperModel : null,
      });
      await refresh(detail.project.id);
    });
  }

  async function moments(allowDemo: boolean) {
    if (!detail) return;
    await run("moments", async () => {
      const activeKey =
        llmEngine === "claude" ? anthropicKey.trim() :
          llmEngine === "deepseek" ? deepseekKey.trim() :
            llmEngine === "gemini" ? geminiKey.trim() :
              llmEngine === "openai" ? openaiKey.trim() :
                llmEngine === "openai-compatible" ? openaiCompatibleKey.trim() :
                  llmEngine === "openrouter" ? openrouterKey.trim() :
                    llmEngine === "groq" ? groqKey.trim() : "";
      try {
        await invoke<Candidate[]>("generate_candidates", {
          projectId: detail.project.id,
          apiKey: activeKey || null,
          provider: llmEngine,
          modelName: llmEngine === "local"
            ? localLlmModel.trim()
            : llmEngine === "deepseek"
              ? (deepseekModel.trim() || null)
              : llmEngine === "openrouter"
                ? (openrouterModel.trim() || null)
                : llmEngine === "openai-compatible"
                  ? (openaiCompatibleModel.trim() || null)
                  : null,
          baseUrl: llmEngine === "openai-compatible" ? (openaiCompatibleBaseUrl.trim() || null) : null,
          allowDemo,
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
        throw err;
      }
    });
  }

  async function updateClipCount(count: number) {
    if (!detail) return;
    await run("clipCount", async () => {
      const candidates = await invoke<Candidate[]>("set_selected_clip_count", {
        projectId: detail.project.id,
        count,
      });
      setDetail({ ...detail, candidates });
    });
  }

  async function cutCandidate(candidateId: string) {
    if (!detail) return;
    setRenderingCandidateId(candidateId);
    setBusy("cut");
    setError(null);
    try {
      await invoke<string>("render_flat_clip_for_candidate", { candidateId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingCandidateId(null);
      setBusy("idle");
      clearPipelineProgress("cut");
      await refresh(detail.project.id);
    }
  }

  function handleClipEditSaved(edit: ClipEdit) {
    setDetail((current) => {
      if (!current) return current;
      const existing = current.clipEdits ?? [];
      const hasEntry = existing.some((item) => item.candidateId === edit.candidateId);
      const clipEdits = hasEntry
        ? existing.map((item) => (item.candidateId === edit.candidateId ? edit : item))
        : [...existing, edit];
      return { ...current, clipEdits };
    });
  }

  /** Merge a bulk style write (`apply_caption_style_to_project`). */
  function handleBulkEditsSaved(edits: ClipEdit[]) {
    if (!Array.isArray(edits) || edits.length === 0) return;
    setDetail((current) => {
      if (!current) return current;
      const byId = new Map((current.clipEdits ?? []).map((item) => [item.candidateId, item]));
      edits.forEach((edit) => byId.set(edit.candidateId, edit));
      return { ...current, clipEdits: [...byId.values()] };
    });
  }

  /** Keep the card in sync after the cut window was widened or shortened. */
  function handleRangeChanged(updated: { id: string; startSec: number; endSec: number }) {
    setDetail((current) => {
      if (!current) return current;
      const candidates = current.candidates.map((item) =>
        item.id === updated.id
          ? { ...item, startSec: updated.startSec, endSec: updated.endSec }
          : item,
      );
      return { ...current, candidates };
    });
    // The backend drops the cached JPEG of the old window.
    setThumbVersion((version) => version + 1);
  }

  async function cutSelected() {
    if (!detail) return;
    setBusy("cut");
    setError(null);
    const queue = [...selectedCandidates];
    const failures: string[] = [];
    // Two concurrent renders: enough to hide ffmpeg startup/seek overhead
    // without starving the CPU-bound x264 encoder.
    const worker = async () => {
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (!candidate) break;
        setRenderingCandidateId(candidate.id);
        try {
          await invoke<string>("render_flat_clip_for_candidate", { candidateId: candidate.id });
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    };
    try {
      const workers = Math.min(2, queue.length);
      await Promise.all(Array.from({ length: workers }, () => worker()));
      if (failures.length > 0) {
        setError(failures.join("\n"));
      }
    } finally {
      setRenderingCandidateId(null);
      setBusy("idle");
      clearPipelineProgress("cut");
      await refresh(detail.project.id);
    }
  }

  if (isOnboarded === null) {
    return (
      <div className="onboarding-loading" style={{ display: 'grid', placeItems: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <Loader2 className="spin" size={32} color="var(--accent-primary)" />
      </div>
    );
  }

  if (isOnboarded === false) {
    return (
      <Onboarding
        environment={environment}
        onComplete={() => setIsOnboarded(true)}
        setTranscriptionEngine={setTranscriptionEngine}
        setLlmEngine={setLlmEngine}
        setLocalLlmModel={setLocalLlmModel}
        setDeepgramKey={setDeepgramKey}
        setAnthropicKey={setAnthropicKey}
        setDeepseekKey={setDeepseekKey}
        setGroqKey={setGroqKey}
        setOpenaiCompatibleKey={setOpenaiCompatibleKey}
        setOpenaiCompatibleBaseUrl={setOpenaiCompatibleBaseUrl}
        setOpenaiCompatibleModel={setOpenaiCompatibleModel}
        deepgramKey={deepgramKey}
        anthropicKey={anthropicKey}
        deepseekKey={deepseekKey}
        groqKey={groqKey}
        openaiCompatibleKey={openaiCompatibleKey}
        openaiCompatibleBaseUrl={openaiCompatibleBaseUrl}
        openaiCompatibleModel={openaiCompatibleModel}
        whisperModels={whisperModels}
        whisperModel={whisperModel}
        setWhisperModel={setWhisperModel}
        downloadWhisperModel={downloadWhisperModel}
        loadWhisperModels={loadWhisperModels}
        whisperDownload={whisperDownload}
        pythonEnv={pythonEnv}
        pythonInstall={pythonInstall}
        installPythonEnv={installPythonEnv}
        refreshEnv={() => refresh()}
      />
    );
  }

  return (
    <div className="app-shell-container">
      <main className="app-shell">
        <aside className="sidebar">
          <div
            className="brand-row"
            onClick={() => setDetail(null)}
            style={{ cursor: "pointer" }}
            title="Go to Home Dashboard"
          >
            <div className="brand-mark">
              <Clapperboard size={20} />
            </div>
            <div>
              <h1>AutoShorts</h1>
              <p>Long recording in. Short clips out.</p>
            </div>
          </div>

          <button className="primary-action" onClick={importMedia} disabled={busy !== "idle"}>
            {busy === "import" ? <Loader2 className="spin" size={18} /> : <FileVideo size={18} />}
            Import recording
          </button>
          <button 
            className="secondary-action" 
            onClick={() => setYoutubeModalOpen(true)} 
            disabled={busy !== "idle" || !environment?.hasYtdlp}
            title={!environment?.hasYtdlp ? "Please install yt-dlp to use this feature" : "Download a video from YouTube"}
            style={{ width: "100%", padding: "0.75rem", borderRadius: "10px", marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: "0.95rem" }}
          >
            <Youtube size={18} />
            Import from YouTube
          </button>

          <section className="project-list" aria-label="Projects">
            <button
              className={`project-row ${!detail ? "active" : ""}`}
              onClick={() => setDetail(null)}
            >
              <Clapperboard size={15} />
              <span>All Projects</span>
              <ChevronRight size={14} />
            </button>

            {projects.map((project) => (
              <button
                key={project.id}
                className={`project-row ${detail?.project.id === project.id ? "active" : ""}`}
                onClick={() => void selectProject(project.id)}
              >
                <FileVideo size={15} />
                <span>{project.name || fileName(project.sourcePath)}</span>
                <ChevronRight size={14} />
              </button>
            ))}
          </section>
        </aside>

        <section className="workspace">
          {detail ? (
            <>
              <header className="topbar">
                <div className="project-info">
                  <div className="eyebrow">{detail.project.status}</div>
                  <h2>{detail.project.name || fileName(detail.project.sourcePath)}</h2>
                </div>
                <div className="topbar-actions">
                  <button
                    className={`icon-button settings-toggle ${showSettings ? "active" : ""}`}
                    onClick={() => setShowSettings(!showSettings)}
                    title="API Settings"
                  >
                    <SlidersHorizontal size={16} />
                    <span>API Settings</span>
                  </button>
                  <button className="icon-button" onClick={() => void refresh(detail.project.id)} title="Refresh">
                    <RefreshCw size={18} />
                  </button>
                </div>
              </header>

              {showSettings && (
                <div className="settings-panel">
                  <div className="key-stack-horizontal">
                    <label>
                      <span>Transcription Engine</span>
                      <select
                        value={transcriptionEngine}
                        onChange={(event) => setTranscriptionEngine(event.target.value as "deepgram" | "local")}
                      >
                        <option value="local">Local Whisper (Offline)</option>
                        <option value="deepgram">Deepgram (Cloud)</option>
                      </select>
                      <span>LLM Engine</span>
                      <select
                        value={llmEngine}
                        onChange={(event) => setLlmEngine(event.target.value as any)}
                      >
                        <option value="local">Ollama (Offline Local)</option>
                        <option value="claude">Claude (Cloud)</option>
                        <option value="deepseek">DeepSeek (Cloud)</option>
                        <option value="gemini">Google Gemini (Cloud)</option>
                        <option value="openai">OpenAI (Cloud)</option>
                        <option value="openai-compatible">OpenAI-Compatible (Custom Base URL)</option>
                        <option value="openrouter">OpenRouter (Cloud)</option>
                        <option value="groq">Groq (Cloud)</option>
                      </select>
                    </label>
                    {transcriptionEngine === "deepgram" && (
                      <label>
                        <span>Deepgram API Key</span>
                        <input
                          value={deepgramKey}
                          onChange={(event) => setDeepgramKey(event.target.value)}
                          placeholder={environment?.hasDeepgramKey ? "Loaded from env" : "Optional (Deepgram API Key)"}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "claude" && (
                      <label>
                        <span>Claude API Key</span>
                        <input
                          value={anthropicKey}
                          onChange={(event) => setAnthropicKey(event.target.value)}
                          placeholder={environment?.hasAnthropicKey ? "Loaded from env" : "Optional (Claude API Key)"}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "deepseek" && (
                      <>
                        <label>
                          <span>DeepSeek API Key</span>
                          <input
                            value={deepseekKey}
                            onChange={(event) => setDeepseekKey(event.target.value)}
                            placeholder={environment?.hasDeepseekKey ? "Loaded from env" : "Optional (DeepSeek API Key)"}
                            type="password"
                          />
                        </label>
                        <label>
                          <span>DeepSeek Model</span>
                          <input
                            value={deepseekModel}
                            onChange={(event) => setDeepseekModel(event.target.value)}
                            placeholder="Optional (e.g. deepseek-chat, deepseek-v4-pro)"
                            type="text"
                          />
                        </label>
                      </>
                    )}
                    {llmEngine === "gemini" && (
                      <label>
                        <span>Gemini API Key</span>
                        <input
                          value={geminiKey}
                          onChange={(event) => setGeminiKey(event.target.value)}
                          placeholder={environment?.hasGeminiKey ? "Loaded from env" : "Optional (Gemini API Key)"}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "openai" && (
                      <label>
                        <span>OpenAI API Key</span>
                        <input
                          value={openaiKey}
                          onChange={(event) => setOpenaiKey(event.target.value)}
                          placeholder={environment?.hasOpenaiKey ? "Loaded from env" : "Optional (OpenAI API Key)"}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "openrouter" && (
                      <>
                        <label>
                          <span>OpenRouter API Key</span>
                          <input
                            value={openrouterKey}
                            onChange={(event) => setOpenrouterKey(event.target.value)}
                            placeholder={environment?.hasOpenrouterKey ? "Loaded from env" : "Optional (OpenRouter API Key)"}
                            type="password"
                          />
                        </label>
                        <label>
                          <span>OpenRouter Model</span>
                          <input
                            value={openrouterModel}
                            onChange={(event) => setOpenrouterModel(event.target.value)}
                            placeholder="Optional (e.g. google/gemini-2.5-flash, deepseek/deepseek-r1)"
                            type="text"
                          />
                        </label>
                      </>
                    )}
                    {llmEngine === "groq" && (
                      <label>
                        <span>Groq API Key</span>
                        <input
                          value={groqKey}
                          onChange={(event) => setGroqKey(event.target.value)}
                          placeholder={environment?.hasGroqKey ? "Loaded from env" : "Optional (Groq API Key)"}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "openai-compatible" && (
                      <>
                        <label>
                          <span>Base URL</span>
                          <input
                            value={openaiCompatibleBaseUrl}
                            onChange={(event) => setOpenaiCompatibleBaseUrl(event.target.value)}
                            placeholder={environment?.openaiBaseUrl || "e.g. http://localhost:1234/v1"}
                            type="text"
                          />
                        </label>
                        <label>
                          <span>Model Name</span>
                          <input
                            value={openaiCompatibleModel}
                            onChange={(event) => setOpenaiCompatibleModel(event.target.value)}
                            placeholder="e.g. qwen2.5-7b-instruct, llama-3.1-8b"
                            type="text"
                          />
                        </label>
                        <label>
                          <span>API Key (optional)</span>
                          <input
                            value={openaiCompatibleKey}
                            onChange={(event) => setOpenaiCompatibleKey(event.target.value)}
                            placeholder={environment?.hasOpenaiCompatibleKey ? "Loaded from env" : "Optional (leave empty for local servers)"}
                            type="password"
                          />
                        </label>
                      </>
                    )}

                    {llmEngine === "local" && (
                      <label>
                        <span>Ollama Model Name</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            value={localLlmModel}
                            onChange={(event) => setLocalLlmModel(event.target.value)}
                            placeholder="e.g. llama3.2, qwen2.5:7b"
                            type="text"
                          />
                          <button
                            type="button"
                            className="icon-button"
                            style={{ minHeight: '36px', height: '36px' }}
                            onClick={() => pullModelDirectly(localLlmModel)}
                          >
                            <Download size={14} /> Pull
                          </button>
                        </div>
                      </label>
                    )}
                  </div>
                  {transcriptionEngine === "local" && (
                    <div className="settings-whisper">
                      <PythonEnvCard
                        status={pythonEnv}
                        installing={pythonInstall}
                        onInstall={installPythonEnv}
                      />
                      <WhisperModelList
                        models={whisperModels}
                        selected={whisperModel}
                        onSelect={setWhisperModel}
                        onDownload={downloadWhisperModel}
                        onRefresh={loadWhisperModels}
                        downloading={whisperDownload}
                        disabled={!environment?.hasLocalWhisperModel}
                      />
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    <button
                      type="button"
                      className="icon-button"
                      style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                      onClick={() => {
                        if (window.confirm("Are you sure you want to reset your configuration and restart onboarding from scratch?")) {
                          localStorage.clear();
                          window.location.reload();
                        }
                      }}
                    >
                      Reset App Configuration & Onboarding
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}

              <div className="pipeline-strip">
                <PipelineStep icon={<AudioLines size={16} />} label="Transcript" done={Boolean(detail.transcript)} />
                <PipelineStep icon={<Sparkles size={16} />} label="Moments" done={detail.candidates.length > 0} />
                <PipelineStep icon={<Scissors size={16} />} label="Cut" done={selectedCount > 0 && selectedCutCount === selectedCount} />
                <PipelineStep icon={<Captions size={16} />} label="Captions" done={selectedCount > 0 && selectedCaptionsCount === selectedCount} />
                <PipelineStep icon={<Download size={16} />} label="Export" done={selectedCount > 0 && selectedCutCount === selectedCount} />
              </div>

              <div className="work-grid">
                <section className="panel transcript-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Transcript</h3>
                      <p>{transcript ? `${transcript.segments.length} segments` : "No transcript"}</p>
                    </div>
                    <div className="button-pair">
                      <button onClick={transcribe} disabled={busy !== "idle" || !canTranscribe}>
                        {busy === "transcribe" ? <Loader2 className="spin" size={16} /> : <AudioLines size={16} />}
                        Transcribe
                      </button>
                    </div>
                  </div>

                  {!canTranscribe && (
                    <div className="api-warning">
                      {transcriptionEngine === "local"
                        ? `⚠️ Local Whisper (pacote Python 'openai-whisper') não está instalado. Abra as configurações e clique em "Instalar Whisper".`
                        : "⚠️ Deepgram API Key is missing. Transcribing will not work. Please add your key in API Settings."}
                    </div>
                  )}

                  <div className="transcript-list">
                    {transcript?.segments.map((segment, index) => (
                      <article key={`${segment.start}-${index}`} className="segment-row">
                        <span>{formatTime(segment.start)}</span>
                        <p>{segment.text}</p>
                      </article>
                    )) ?? <EmptyState icon={<AudioLines size={28} />} label="Transcript pending" />}
                  </div>
                </section>

                <section className="panel candidate-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Clip Candidates</h3>
                      <p>{detail.candidates.length ? `${selectedCount} selected` : "No candidates"}</p>
                    </div>
                    <div className="button-pair">
                      <button onClick={cutSelected} disabled={busy !== "idle" || selectedCount === 0 || !environment?.hasFfmpeg}>
                        {busy === "cut" ? <Loader2 className="spin" size={16} /> : <Scissors size={16} />}
                        Cut
                      </button>
                      <button onClick={() => void moments(false)} disabled={busy !== "idle" || !detail.transcript || !canUseActiveLlm}>
                        {busy === "moments" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                        Find Viral Moments
                      </button>
                    </div>
                  </div>

                  {!canUseActiveLlm && (
                    <div className="api-warning">
                      {llmEngine === "local"
                        ? "⚠️ Ollama local server is not running at http://localhost:11434. Moment detection will not work."
                        : llmEngine === "openai-compatible"
                          ? "⚠️ Base URL is missing. Viral moment identification will not work. Please add the endpoint URL in API Settings."
                          : `⚠️ ${llmEngine === "claude" ? "Claude" :
                            llmEngine === "deepseek" ? "DeepSeek" :
                              llmEngine === "gemini" ? "Gemini" :
                                llmEngine === "openai" ? "OpenAI" :
                                  llmEngine === "openrouter" ? "OpenRouter" :
                                    llmEngine === "groq" ? "Groq" : "LLM"
                          } API Key is missing. Viral moment identification will not work. Please add your key in API Settings.`}
                    </div>
                  )}

                  {detail.candidates.length > 0 && (
                    <div className="clip-control">
                      <SlidersHorizontal size={17} />
                      <input
                        type="range"
                        min="0"
                        max={detail.candidates.length}
                        value={selectedCount}
                        onChange={(event) => void updateClipCount(Number(event.target.value))}
                      />
                      <strong>{selectedCount}</strong>
                    </div>
                  )}

                  <div className="candidate-list">
                    {detail.candidates.map((candidate) => {
                      const clip = clipByCandidate.get(candidate.id);
                      const isCut = clip?.status === "done" && Boolean(clip.outputPath);
                      const clipEdit = clipEditByCandidate.get(candidate.id);
                      return (
                        <article key={candidate.id} className={`candidate-card ${candidate.selected ? "selected" : ""}`}>
                          {/* 9:16 portrait preview: thumbnail of the moment, cut badge on top */}
                          <div className="portrait-preview-container">
                            <div className="portrait-preview-mock">
                              {thumbnails[candidate.id] ? (
                                <img
                                  className="mock-thumb"
                                  src={thumbnails[candidate.id]}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : null}
                              {isCut ? (
                                <div className="mock-video-active">
                                  <Play size={20} className="play-icon-mock" />
                                </div>
                              ) : !thumbnails[candidate.id] ? (
                                <div className="mock-video-inactive">
                                  <span>9:16</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="candidate-rank">
                              <span>#{candidate.rank}</span>
                              {candidate.selected && <Check size={14} />}
                            </div>
                          </div>

                          <div className="candidate-body">
                            <div className="candidate-meta">
                              <span>{formatTime(candidate.startSec)} - {formatTime(candidate.endSec)}</span>
                              <span className="candidate-score">{Math.round(candidate.score * 100)}% Match</span>
                            </div>
                            {clipEdit && (
                              <span className="clip-edit-badge">
                                {normalizeAspect(clipEdit.aspectRatio)} · {clipEdit.captionStyle ?? "modern-box"}
                              </span>
                            )}
                            <h4>{candidate.hook}</h4>
                            <p className="candidate-rationale">{candidate.rationale}</p>

                            <div className="candidate-actions">
                              <span className={`clip-status ${isCut ? "ready" : clip?.status === "error" ? "error" : ""}`}>
                                {isCut ? "Cut ready" : clip?.status === "error" ? "Cut failed" : clip?.status ?? "Pending"}
                              </span>
                              <button
                                className="edit-clip-button"
                                onClick={() => setEditingCandidateId(candidate.id)}
                                disabled={busy !== "idle"}
                                title="Preview the cut, choose the crop and edit captions"
                              >
                                <Crop size={14} />
                                Edit clip
                              </button>
                              <button
                                className="cut-button"
                                onClick={() => void cutCandidate(candidate.id)}
                                disabled={busy !== "idle" || !environment?.hasFfmpeg}
                              >
                                {renderingCandidateId === candidate.id ? (
                                  <Loader2 className="spin" size={14} />
                                ) : (
                                  <Scissors size={14} />
                                )}
                                {renderingCandidateId === candidate.id ? "Cutting..." : isCut ? "Re-cut" : "Cut"}
                              </button>
                            </div>
                            {clip?.outputPath && <div className="output-path">{clip.outputPath}</div>}
                            {clip?.captionAssPath && (
                              <div className="output-path" style={{ background: "rgba(142, 230, 199, 0.05)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)", marginTop: "4px" }}>
                                Subtitles: {clip.captionAssPath}
                              </div>
                            )}
                            {clip?.renderLog && <div className="render-log">{clip.renderLog}</div>}
                          </div>
                        </article>
                      );
                    })}
                    {detail.candidates.length === 0 && <EmptyState icon={<Sparkles size={28} />} label="Moments pending" />}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="home-dashboard">
              <header className="home-header">
                <div>
                  <h2>All Projects</h2>
                  <p>Select a project below or import a new media file to get started.</p>
                </div>
                <button className="primary-action compact" onClick={importMedia} disabled={busy !== "idle"}>
                  {busy === "import" ? <Loader2 className="spin" size={18} /> : <FileVideo size={18} />}
                  Import recording
                </button>
                <button 
                  className="secondary-action compact" 
                  onClick={() => setYoutubeModalOpen(true)} 
                  disabled={busy !== "idle" || !environment?.hasYtdlp}
                  title={!environment?.hasYtdlp ? "Please install yt-dlp to use this feature" : "Download a video from YouTube"}
                  style={{ display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", cursor: "pointer", fontSize: "0.95rem", marginLeft: "1rem" }}
                >
                  <Youtube size={18} />
                  Import from YouTube
                </button>
              </header>

              {projects.length > 0 ? (
                <div className="projects-grid">
                  {projects.map((project) => {
                    const name = project.name || fileName(project.sourcePath);
                    return (
                      <article key={project.id} className="project-card">
                        <div className="project-card-header">
                          <FileVideo size={24} className="project-card-icon" />
                          <span className="project-card-status">{project.status}</span>
                        </div>
                        <h3 className="project-card-title">{name}</h3>
                        <div className="project-card-meta">
                          <span>Duration: {project.sourceDuration ? formatTime(project.sourceDuration) : "Probing..."}</span>
                          <span>Created: {new Date(project.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="project-card-actions">
                          <button className="action-btn open-btn" onClick={() => void selectProject(project.id)}>
                            Open
                          </button>
                          <button className="action-btn rename-btn" onClick={() => void renameProject(project.id)}>
                            Rename
                          </button>
                          <button className="action-btn delete-btn" onClick={() => void deleteProject(project.id)}>
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-dashboard-state">
                  <Clapperboard size={48} className="empty-state-icon" />
                  <h3>No projects found</h3>
                  <p>Import your first recording to begin creating shorts.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="status-bar">
        <div className="status-bar-left">
          {pipelineProgress ? (
            <div className={`pipeline-progress stage-${pipelineProgress.stage}`}>
              <span className="pipeline-progress-label">
                <Loader2 size={11} className="spin" />
                {pipelineProgress.label}
                {pipelineProgress.percentage !== null && (
                  <span className="pipeline-progress-value">
                    {Math.round(pipelineProgress.percentage)}%
                  </span>
                )}
              </span>
              <div
                className={`pipeline-progress-track ${
                  pipelineProgress.percentage === null ? "indeterminate" : ""
                }`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  pipelineProgress.percentage === null
                    ? undefined
                    : Math.round(pipelineProgress.percentage)
                }
                aria-label={pipelineProgress.label}
              >
                <div
                  className="pipeline-progress-fill"
                  style={
                    pipelineProgress.percentage === null
                      ? undefined
                      : { width: `${Math.max(2, Math.min(100, pipelineProgress.percentage))}%` }
                  }
                />
              </div>
            </div>
          ) : (
            <span className="app-status-indicator">System Ready</span>
          )}
        </div>
        <div className="status-bar-right">
          <div className="status-indicators">
            <span className={`indicator ${environment?.hasFfmpeg ? "active" : ""}`} title="FFmpeg status">ffmpeg</span>
            <span className={`indicator ${environment?.hasFfprobe ? "active" : ""}`} title="FFprobe status">ffprobe</span>
            <span className={`indicator ${environment?.hasYtdlp ? "active" : ""}`} title="yt-dlp status">yt-dlp</span>
            <span className={`indicator ${environment?.hasLocalWhisperModel ? "active" : ""}`} title="Whisper installation status">Whisper</span>
            <span className={`indicator ${environment?.hasOllama ? "active" : ""}`} title="Ollama status">Ollama</span>
            <span
              className={`indicator ${environment?.gpuAccel ? "active" : ""}`}
              title={
                environment?.gpuAccel
                  ? `GPU acceleration enabled: ${environment.videoEncoder}`
                  : `GPU acceleration unavailable, using ${environment?.videoEncoder ?? "CPU"}`
              }
            >
              {environment?.gpuAccel
                ? `GPU: ${formatEncoderLabel(environment.videoEncoder)}`
                : "GPU off"}
            </span>
            <span className={`indicator ${canUseCloudKey ? "active" : ""}`} title="Deepgram Key status">Deepgram</span>
            <span className={`indicator ${canUseClaude ? "active" : ""}`} title="Claude Key status">Claude</span>
            <span className={`indicator ${canUseDeepseek ? "active" : ""}`} title="DeepSeek Key status">DeepSeek</span>
          </div>
        </div>
      </footer>

      {showStyleModal && (
        <div className="style-modal-overlay">
          <div className="style-modal">
            <div className="style-modal-header">
              <h3>Choose Caption Style</h3>
              <p>Select how your automated captions should look on the portrait short-form video clips.</p>
            </div>

            <div className="style-grid">
              <div
                className={`style-card ${selectedStyle === "modern-box" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("modern-box")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-box">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Modern Box</div>
                <div className="style-card-desc">Sleek white text inside a semi-transparent black background padding box. Highly readable.</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "classic-outline" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("classic-outline")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-outline">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Classic Outline</div>
                <div className="style-card-desc">Vibrant bold yellow text with a clean black outline. High-energy CapCut formatting.</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "minimal-shadow" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("minimal-shadow")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-shadow">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Minimal Shadow</div>
                <div className="style-card-desc">Pure white text with a soft, elegant drop shadow. Unobtrusive and modern.</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-cyan" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-cyan")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-cyan">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Vibrant Cyan</div>
                <div className="style-card-desc">Vibrant tech cyan text with a black drop shadow for a clean look.</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-yellow-box" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-yellow-box")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-yellow-box">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Vibrant Yellow Box</div>
                <div className="style-card-desc">Bold black text inside a solid yellow padding box. Punchy and high visibility.</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-green" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-green")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-green">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Vibrant Green</div>
                <div className="style-card-desc">High-energy neon green text with black borders and a drop shadow (Hormozi style).</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-red" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-red")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-red">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">Vibrant Red</div>
                <div className="style-card-desc">Dramatic neon crimson text with outline and drop shadow (gaming/action style).</div>
              </div>
            </div>

            <div className="style-modal-actions">
              <button className="btn-cancel" onClick={() => { setShowStyleModal(false); setMediaPathToImport(null); }}>
                Cancel
              </button>
              <button className="btn-confirm" onClick={() => confirmImport(selectedStyle)}>
                Confirm & Import
              </button>
            </div>
          </div>
        </div>
      )}
      {downloadingModelName && (
        <div className="onboarding-overlay" style={{ zIndex: 20000 }}>
          <div className="onboarding-card" style={{ maxWidth: '480px', textAlign: 'center' }}>
            <div className="onboarding-header compact" style={{ textAlign: 'center' }}>
              <h2>Downloading Ollama Model</h2>
              <p>Downloading model weights for "{downloadingModelName}". Please do not close the app.</p>
            </div>

            <div className="download-progress-container">
              <div className="download-loader">
                <Loader2 className="spin" size={48} />
              </div>

              <div className="progress-bar-container">
                <div className="progress-bar-fill" style={{ width: `${modelDownloadProgress}%` }}></div>
              </div>

              <div className="download-stats">
                <span className="download-status">{modelDownloadStatus}</span>
                <span className="download-percentage">{modelDownloadProgress}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {youtubeModalOpen && (
        <div className="style-modal-overlay">
          <div className="style-modal" style={{ maxWidth: "500px" }}>
            <div className="style-modal-header">
              <h3>Import from YouTube</h3>
              <p>Paste a YouTube URL below to download and import it directly.</p>
            </div>
            <div style={{ padding: "1rem" }}>
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                disabled={youtubeStatus !== "idle" && youtubeStatus !== "warning"}
                style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)", fontSize: "1rem", marginBottom: "1rem" }}
              />

              {youtubeStatus === "warning" && (
                <div style={{ background: "rgba(255, 165, 0, 0.1)", border: "1px solid orange", padding: "1rem", borderRadius: "8px", marginBottom: "1rem", color: "orange" }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", fontWeight: "bold" }}>
                    <AlertTriangle size={20} />
                    Copyright Warning
                  </div>
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>
                    This video is not explicitly marked for reuse (Creative Commons). Its license appears to be: <strong>{youtubeWarningLicense}</strong>.
                    <br/><br/>
                    Clipping this video may lead to copyright strikes. Are you sure you want to proceed?
                  </p>
                </div>
              )}

              <div className="style-modal-actions" style={{ marginTop: "1rem" }}>
                <button 
                  className="btn-cancel" 
                  onClick={() => { setYoutubeModalOpen(false); setYoutubeUrl(""); setYoutubeStatus("idle"); }}
                  disabled={youtubeStatus === "checking" || youtubeStatus === "downloading"}
                >
                  Cancel
                </button>
                {youtubeStatus === "warning" ? (
                  <button className="btn-confirm" onClick={executeYoutubeDownload}>
                    Yes, I understand the risks
                  </button>
                ) : (
                  <button 
                    className="btn-confirm" 
                    onClick={handleYoutubeImport}
                    disabled={!youtubeUrl || youtubeStatus !== "idle"}
                    style={{ minWidth: "120px" }}
                  >
                    {youtubeStatus === "checking" ? <><Loader2 className="spin" size={18} /> Checking...</> :
                     youtubeStatus === "downloading" ? <><Loader2 className="spin" size={18} /> Downloading...</> : 
                     "Check & Download"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingCandidateId && (
        <ClipEditor
          candidateId={editingCandidateId}
          onClose={() => setEditingCandidateId(null)}
          onSaved={handleClipEditSaved}
          onBulkSaved={handleBulkEditsSaved}
          onRangeChanged={handleRangeChanged}
          onRender={() => {
            const candidateId = editingCandidateId;
            if (candidateId) void cutCandidate(candidateId);
          }}
        />
      )}
    </div>
  );
}

// Local Whisper needs a Python package (~1-2 GB with PyTorch). The app owns a
// virtualenv under its data dir and installs into it, so no manual pip step is
// required after installing AutoShorts.
function PythonEnvCard({
  status,
  installing,
  onInstall,
}: {
  status: PythonEnvStatus | null;
  installing: PythonInstallState | null;
  onInstall: () => Promise<void>;
}) {
  const busy = Boolean(installing);
  const ready = Boolean(status?.ready);

  return (
    <div className={`python-env-card ${ready ? "ready" : ""}`}>
      <div className="python-env-head">
        <div>
          <strong>Python / Whisper</strong>
          <p>
            {ready
              ? "Ambiente gerenciado pronto — transcrição local habilitada."
              : "Instala o openai-whisper em um ambiente isolado do app."}
          </p>
        </div>
        {ready ? (
          <span className="python-env-badge ready">
            <BadgeCheck size={13} /> Pronto
          </span>
        ) : (
          <button type="button" className="python-env-btn" disabled={busy} onClick={() => void onInstall()}>
            {busy ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
            {busy ? "Instalando…" : "Instalar Whisper"}
          </button>
        )}
      </div>

      {installing && (
        <div className="python-env-progress">
          <div className="python-env-progress-bar">
            <div style={{ width: `${Math.min(100, Math.max(0, installing.percentage))}%` }} />
          </div>
          <span className="python-env-status">{installing.status}</span>
        </div>
      )}

      {!ready && !busy && !status?.systemPython && (
        <p className="whisper-hint">
          ⚠️ Python 3 não encontrado. Instale o Python (python.org no Windows,{" "}
          <code>sudo apt install python3 python3-venv</code> no Debian/Ubuntu) e recarregue o app.
        </p>
      )}

      {status?.venvDir && (
        <p className="python-env-path" title={status.venvDir}>
          {status.venvDir}
        </p>
      )}
    </div>
  );
}

function WhisperModelList({
  models,
  selected,
  onSelect,
  onDownload,
  onRefresh,
  downloading,
  disabled,
}: {
  models: WhisperModelInfo[];
  selected: string;
  onSelect: (modelId: string) => void;
  onDownload: (modelId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  downloading: WhisperDownloadState | null;
  disabled?: boolean;
}) {
  return (
    <div className="whisper-models">
      <div className="whisper-models-header">
        <span>Whisper Model</span>        <button type="button" className="whisper-refresh" onClick={() => void onRefresh()}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="whisper-model-list">
        {models.length === 0 && (
          <p className="whisper-empty">No Whisper models detected. Click Refresh to rescan the local cache.</p>
        )}
        {models.map((model) => {
          const isDownloading = downloading?.model === model.id;
          return (
            <div key={model.id} className={`whisper-model-row ${selected === model.id ? "active" : ""}`}>
              <label className="whisper-model-label">
                <input
                  type="radio"
                  name="whisper-model"
                  checked={selected === model.id}
                  onChange={() => onSelect(model.id)}
                />
                <span className="whisper-model-name">{model.label}</span>
                <span className="whisper-model-size">{formatModelSize(model.sizeMb)}</span>
              </label>
              <div className="whisper-model-action">
                {model.downloaded ? (
                  <span className="whisper-model-status downloaded">
                    <BadgeCheck size={13} /> Downloaded
                  </span>
                ) : isDownloading ? (
                  <span className="whisper-model-status">
                    <Loader2 className="spin" size={13} /> {downloading?.percentage ?? 0}%
                  </span>
                ) : (
                  <button
                    type="button"
                    className="whisper-download-btn"
                    disabled={disabled || Boolean(downloading)}
                    title={disabled ? "Install the Python 'whisper' package first" : `Download the ${model.label} model`}
                    onClick={() => void onDownload(model.id)}
                  >
                    <Download size={13} /> Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {downloading && (
        <div className="whisper-download-progress">
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${downloading.percentage}%` }} />
          </div>
          <div className="download-stats">
            <span className="download-status">{downloading.status}</span>
            <span className="download-percentage">{downloading.percentage}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface OnboardingProps {
  environment: EnvironmentStatus | null;
  onComplete: () => void;  setTranscriptionEngine: (engine: "deepgram" | "local") => void;
  setLlmEngine: (engine: "claude" | "deepseek" | "local" | "groq" | "openai-compatible") => void;
  setLocalLlmModel: (model: string) => void;
  setDeepgramKey: (key: string) => void;
  setAnthropicKey: (key: string) => void;
  setDeepseekKey: (key: string) => void;
  setGroqKey: (key: string) => void;
  setOpenaiCompatibleKey: (key: string) => void;
  setOpenaiCompatibleBaseUrl: (url: string) => void;
  setOpenaiCompatibleModel: (model: string) => void;
  deepgramKey: string;
  anthropicKey: string;
  deepseekKey: string;
  groqKey: string;
  openaiCompatibleKey: string;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleModel: string;
  whisperModels: WhisperModelInfo[];
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  downloadWhisperModel: (modelId: string) => Promise<void>;
  loadWhisperModels: () => Promise<void>;
  whisperDownload: WhisperDownloadState | null;
  pythonEnv: PythonEnvStatus | null;
  pythonInstall: PythonInstallState | null;
  installPythonEnv: () => Promise<void>;
  refreshEnv: () => Promise<void>;
}
function Onboarding({
  environment,
  onComplete,
  setTranscriptionEngine,
  setLlmEngine,
  setLocalLlmModel,
  setDeepgramKey,
  setAnthropicKey,
  setDeepseekKey,
  setGroqKey,
  setOpenaiCompatibleKey,
  setOpenaiCompatibleBaseUrl,
  setOpenaiCompatibleModel,
  whisperModels,
  whisperModel,
  setWhisperModel,
  downloadWhisperModel,
  loadWhisperModels,
  whisperDownload,
  pythonEnv,
  pythonInstall,
  installPythonEnv,
  deepgramKey: initialDeepgramKey,
  anthropicKey: initialAnthropicKey,
  deepseekKey: initialDeepseekKey,
  groqKey: initialGroqKey,
  openaiCompatibleKey: initialOpenaiCompatibleKey,
  openaiCompatibleBaseUrl: initialOpenaiCompatibleBaseUrl,
  openaiCompatibleModel: initialOpenaiCompatibleModel,
  refreshEnv,
}: OnboardingProps) {
  const [setupMode, setSetupMode] = useState<"choose" | "local" | "cloud" | "downloading">("choose");
  const [selectedModel, setSelectedModel] = useState<string>("llama3.2");

  const [dgKey, setDgKey] = useState(initialDeepgramKey);
  const [antKey, setAntKey] = useState(initialAnthropicKey);
  const [dsKey, setDsKey] = useState(initialDeepseekKey);
  const [grKey, setGrKey] = useState(initialGroqKey);
  const [compatKey, setCompatKey] = useState(initialOpenaiCompatibleKey);
  const [compatBaseUrl, setCompatBaseUrl] = useState(initialOpenaiCompatibleBaseUrl);
  const [compatModel, setCompatModel] = useState(initialOpenaiCompatibleModel);
  // Cloud LLM keys are independent from the transcription backend.
  const [cloudTranscription, setCloudTranscription] = useState<"deepgram" | "local">(() => {
    return localStorage.getItem("autoshorts_transcription_engine") === "local" ? "local" : "deepgram";
  });

  const [downloadStatus, setDownloadStatus] = useState("Initializing download...");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checkingOllama, setCheckingOllama] = useState(false);

  const handleCloudSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cloudTranscription === "deepgram" && !dgKey.trim()) {
      setError("Deepgram API Key is required when transcription runs on Deepgram. Pick Local Whisper or paste a key.");
      return;
    }
    const hasCustomEndpoint = compatBaseUrl.trim().length > 0;
    if (!antKey.trim() && !dsKey.trim() && !grKey.trim() && !hasCustomEndpoint) {
      setError("Please provide at least one LLM credential: Claude, DeepSeek, Groq, or a custom OpenAI-compatible endpoint.");
      return;
    }

    setTranscriptionEngine(cloudTranscription);
    localStorage.setItem("autoshorts_transcription_engine", cloudTranscription);
    if (cloudTranscription === "deepgram") {
      setDeepgramKey(dgKey.trim());
      localStorage.setItem("autoshorts_deepgram_key", dgKey.trim());
    }

    if (hasCustomEndpoint) {
      setLlmEngine("openai-compatible");
      setOpenaiCompatibleBaseUrl(compatBaseUrl.trim());
      setOpenaiCompatibleModel(compatModel.trim());
      setOpenaiCompatibleKey(compatKey.trim());
      localStorage.setItem("autoshorts_openai_compatible_base_url", compatBaseUrl.trim());
      localStorage.setItem("autoshorts_openai_compatible_model", compatModel.trim());
      localStorage.setItem("autoshorts_openai_compatible_key", compatKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "openai-compatible");
    } else if (antKey.trim()) {
      setLlmEngine("claude");
      setAnthropicKey(antKey.trim());
      localStorage.setItem("autoshorts_anthropic_key", antKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "claude");
    } else if (dsKey.trim()) {
      setLlmEngine("deepseek");
      setDeepseekKey(dsKey.trim());
      localStorage.setItem("autoshorts_deepseek_key", dsKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "deepseek");
    } else if (grKey.trim()) {
      setLlmEngine("groq");
      setGroqKey(grKey.trim());
      localStorage.setItem("autoshorts_groq_key", grKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "groq");
    }

    localStorage.setItem("autoshorts_onboarded", "true");
    onComplete();
  };

  const startLocalSetup = async () => {
    setError(null);
    setCheckingOllama(true);
    setDownloadProgress(0);

    await refreshEnv();

    let isOllamaRunning = false;
    try {
      const currentEnv = await invoke<EnvironmentStatus>("environment_status");
      isOllamaRunning = currentEnv.hasOllama;
    } catch (e) {
      // ignore
    }

    setCheckingOllama(false);

    if (!isOllamaRunning) {
      setSetupMode("downloading");
      setDownloadStatus("Ollama not found. Starting automatic installer...");

      try {
        const unlistenInstall = await listen<string>("ollama-install-status", (event) => {
          setDownloadStatus(event.payload);
        });

        await invoke("install_ollama");
        unlistenInstall();
      } catch (err) {
        setError("Automatic installation failed: " + String(err) + ". Please install it manually from ollama.com.");
        setSetupMode("local");
        return;
      }
    }

    setSetupMode("downloading");
    setDownloadStatus("Ollama connected. Initiating model download...");

    try {
      const unlisten = await listen<{
        status: string;
        completed?: number;
        total?: number;
        percentage?: number;
      }>("ollama-pull-progress", (event) => {
        const payload = event.payload;
        setDownloadStatus(payload.status);
        if (payload.percentage !== undefined && payload.percentage !== null) {
          setDownloadProgress(Math.round(payload.percentage));
        }
      });

      await invoke("pull_ollama_model", { modelName: selectedModel });

      unlisten();

      setTranscriptionEngine("local");
      setLlmEngine("local");
      setLocalLlmModel(selectedModel);

      localStorage.setItem("autoshorts_transcription_engine", "local");
      localStorage.setItem("autoshorts_llm_engine", "local");
      localStorage.setItem("autoshorts_local_llm_model", selectedModel);
      localStorage.setItem("autoshorts_onboarded", "true");

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSetupMode("local");
    }
  };

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {setupMode === "choose" && (
          <>
            <div className="onboarding-header">
              <div className="brand-mark large">
                <Clapperboard size={36} />
              </div>
              <h2>Welcome to AutoShorts</h2>
              <p>Long recording in. Short clips out. Select how you would like to run the studio.</p>
            </div>

            <div className="onboarding-choices">
              <div className="choice-card clickable" onClick={() => setSetupMode("local")}>
                <div className="choice-icon">
                  <Database size={28} />
                </div>
                <h3>Fully Offline & Private</h3>
                <p>Process everything locally on your computer. Private, secure, and completely free.</p>
                <div className="choice-badge local">Offline (Ollama)</div>
              </div>

              <div className="choice-card clickable" onClick={() => setSetupMode("cloud")}>
                <div className="choice-icon">
                  <Cloud size={28} />
                </div>
                <h3>Cloud APIs</h3>
                <p>Use a cloud LLM (or your own [OI]-compatible endpoint) for moment detection, with Deepgram or Local Whisper for transcription.</p>
                <div className="choice-badge cloud">API Keys Required</div>
              </div>
            </div>
          </>
        )}

        {setupMode === "local" && (
          <div className="local-setup-flow">
            <div className="onboarding-header compact">
              <h2>Configure Offline Mode</h2>
              <p>Follow these steps to set up your local studio.</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="setup-steps">
              <div className="setup-step">
                <div className="step-num">1</div>
                <div className="step-body">
                  <h4>Instalar Whisper</h4>
                  <p>O AutoShorts baixa o <code>openai-whisper</code> em um ambiente Python isolado.</p>
                  <PythonEnvCard
                    status={pythonEnv}
                    installing={pythonInstall}
                    onInstall={installPythonEnv}
                  />
                  {environment?.hasLocalWhisperModel ? (
                    <span className="step-check success"><BadgeCheck size={14} /> Whisper instalado!</span>
                  ) : (
                    <span className="step-check warning">⚠️ Pacote Python 'whisper' ainda não detectado.</span>
                  )}

                  <div style={{ marginTop: "16px" }}>
                    <WhisperModelList
                      models={whisperModels}
                      selected={whisperModel}
                      onSelect={setWhisperModel}
                      onDownload={downloadWhisperModel}
                      onRefresh={loadWhisperModels}
                      downloading={whisperDownload}
                      disabled={!environment?.hasLocalWhisperModel}
                    />
                  </div>
                </div>
              </div>

              <div className="setup-step">
                <div className="step-num">2</div>
                <div className="step-body">
                  <h4>Set up local LLM (Ollama)</h4>
                  <p>
                    Ollama must be installed and running on your machine.
                    If you don't have it installed, you can download it from <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}>ollama.com</a>.
                  </p>
                  <p>Select a model to download:</p>

                  <div className="model-cards">
                    <div
                      className={`model-card ${selectedModel === "llama3.2" ? "active" : ""}`}
                      onClick={() => setSelectedModel("llama3.2")}
                    >
                      <div className="model-card-header">
                        <h5>LLaMA 3.2 3B</h5>
                        <span className="model-size">1.9 GB</span>
                      </div>
                      <p>Requires 8GB+ RAM. Recommended for standard setups. Fast and efficient.</p>
                    </div>

                    <div
                      className={`model-card ${selectedModel === "qwen2.5:3b" ? "active" : ""}`}
                      onClick={() => setSelectedModel("qwen2.5:3b")}
                    >
                      <div className="model-card-header">
                        <h5>Qwen 2.5 3B</h5>
                        <span className="model-size">2.0 GB</span>
                      </div>
                      <p>Requires 8GB+ RAM. Excellent coding and logical reasoning abilities.</p>
                    </div>

                    <div
                      className={`model-card ${selectedModel === "qwen2.5:7b" ? "active" : ""}`}
                      onClick={() => setSelectedModel("qwen2.5:7b")}
                    >
                      <div className="model-card-header">
                        <h5>Qwen 2.5 7B</h5>
                        <span className="model-size">4.7 GB</span>
                      </div>
                      <p>Requires 16GB+ RAM. High-quality moment detection and hook precision.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={() => setSetupMode("choose")}>Back</button>
              <button
                type="button"
                className="primary-action compact"
                onClick={startLocalSetup}
                disabled={checkingOllama}
              >
                {checkingOllama ? <Loader2 className="spin" size={18} /> : null}
                {checkingOllama ? "Checking Ollama..." : "Download & Start Setup"}
              </button>
            </div>
          </div>
        )}

        {setupMode === "cloud" && (
          <form className="cloud-setup-flow" onSubmit={handleCloudSubmit}>
            <div className="onboarding-header compact">
              <h2>Configure Cloud APIs</h2>
              <p>Pick where transcription runs, then add the LLM key used to find viral moments.</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="form-stack">
              <div className="input-group">
                <label>Transcription Source</label>
                <select
                  value={cloudTranscription}
                  onChange={(e) => setCloudTranscription(e.target.value as "deepgram" | "local")}
                >
                  <option value="deepgram">Deepgram (Cloud)</option>
                  <option value="local">Local Whisper (Offline)</option>
                </select>
              </div>

              {cloudTranscription === "deepgram" ? (
                <div className="input-group">
                  <label>Deepgram API Key *</label>
                  <input
                    type="password"
                    value={dgKey}
                    onChange={(e) => setDgKey(e.target.value)}
                    placeholder="Insert your Deepgram API Key (for transcription)"
                  />
                </div>
              ) : (
                <p className="form-help">
                  {environment?.hasLocalWhisperModel
                    ? "Local Whisper detected. Transcription will run on this machine."
                    : "Local Whisper não detectado. Use \"Instalar Whisper\" nas configurações antes de importar mídia."}
                </p>
              )}

              <div className="input-group">
                <label>Claude API Key</label>
                <input
                  type="password"
                  value={antKey}
                  onChange={(e) => setAntKey(e.target.value)}
                  placeholder="Insert your Anthropic API Key (moment detection)"
                />
              </div>

              <div className="input-group">
                <label>DeepSeek API Key</label>
                <input
                  type="password"
                  value={dsKey}
                  onChange={(e) => setDsKey(e.target.value)}
                  placeholder="Insert your DeepSeek API Key (alternative moment detection)"
                />
              </div>

              <div className="input-group">
                <label>Groq API Key</label>
                <input
                  type="password"
                  value={grKey}
                  onChange={(e) => setGrKey(e.target.value)}
                  placeholder="Insert your Groq API Key (alternative moment detection)"
                />
              </div>
              <p className="form-help">* At least one LLM credential is required: Claude, DeepSeek, Groq, or a custom endpoint below. A Deepgram key is only needed when transcription uses Deepgram.</p>
            </div>

            <div className="form-stack" style={{ marginTop: "16px" }}>
              <div className="input-group">
                <label>Custom / [OI]-Compatible Endpoint</label>
                <input
                  type="text"
                  value={compatBaseUrl}
                  onChange={(e) => setCompatBaseUrl(e.target.value)}
                  placeholder="Base URL, e.g. http://localhost:1234/v1"
                />
              </div>

              <div className="input-group">
                <label>Custom Model</label>
                <input
                  type="text"
                  value={compatModel}
                  onChange={(e) => setCompatModel(e.target.value)}
                  placeholder="Model name, e.g. llama-3.1-8b-instruct"
                />
              </div>

              <div className="input-group">
                <label>Custom API Key</label>
                <input
                  type="password"
                  value={compatKey}
                  onChange={(e) => setCompatKey(e.target.value)}
                  placeholder={
                    environment?.hasOpenaiCompatibleKey
                      ? "Loaded from environment"
                      : "Optional (leave empty for local servers)"
                  }
                />
              </div>
              <p className="form-help">
                Works with LM Studio, llama.cpp, vLLM, OpenRouter, Together, or any [OI]-compatible API. Filling the
                Base URL overrides the cloud providers above.
              </p>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={() => setSetupMode("choose")}>Back</button>
              <button type="submit" className="primary-action compact">Save & Start</button>
            </div>
          </form>
        )}

        {setupMode === "downloading" && (
          <div className="downloading-flow">
            <div className="onboarding-header compact">
              <h2>Downloading Local Model</h2>
              <p>Please wait while your local environment is downloaded. Do not close the application.</p>
            </div>

            <div className="download-progress-container">
              <div className="download-loader">
                <Loader2 className="spin" size={48} />
              </div>

              <div className="progress-bar-container">
                <div className="progress-bar-fill" style={{ width: `${downloadProgress}%` }}></div>
              </div>

              <div className="download-stats">
                <span className="download-status">{downloadStatus}</span>
                <span className="download-percentage">{downloadProgress}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
