import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import "./i18n";
import { LanguageSelector } from "./components/LanguageSelector";
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
} from "lucide-react";
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
  llmProvider: string;
  hasLocalWhisperModel: boolean;
  hasOllama: boolean;
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

function App() {
  const { t } = useTranslation();
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [renderingCandidateId, setRenderingCandidateId] = useState<string | null>(null);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("modern-box");
  const [mediaPathToImport, setMediaPathToImport] = useState<string | null>(null);

  // Persistence logic from localStorage
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  const [transcriptionEngine, setTranscriptionEngine] = useState<"deepgram" | "local">(() => {
    return (localStorage.getItem("autoshorts_transcription_engine") as "deepgram" | "local") || "local";
  });
  const [llmEngine, setLlmEngine] = useState<"claude" | "deepseek" | "local" | "gemini" | "openai" | "openrouter">(() => {
    return (localStorage.getItem("autoshorts_llm_engine") as "claude" | "deepseek" | "local" | "gemini" | "openai" | "openrouter") || "local";
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
  const [geminiKey, setGeminiKey] = useState(() => {
    return localStorage.getItem("autoshorts_gemini_key") || "";
  });
  const [openaiKey, setOpenaiKey] = useState(() => {
    return localStorage.getItem("autoshorts_openai_key") || "";
  });
  const [openrouterKey, setOpenrouterKey] = useState(() => {
    return localStorage.getItem("autoshorts_openrouter_key") || "";
  });

  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [modelDownloadStatus, setModelDownloadStatus] = useState("");
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);

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
            : canUseOpenrouter;

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
    localStorage.setItem("autoshorts_gemini_key", geminiKey);
  }, [geminiKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_key", openaiKey);
  }, [openaiKey]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openrouter_key", openrouterKey);
  }, [openrouterKey]);

  const pullModelDirectly = async (modelName: string) => {
    setDownloadingModelName(modelName);
    setModelDownloadProgress(0);
    setModelDownloadStatus(t("modelDownload.connecting"));
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
      setModelDownloadStatus(t("modelDownload.complete"));
      setModelDownloadProgress(100);
      setTimeout(() => setDownloadingModelName(null), 500);
    } catch (err) {
      alert(t("common.alertModelDownloadFailed", { error: String(err) }));
      setDownloadingModelName(null);
    }
  };

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
    }
  }

  async function importMedia() {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: t("common.fileFilterMedia"),
          extensions: ["mp4", "mov", "mp3", "wav", "m4a"],
        },
      ],
    });
    if (typeof selected !== "string") return;
    setMediaPathToImport(selected);
    setShowStyleModal(true);
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
        setError(t("common.importSuccessWhisperMissing"));
        return;
      }
    } else {
      const hasDG = env.hasDeepgramKey || deepgramKey.trim().length > 0;
      if (!hasDG) {
        setError(t("common.importSuccessDeepgramMissing"));
        return;
      }
    }

    if (llmEngine === "local") {
      if (!env.hasOllama) {
        setError(t("common.importSuccessOllamaMissing"));
        return;
      }
    } else {
      const activeKey =
        llmEngine === "claude" ? anthropicKey :
          llmEngine === "deepseek" ? deepseekKey :
            llmEngine === "gemini" ? geminiKey :
              llmEngine === "openai" ? openaiKey :
                llmEngine === "openrouter" ? openrouterKey : "";
      const hasActiveKey =
        llmEngine === "claude" ? (env.hasAnthropicKey || activeKey.trim().length > 0) :
          llmEngine === "deepseek" ? (env.hasDeepseekKey || activeKey.trim().length > 0) :
            llmEngine === "gemini" ? (env.hasGeminiKey || activeKey.trim().length > 0) :
              llmEngine === "openai" ? (env.hasOpenaiKey || activeKey.trim().length > 0) :
                llmEngine === "openrouter" ? (env.hasOpenrouterKey || activeKey.trim().length > 0) : false;
      if (!hasActiveKey) {
        const engineName = t(`status.${llmEngine === "claude" ? "claude" : llmEngine === "deepseek" ? "deepseek" : llmEngine === "gemini" ? "gemini" : llmEngine === "openai" ? "openai" : llmEngine === "openrouter" ? "openrouter" : "llm"}`);
        setError(t("common.transcriptionCompleteKeyMissing", { engine: engineName }));
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
      const activeKey = llmEngine === "claude" ? anthropicKey.trim() : (llmEngine === "deepseek" ? deepseekKey.trim() : "");
      await invoke<Candidate[]>("generate_candidates", {
        projectId,
        apiKey: activeKey || null,
        provider: llmEngine,
        modelName: llmEngine === "local" ? localLlmModel.trim() : null,
        allowDemo: false,
      });
      await refresh(projectId);
    } catch (err) {
      const errMsg = String(err);
      if (llmEngine === "local" && (errMsg.includes("not found") || errMsg.includes("404"))) {
        if (window.confirm(t("common.downloadModelPrompt", { modelName: localLlmModel }))) {
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
    const newName = window.prompt(t("common.renamePrompt"), currentName);
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
    if (!window.confirm(t("common.deleteConfirm", { name }))) return;

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
      });
      await refresh(detail.project.id);
    });
  }

  async function moments(allowDemo: boolean) {
    if (!detail) return;
    await run("moments", async () => {
      const activeKey = llmEngine === "claude" ? anthropicKey.trim() : (llmEngine === "deepseek" ? deepseekKey.trim() : "");
      try {
        await invoke<Candidate[]>("generate_candidates", {
          projectId: detail.project.id,
          apiKey: activeKey || null,
          provider: llmEngine,
          modelName: llmEngine === "local" ? localLlmModel.trim() : null,
          allowDemo,
        });
        await refresh(detail.project.id);
      } catch (err) {
        const errMsg = String(err);
        if (llmEngine === "local" && (errMsg.includes("not found") || errMsg.includes("404"))) {
          if (window.confirm(t("common.downloadModelPrompt", { modelName: localLlmModel }))) {
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
      await refresh(detail.project.id);
    }
  }

  async function cutSelected() {
    if (!detail) return;
    setBusy("cut");
    setError(null);
    try {
      for (const candidate of selectedCandidates) {
        setRenderingCandidateId(candidate.id);
        await invoke<string>("render_flat_clip_for_candidate", { candidateId: candidate.id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingCandidateId(null);
      setBusy("idle");
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
        deepgramKey={deepgramKey}
        anthropicKey={anthropicKey}
        deepseekKey={deepseekKey}
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
            title={t("sidebar.goHomeTitle")}
          >
            <div className="brand-mark">
              <Clapperboard size={20} />
            </div>
            <div>
              <h1>{t("brand.name")}</h1>
              <p>{t("brand.tagline")}</p>
            </div>
          </div>

          <button className="primary-action" onClick={importMedia} disabled={busy !== "idle"}>
            {busy === "import" ? <Loader2 className="spin" size={18} /> : <FileVideo size={18} />}
            {t("sidebar.importRecording")}
          </button>

          <section className="project-list" aria-label={t("sidebar.allProjects")}>
            <button
              className={`project-row ${!detail ? "active" : ""}`}
              onClick={() => setDetail(null)}
            >
              <Clapperboard size={15} />
              <span>{t("sidebar.allProjects")}</span>
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
                  <LanguageSelector />
                  <button
                    className={`icon-button settings-toggle ${showSettings ? "active" : ""}`}
                    onClick={() => setShowSettings(!showSettings)}
                    title={t("topbar.apiSettings")}
                  >
                    <SlidersHorizontal size={16} />
                    <span>{t("topbar.apiSettings")}</span>
                  </button>
                  <button className="icon-button" onClick={() => void refresh(detail.project.id)} title={t("topbar.refreshTitle")}>
                    <RefreshCw size={18} />
                  </button>
                </div>
              </header>

              {showSettings && (
                <div className="settings-panel">
                  <div className="key-stack-horizontal">
                    <label>
                      <span>{t("settings.transcriptionEngine")}</span>
                      <select
                        value={transcriptionEngine}
                        onChange={(event) => setTranscriptionEngine(event.target.value as "deepgram" | "local")}
                      >
                        <option value="local">{t("settings.transcriptionOptions.local")}</option>
                        <option value="deepgram">{t("settings.transcriptionOptions.deepgram")}</option>
                      </select>
                      <span>{t("settings.llmEngine")}</span>
                      <select
                        value={llmEngine}
                        onChange={(event) => setLlmEngine(event.target.value as any)}
                      >
                        <option value="local">{t("settings.llmOptions.local")}</option>
                        <option value="claude">{t("settings.llmOptions.claude")}</option>
                        <option value="deepseek">{t("settings.llmOptions.deepseek")}</option>
                        <option value="gemini">{t("settings.llmOptions.gemini")}</option>
                        <option value="openai">{t("settings.llmOptions.openai")}</option>
                        <option value="openrouter">{t("settings.llmOptions.openrouter")}</option>
                      </select>
                    </label>
                    {transcriptionEngine === "deepgram" && (
                      <label>
                        <span>{t("settings.deepgramKey")}</span>
                        <input
                          value={deepgramKey}
                          onChange={(event) => setDeepgramKey(event.target.value)}
                          placeholder={environment?.hasDeepgramKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.deepgramKey") })}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "claude" && (
                      <label>
                        <span>{t("settings.claudeKey")}</span>
                        <input
                          value={anthropicKey}
                          onChange={(event) => setAnthropicKey(event.target.value)}
                          placeholder={environment?.hasAnthropicKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.claudeKey") })}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "deepseek" && (
                      <label>
                        <span>{t("settings.deepseekKey")}</span>
                        <input
                          value={deepseekKey}
                          onChange={(event) => setDeepseekKey(event.target.value)}
                          placeholder={environment?.hasDeepseekKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.deepseekKey") })}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "gemini" && (
                      <label>
                        <span>{t("settings.geminiKey")}</span>
                        <input
                          value={geminiKey}
                          onChange={(event) => setGeminiKey(event.target.value)}
                          placeholder={environment?.hasGeminiKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.geminiKey") })}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "openai" && (
                      <label>
                        <span>{t("settings.openaiKey")}</span>
                        <input
                          value={openaiKey}
                          onChange={(event) => setOpenaiKey(event.target.value)}
                          placeholder={environment?.hasOpenaiKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.openaiKey") })}
                          type="password"
                        />
                      </label>
                    )}
                    {llmEngine === "openrouter" && (
                      <label>
                        <span>{t("settings.openrouterKey")}</span>
                        <input
                          value={openrouterKey}
                          onChange={(event) => setOpenrouterKey(event.target.value)}
                          placeholder={environment?.hasOpenrouterKey ? t("settings.loadedFromEnv") : t("settings.optionalKey", { label: t("settings.openrouterKey") })}
                          type="password"
                        />
                      </label>
                    )}

                    {llmEngine === "local" && (
                      <label>
                        <span>{t("settings.ollamaModelName")}</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            value={localLlmModel}
                            onChange={(event) => setLocalLlmModel(event.target.value)}
                            placeholder={t("settings.ollamaModelPlaceholder")}
                            type="text"
                          />
                          <button
                            type="button"
                            className="icon-button"
                            style={{ minHeight: '36px', height: '36px' }}
                            onClick={() => pullModelDirectly(localLlmModel)}
                          >
                            <Download size={14} /> {t("settings.pull")}
                          </button>
                        </div>
                      </label>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                    <button
                      type="button"
                      className="icon-button"
                      style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171' }}
                      onClick={() => {
                        if (window.confirm(t("settings.resetConfirm"))) {
                          localStorage.clear();
                          window.location.reload();
                        }
                      }}
                    >
                      {t("settings.resetConfig")}
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}

              <div className="pipeline-strip">
                <PipelineStep icon={<AudioLines size={16} />} label={t("pipeline.transcript")} done={Boolean(detail.transcript)} />
                <PipelineStep icon={<Sparkles size={16} />} label={t("pipeline.moments")} done={detail.candidates.length > 0} />
                <PipelineStep icon={<Scissors size={16} />} label={t("pipeline.cut")} done={selectedCount > 0 && selectedCutCount === selectedCount} />
                <PipelineStep icon={<Captions size={16} />} label={t("pipeline.captions")} done={selectedCount > 0 && selectedCaptionsCount === selectedCount} />
                <PipelineStep icon={<Download size={16} />} label={t("pipeline.export")} done={selectedCount > 0 && selectedCutCount === selectedCount} />
              </div>

              <div className="work-grid">
                <section className="panel transcript-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>{t("transcript.title")}</h3>
                      <p>{transcript ? t("transcript.segments", { count: transcript.segments.length }) : t("transcript.empty")}</p>
                    </div>
                    <div className="button-pair">
                      <button onClick={transcribe} disabled={busy !== "idle" || !canTranscribe}>
                        {busy === "transcribe" ? <Loader2 className="spin" size={16} /> : <AudioLines size={16} />}
                        {t("transcript.transcribe")}
                      </button>
                    </div>
                  </div>

                  {!canTranscribe && (
                    <div className="api-warning">
                      {transcriptionEngine === "local"
                        ? t("transcript.warningLocal")
                        : t("transcript.warningCloud")}
                    </div>
                  )}

                  <div className="transcript-list">
                    {transcript?.segments.map((segment, index) => (
                      <article key={`${segment.start}-${index}`} className="segment-row">
                        <span>{formatTime(segment.start)}</span>
                        <p>{segment.text}</p>
                      </article>
                    )) ?? <EmptyState icon={<AudioLines size={28} />} label={t("transcript.pending")} />}
                  </div>
                </section>

                <section className="panel candidate-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>{t("candidates.title")}</h3>
                      <p>{detail.candidates.length ? t("candidates.selected", { count: selectedCount }) : t("candidates.empty")}</p>
                    </div>
                    <div className="button-pair">
                      <button onClick={cutSelected} disabled={busy !== "idle" || selectedCount === 0 || !environment?.hasFfmpeg}>
                        {busy === "cut" ? <Loader2 className="spin" size={16} /> : <Scissors size={16} />}
                        {t("candidates.cut")}
                      </button>
                      <button onClick={() => void moments(false)} disabled={busy !== "idle" || !detail.transcript || !canUseActiveLlm}>
                        {busy === "moments" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
                        {t("candidates.findMoments")}
                      </button>
                    </div>
                  </div>

                  {!canUseActiveLlm && (
                    <div className="api-warning">
                      {llmEngine === "local"
                        ? t("candidates.warningLocal")
                        : t("candidates.warningCloud", { engine: t(`status.${llmEngine === "claude" ? "claude" : llmEngine === "deepseek" ? "deepseek" : llmEngine === "gemini" ? "gemini" : llmEngine === "openai" ? "openai" : llmEngine === "openrouter" ? "openrouter" : "llm"}`) })}
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
                      return (
                        <article key={candidate.id} className={`candidate-card ${candidate.selected ? "selected" : ""}`}>
                          {/* 9:16 portrait mockup preview placeholder representing vertical formats */}
                          <div className="portrait-preview-container">
                            <div className="portrait-preview-mock">
                              {isCut ? (
                                <div className="mock-video-active">
                                  <Play size={20} className="play-icon-mock" />
                                </div>
                              ) : (
                                <div className="mock-video-inactive">
                                  <span>9:16</span>
                                </div>
                              )}
                            </div>
                            <div className="candidate-rank">
                              <span>#{candidate.rank}</span>
                              {candidate.selected && <Check size={14} />}
                            </div>
                          </div>

                          <div className="candidate-body">
                            <div className="candidate-meta">
                              <span>{formatTime(candidate.startSec)} - {formatTime(candidate.endSec)}</span>
                              <span className="candidate-score">{Math.round(candidate.score * 100)}% {t("candidates.match")}</span>
                            </div>
                            <h4>{candidate.hook}</h4>
                            <p className="candidate-rationale">{candidate.rationale}</p>

                            <div className="candidate-actions">
                              <span className={`clip-status ${isCut ? "ready" : clip?.status === "error" ? "error" : ""}`}>
                                {isCut ? t("candidates.cutReady") : clip?.status === "error" ? t("candidates.cutFailed") : clip?.status ?? t("candidates.pending")}
                              </span>
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
                                {renderingCandidateId === candidate.id ? t("candidates.cutting") : isCut ? t("candidates.reCut") : t("candidates.cut")}
                              </button>
                            </div>
                            {clip?.outputPath && <div className="output-path">{clip.outputPath}</div>}
                            {clip?.captionAssPath && (
                              <div className="output-path" style={{ background: "rgba(142, 230, 199, 0.05)", borderColor: "var(--accent-primary)", color: "var(--accent-primary)", marginTop: "4px" }}>
                                {t("candidates.subtitles", { path: clip.captionAssPath })}
                              </div>
                            )}
                            {clip?.renderLog && <div className="render-log">{clip.renderLog}</div>}
                          </div>
                        </article>
                      );
                    })}
                    {detail.candidates.length === 0 && <EmptyState icon={<Sparkles size={28} />} label={t("candidates.empty")} />}
                  </div>
                </section>
              </div>
            </>
          ) : (
            <div className="home-dashboard">
              <header className="home-header">
                <div>
                  <h2>{t("home.title")}</h2>
                  <p>{t("home.subtitle")}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <LanguageSelector />
                  <button className="primary-action compact" onClick={importMedia} disabled={busy !== "idle"}>
                    {busy === "import" ? <Loader2 className="spin" size={18} /> : <FileVideo size={18} />}
                    {t("home.importRecording")}
                  </button>
                </div>
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
                          <span>{t("home.duration")} {project.sourceDuration ? formatTime(project.sourceDuration) : t("common.probing")}</span>
                          <span>{t("home.created")} {new Date(project.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="project-card-actions">
                          <button className="action-btn open-btn" onClick={() => void selectProject(project.id)}>
                            {t("home.open")}
                          </button>
                          <button className="action-btn rename-btn" onClick={() => void renameProject(project.id)}>
                            {t("home.rename")}
                          </button>
                          <button className="action-btn delete-btn" onClick={() => void deleteProject(project.id)}>
                            {t("home.delete")}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-dashboard-state">
                  <Clapperboard size={48} className="empty-state-icon" />
                  <h3>{t("home.noProjects")}</h3>
                  <p>{t("home.emptyHint")}</p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="status-bar">
        <div className="status-bar-left">
          <span className="app-status-indicator">{t("status.systemReady")}</span>
        </div>
        <div className="status-bar-right">
          <div className="status-indicators">
            <span className={`indicator ${environment?.hasFfmpeg ? "active" : ""}`} title={t("status.ffmpegStatus")}>{t("status.ffmpeg")}</span>
            <span className={`indicator ${environment?.hasFfprobe ? "active" : ""}`} title={t("status.ffprobeStatus")}>{t("status.ffprobe")}</span>
            <span className={`indicator ${environment?.hasLocalWhisperModel ? "active" : ""}`} title={t("status.whisperModelStatus")}>{t("status.whisperModel")}</span>
            <span className={`indicator ${environment?.hasOllama ? "active" : ""}`} title={t("status.ollamaStatus")}>{t("status.ollama")}</span>
            <span className={`indicator ${canUseCloudKey ? "active" : ""}`} title={t("status.deepgramKeyStatus")}>{t("status.deepgram")}</span>
            <span className={`indicator ${canUseClaude ? "active" : ""}`} title={t("status.claudeKeyStatus")}>{t("status.claude")}</span>
            <span className={`indicator ${canUseDeepseek ? "active" : ""}`} title={t("status.deepseekKeyStatus")}>{t("status.deepseek")}</span>
          </div>
        </div>
      </footer>

      {showStyleModal && (
        <div className="style-modal-overlay">
          <div className="style-modal">
            <div className="style-modal-header">
              <h3>{t("styleModal.title")}</h3>
              <p>{t("styleModal.subtitle")}</p>
            </div>

            <div className="style-grid">
              <div
                className={`style-card ${selectedStyle === "modern-box" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("modern-box")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-box">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.modernBox.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.modernBox.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "classic-outline" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("classic-outline")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-outline">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.classicOutline.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.classicOutline.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "minimal-shadow" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("minimal-shadow")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-shadow">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.minimalShadow.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.minimalShadow.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-cyan" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-cyan")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-cyan">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.vibrantCyan.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.vibrantCyan.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-yellow-box" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-yellow-box")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-yellow-box">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.vibrantYellowBox.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.vibrantYellowBox.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-green" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-green")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-green">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.vibrantGreen.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.vibrantGreen.description")}</div>
              </div>

              <div
                className={`style-card ${selectedStyle === "vibrant-red" ? "selected" : ""}`}
                onClick={() => setSelectedStyle("vibrant-red")}
              >
                <div className="style-preview-box">
                  <span className="preview-text-red">BRAINFOOD BECAUSE</span>
                </div>
                <div className="style-card-title">{t("styleModal.styles.vibrantRed.name")}</div>
                <div className="style-card-desc">{t("styleModal.styles.vibrantRed.description")}</div>
              </div>
            </div>

            <div className="style-modal-actions">
              <button className="btn-cancel" onClick={() => { setShowStyleModal(false); setMediaPathToImport(null); }}>
                {t("styleModal.cancel")}
              </button>
              <button className="btn-confirm" onClick={() => confirmImport(selectedStyle)}>
                {t("styleModal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {downloadingModelName && (
        <div className="onboarding-overlay" style={{ zIndex: 20000 }}>
          <div className="onboarding-card" style={{ maxWidth: '480px', textAlign: 'center' }}>
            <div className="onboarding-header compact" style={{ textAlign: 'center' }}>
              <h2>{t("modelDownload.title")}</h2>
              <p>{t("modelDownload.description", { modelName: downloadingModelName })}</p>
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
    </div>
  );
}

function StatusPill({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`status-pill ${active ? "active" : ""}`}>
      <BadgeCheck size={14} />
      {label}
    </div>
  );
}

function PipelineStep({ icon, label, done }: { icon: React.ReactNode; label: string; done: boolean }) {
  return (
    <div className={`pipeline-step ${done ? "done" : ""}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

interface OnboardingProps {
  environment: EnvironmentStatus | null;
  onComplete: () => void;
  setTranscriptionEngine: (engine: "deepgram" | "local") => void;
  setLlmEngine: (engine: "claude" | "deepseek" | "local") => void;
  setLocalLlmModel: (model: string) => void;
  setDeepgramKey: (key: string) => void;
  setAnthropicKey: (key: string) => void;
  setDeepseekKey: (key: string) => void;
  deepgramKey: string;
  anthropicKey: string;
  deepseekKey: string;
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
  deepgramKey: initialDeepgramKey,
  anthropicKey: initialAnthropicKey,
  deepseekKey: initialDeepseekKey,
  refreshEnv,
}: OnboardingProps) {
  const { t } = useTranslation();
  const [setupMode, setSetupMode] = useState<"choose" | "local" | "cloud" | "downloading">("choose");
  const [selectedModel, setSelectedModel] = useState<string>("llama3.2");

  const [dgKey, setDgKey] = useState(initialDeepgramKey);
  const [antKey, setAntKey] = useState(initialAnthropicKey);
  const [dsKey, setDsKey] = useState(initialDeepseekKey);

  const [downloadStatus, setDownloadStatus] = useState(t("common.initializingDownload"));
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [checkingOllama, setCheckingOllama] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyWhisperCommand = () => {
    navigator.clipboard.writeText("pip3 install -U openai-whisper");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloudSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dgKey.trim()) {
      setError(t("onboarding.errors.deepgramRequired"));
      return;
    }
    if (!antKey.trim() && !dsKey.trim()) {
      setError(t("onboarding.errors.llmRequired"));
      return;
    }

    setTranscriptionEngine("deepgram");
    setDeepgramKey(dgKey.trim());
    localStorage.setItem("autoshorts_deepgram_key", dgKey.trim());
    localStorage.setItem("autoshorts_transcription_engine", "deepgram");

    if (antKey.trim()) {
      setLlmEngine("claude");
      setAnthropicKey(antKey.trim());
      localStorage.setItem("autoshorts_anthropic_key", antKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "claude");
    } else if (dsKey.trim()) {
      setLlmEngine("deepseek");
      setDeepseekKey(dsKey.trim());
      localStorage.setItem("autoshorts_deepseek_key", dsKey.trim());
      localStorage.setItem("autoshorts_llm_engine", "deepseek");
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
      setDownloadStatus(t("onboarding.errors.ollamaNotFound"));

      try {
        const unlistenInstall = await listen<string>("ollama-install-status", (event) => {
          setDownloadStatus(event.payload);
        });

        await invoke("install_ollama");
        unlistenInstall();
      } catch (err) {
        setError(t("onboarding.errors.installFailed", { error: String(err) }));
        setSetupMode("local");
        return;
      }
    }

    setSetupMode("downloading");
    setDownloadStatus(t("onboarding.errors.ollamaConnected"));

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
              <h2>{t("onboarding.welcome")}</h2>
              <p>{t("onboarding.tagline")}</p>
            </div>

            <div className="onboarding-choices">
              <div className="choice-card clickable" onClick={() => setSetupMode("local")}>
                <div className="choice-icon">
                  <Database size={28} />
                </div>
                <h3>{t("onboarding.offline.title")}</h3>
                <p>{t("onboarding.offline.description")}</p>
                <div className="choice-badge local">{t("onboarding.offline.badge")}</div>
              </div>

              <div className="choice-card clickable" onClick={() => setSetupMode("cloud")}>
                <div className="choice-icon">
                  <Cloud size={28} />
                </div>
                <h3>{t("onboarding.cloud.title")}</h3>
                <p>{t("onboarding.cloud.description")}</p>
                <div className="choice-badge cloud">{t("onboarding.cloud.badge")}</div>
              </div>
            </div>
          </>
        )}

        {setupMode === "local" && (
          <div className="local-setup-flow">
            <div className="onboarding-header compact">
              <h2>{t("onboarding.localSetup.title")}</h2>
              <p>{t("onboarding.localSetup.subtitle")}</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="setup-steps">
              <div className="setup-step">
                <div className="step-num">1</div>
                <div className="step-body">
                  <h4>{t("onboarding.localSetup.step1.title")}</h4>
                  <p>{t("onboarding.localSetup.step1.description")}</p>
                  <div className="code-block-container">
                    <code>{t("onboarding.localSetup.step1.command")}</code>
                    <button type="button" className="copy-btn" onClick={copyWhisperCommand}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? t("onboarding.localSetup.step1.copied") : t("onboarding.localSetup.step1.copy")}
                    </button>
                  </div>
                  {environment?.hasLocalWhisperModel ? (
                    <span className="step-check success"><BadgeCheck size={14} /> {t("onboarding.localSetup.step1.installed")}</span>
                  ) : (
                    <span className="step-check warning">⚠️ {t("onboarding.localSetup.step1.notDetected")}</span>
                  )}
                </div>
              </div>

              <div className="setup-step">
                <div className="step-num">2</div>
                <div className="step-body">
                  <h4>{t("onboarding.localSetup.step2.title")}</h4>
                  <p dangerouslySetInnerHTML={{ __html: t("onboarding.localSetup.step2.description") }} />
                  <p>{t("onboarding.localSetup.step2.selectModel")}</p>

                  <div className="model-cards">
                    <div
                      className={`model-card ${selectedModel === "llama3.2" ? "active" : ""}`}
                      onClick={() => setSelectedModel("llama3.2")}
                    >
                      <div className="model-card-header">
                        <h5>{t("onboarding.localSetup.step2.models.llama32.name")}</h5>
                        <span className="model-size">{t("onboarding.localSetup.step2.models.llama32.size")}</span>
                      </div>
                      <p>{t("onboarding.localSetup.step2.models.llama32.description")}</p>
                    </div>

                    <div
                      className={`model-card ${selectedModel === "qwen2.5:3b" ? "active" : ""}`}
                      onClick={() => setSelectedModel("qwen2.5:3b")}
                    >
                      <div className="model-card-header">
                        <h5>{t("onboarding.localSetup.step2.models.qwen3b.name")}</h5>
                        <span className="model-size">{t("onboarding.localSetup.step2.models.qwen3b.size")}</span>
                      </div>
                      <p>{t("onboarding.localSetup.step2.models.qwen3b.description")}</p>
                    </div>

                    <div
                      className={`model-card ${selectedModel === "qwen2.5:7b" ? "active" : ""}`}
                      onClick={() => setSelectedModel("qwen2.5:7b")}
                    >
                      <div className="model-card-header">
                        <h5>{t("onboarding.localSetup.step2.models.qwen7b.name")}</h5>
                        <span className="model-size">{t("onboarding.localSetup.step2.models.qwen7b.size")}</span>
                      </div>
                      <p>{t("onboarding.localSetup.step2.models.qwen7b.description")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={() => setSetupMode("choose")}>{t("onboarding.localSetup.back")}</button>
              <button
                type="button"
                className="primary-action compact"
                onClick={startLocalSetup}
                disabled={checkingOllama}
              >
                {checkingOllama ? <Loader2 className="spin" size={18} /> : null}
                {checkingOllama ? t("onboarding.localSetup.checkingOllama") : t("onboarding.localSetup.downloadStart")}
              </button>
            </div>
          </div>
        )}

        {setupMode === "cloud" && (
          <form className="cloud-setup-flow" onSubmit={handleCloudSubmit}>
            <div className="onboarding-header compact">
              <h2>{t("onboarding.cloudSetup.title")}</h2>
              <p>{t("onboarding.cloudSetup.subtitle")}</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="form-stack">
              <div className="input-group">
                <label>{t("onboarding.cloudSetup.deepgramKey")}</label>
                <input
                  type="password"
                  value={dgKey}
                  onChange={(e) => setDgKey(e.target.value)}
                  placeholder={t("onboarding.cloudSetup.deepgramPlaceholder")}
                />
              </div>

              <div className="input-group">
                <label>{t("onboarding.cloudSetup.claudeKey")}</label>
                <input
                  type="password"
                  value={antKey}
                  onChange={(e) => setAntKey(e.target.value)}
                  placeholder={t("onboarding.cloudSetup.claudePlaceholder")}
                />
              </div>

              <div className="input-group">
                <label>{t("onboarding.cloudSetup.deepseekKey")}</label>
                <input
                  type="password"
                  value={dsKey}
                  onChange={(e) => setDsKey(e.target.value)}
                  placeholder={t("onboarding.cloudSetup.deepseekPlaceholder")}
                />
              </div>
              <p className="form-help">{t("onboarding.cloudSetup.help")}</p>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="icon-button" onClick={() => setSetupMode("choose")}>{t("onboarding.cloudSetup.back")}</button>
              <button type="submit" className="primary-action compact">{t("onboarding.cloudSetup.saveStart")}</button>
            </div>
          </form>
        )}

        {setupMode === "downloading" && (
          <div className="downloading-flow">
            <div className="onboarding-header compact">
              <h2>{t("onboarding.downloading.title")}</h2>
              <p>{t("onboarding.downloading.subtitle")}</p>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
