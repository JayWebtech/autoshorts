import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
  Youtube,
  ChevronDown,
  ChevronUp,
  Hash,
  Type,
  AlignLeft,
} from "lucide-react";
import "./styles.css";

type EnvironmentStatus = {
  dataDir: string;
  hasFfmpeg: boolean;
  hasFfprobe: boolean;
  hasDeepgramKey: boolean;
  hasAnthropicKey: boolean;
  hasDeepseekKey: boolean;
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
  const [llmEngine, setLlmEngine] = useState<"claude" | "deepseek" | "local">(() => {
    return (localStorage.getItem("autoshorts_llm_engine") as "claude" | "deepseek" | "local") || "local";
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

  const canTranscribe = transcriptionEngine === "local"
    ? Boolean(environment?.hasLocalWhisperModel)
    : canUseCloudKey;

  const canUseActiveLlm = llmEngine === "local"
    ? Boolean(environment?.hasOllama)
    : (llmEngine === "claude" ? canUseClaude : canUseDeepseek);

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
          name: "Media",
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
        setError("Import successful. Local Whisper GGML model (ggml-base.bin) is missing in your models directory. Please add it to start transcription.");
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
      const activeKey = llmEngine === "claude" ? anthropicKey : deepseekKey;
      const hasActiveKey = llmEngine === "claude"
        ? (env.hasAnthropicKey || activeKey.trim().length > 0)
        : (env.hasDeepseekKey || activeKey.trim().length > 0);
      if (!hasActiveKey) {
        setError(`Transcription complete. ${llmEngine === "claude" ? "Claude" : "DeepSeek"} API Key is missing. Please add it in settings to analyze viral moments.`);
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
                    </label>
                    <label>
                      <span>LLM Engine</span>
                      <select
                        value={llmEngine}
                        onChange={(event) => setLlmEngine(event.target.value as "claude" | "deepseek" | "local")}
                      >
                        <option value="local">Ollama (Offline Local)</option>
                        <option value="claude">Claude (Cloud)</option>
                        <option value="deepseek">DeepSeek (Cloud)</option>
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
                      <label>
                        <span>DeepSeek API Key</span>
                        <input
                          value={deepseekKey}
                          onChange={(event) => setDeepseekKey(event.target.value)}
                          placeholder={environment?.hasDeepseekKey ? "Loaded from env" : "Optional (DeepSeek API Key)"}
                          type="password"
                        />
                      </label>
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
                        ? `⚠️ Local Whisper (Python package 'openai-whisper') is not installed. Run 'pip3 install openai-whisper' in your terminal.`
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
                        : `⚠️ ${llmEngine === "claude" ? "Claude" : "DeepSeek"} API Key is missing. Viral moment identification will not work. Please add your key in API Settings.`}
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
                              <span className="candidate-score">{Math.round(candidate.score * 100)}% Match</span>
                            </div>
                            <h4>{candidate.hook}</h4>
                            <p className="candidate-rationale">{candidate.rationale}</p>
                            
                            <div className="candidate-actions">
                              <span className={`clip-status ${isCut ? "ready" : clip?.status === "error" ? "error" : ""}`}>
                                {isCut ? "Cut ready" : clip?.status === "error" ? "Cut failed" : clip?.status ?? "Pending"}
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
                            {isCut && (
                              <YouTubeCaptionPanel
                                hook={candidate.hook}
                                rationale={candidate.rationale}
                                startSec={candidate.startSec}
                                endSec={candidate.endSec}
                                rank={candidate.rank}
                              />
                            )}
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
          <span className="app-status-indicator">System Ready</span>
        </div>
        <div className="status-bar-right">
          <div className="status-indicators">
            <span className={`indicator ${environment?.hasFfmpeg ? "active" : ""}`} title="FFmpeg status">ffmpeg</span>
            <span className={`indicator ${environment?.hasFfprobe ? "active" : ""}`} title="FFprobe status">ffprobe</span>
            <span className={`indicator ${environment?.hasLocalWhisperModel ? "active" : ""}`} title="Whisper Model status">Whisper Model</span>
            <span className={`indicator ${environment?.hasOllama ? "active" : ""}`} title="Ollama status">Ollama</span>
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

// ─── YouTube Caption Panel ───────────────────────────────────────────────────

function generateYouTubeCaption(hook: string, rationale: string, rank: number) {
  // Build YouTube title (do not auto-truncate, let user edit)
  const title = hook.replace(/["']/g, "").trim();

  // Hashtags extracted from rationale keywords + generic shorts tags
  const rationaleWords = rationale
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5)
    .map((w) => `#${w}`);
  const genericTags = ["#Shorts", "#viral", "#fyp", "#trending", "#reels"];
  const hashtags = [...new Set([...rationaleWords, ...genericTags])].slice(0, 8).join(" ");

  // Description
  const description =
    `${rationale}\n\n` +
    `🔥 Clip #${rank} | AutoShorts\n\n` +
    hashtags;

  return { title, description, hashtags };
}

type CopyButtonProps = { text: string; label?: string };
function CopyButton({ text, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      className="yt-copy-btn"
      onClick={handleCopy}
      title={`Copy ${label ?? ""}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied!" : `Copy ${label ?? ""}`}
    </button>
  );
}

function YouTubeCaptionPanel({
  hook,
  rationale,
  startSec,
  endSec,
  rank,
}: {
  hook: string;
  rationale: string;
  startSec: number;
  endSec: number;
  rank: number;
}) {
  const [open, setOpen] = useState(false);
  const { title, description, hashtags } = generateYouTubeCaption(hook, rationale, rank);
  const duration = Math.round(endSec - startSec);

  return (
    <div className="yt-caption-panel">
      <button
        className={`yt-panel-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        id={`yt-panel-toggle-${rank}`}
      >
        <Youtube size={14} />
        <span>YouTube Caption Suggestions</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div className="yt-panel-body">
          {/* Title */}
          <div className="yt-field">
            <div className="yt-field-header">
              <Type size={13} />
              <span>Title</span>
              <span className={`yt-char-count ${title.length > 90 ? "warn" : ""}`}>
                {title.length}/100
              </span>
              <CopyButton text={title} label="title" />
            </div>
            <textarea
              className="yt-textarea"
              value={title}
              readOnly
              rows={2}
              id={`yt-title-${rank}`}
            />
          </div>

          {/* Description */}
          <div className="yt-field">
            <div className="yt-field-header">
              <AlignLeft size={13} />
              <span>Description</span>
              <CopyButton text={description} label="description" />
            </div>
            <textarea
              className="yt-textarea"
              value={description}
              readOnly
              rows={6}
              id={`yt-description-${rank}`}
            />
          </div>

          {/* Hashtags */}
          <div className="yt-field">
            <div className="yt-field-header">
              <Hash size={13} />
              <span>Hashtags</span>
              <span className="yt-meta">{duration}s clip</span>
              <CopyButton text={hashtags} label="hashtags" />
            </div>
            <textarea
              className="yt-textarea yt-textarea-sm"
              value={hashtags}
              readOnly
              rows={2}
              id={`yt-hashtags-${rank}`}
            />
          </div>

          <div className="yt-upload-hint">
            <Youtube size={12} />
            <span>Tip: Upload the clip file, paste these captions, and publish as a YouTube Short (≤60s).</span>
          </div>
        </div>
      )}
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
  const [setupMode, setSetupMode] = useState<"choose" | "local" | "cloud" | "downloading">("choose");
  const [selectedModel, setSelectedModel] = useState<string>("llama3.2");
  
  const [dgKey, setDgKey] = useState(initialDeepgramKey);
  const [antKey, setAntKey] = useState(initialAnthropicKey);
  const [dsKey, setDsKey] = useState(initialDeepseekKey);
  
  const [downloadStatus, setDownloadStatus] = useState("Initializing download...");
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
      setError("Deepgram API Key is required for cloud mode.");
      return;
    }
    if (!antKey.trim() && !dsKey.trim()) {
      setError("Please provide at least one LLM Key (Claude or DeepSeek).");
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
                <p>Use high-speed cloud services for transcription and analysis. No local GPU needed.</p>
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
                  <h4>Install Python Whisper</h4>
                  <p>Open your terminal and run the following command to install the transcription engine:</p>
                  <div className="code-block-container">
                    <code>pip3 install -U openai-whisper</code>
                    <button type="button" className="copy-btn" onClick={copyWhisperCommand}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  {environment?.hasLocalWhisperModel ? (
                    <span className="step-check success"><BadgeCheck size={14} /> Whisper installed in Python!</span>
                  ) : (
                    <span className="step-check warning">⚠️ Python package 'whisper' not detected yet. Run the command above.</span>
                  )}
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
              <p>Add your keys below. AutoShorts will route transcription and analysis to the cloud.</p>
            </div>

            {error && <div className="error-banner" style={{ marginBottom: "16px" }}>{error}</div>}

            <div className="form-stack">
              <div className="input-group">
                <label>Deepgram API Key *</label>
                <input 
                  type="password" 
                  value={dgKey} 
                  onChange={(e) => setDgKey(e.target.value)}
                  placeholder="Insert your Deepgram API Key (for transcription)"
                />
              </div>

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
              <p className="form-help">* Deepgram Key + at least one LLM Key (Claude or DeepSeek) is required.</p>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
