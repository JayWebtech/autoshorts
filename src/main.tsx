import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
};

type Project = {
  id: string;
  name: string | null;
  sourcePath: string;
  sourceDuration: number | null;
  status: string;
  transcriptionMode: string;
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
  const [deepgramKey, setDeepgramKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [deepseekKey, setDeepseekKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);

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
  const canUseCloudKey = environment?.hasDeepgramKey || deepgramKey.trim().length > 0;
  const canUseClaude = environment?.hasAnthropicKey || anthropicKey.trim().length > 0;
  const canUseDeepseek = environment?.hasDeepseekKey || deepseekKey.trim().length > 0;

  const activeLlmProvider = environment?.llmProvider || "deepseek";
  const canUseActiveLlm = activeLlmProvider === "claude" ? canUseClaude : canUseDeepseek;

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(nextProjectId = detail?.project.id) {
    setError(null);
    const [env, projectList] = await Promise.all([
      invoke<EnvironmentStatus>("environment_status"),
      invoke<Project[]>("list_projects"),
    ]);
    setEnvironment(env);
    setProjects(projectList);

    const projectId = nextProjectId ?? projectList[0]?.id;
    if (projectId) {
      const nextDetail = await invoke<ProjectDetail>("get_project_detail", { projectId });
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
    let newProjectId: string | null = null;
    await run("import", async () => {
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
      const project = await invoke<Project>("create_project_from_path", {
        path: selected,
        transcriptionMode: "cloud",
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
    const hasDG = env.hasDeepgramKey || deepgramKey.trim().length > 0;
    const activeLlm = env.llmProvider || "deepseek";
    const hasActiveLlm = activeLlm === "claude"
      ? (env.hasAnthropicKey || anthropicKey.trim().length > 0)
      : (env.hasDeepseekKey || deepseekKey.trim().length > 0);

    if (!hasDG) {
      setError("Import successful. Deepgram key is missing. Please add it to start transcription.");
      return;
    }

    // 1. Transcription
    try {
      setBusy("transcribe");
      await invoke<Transcript>("transcribe_project", {
        projectId,
        provider: "deepgram",
        apiKey: deepgramKey.trim() || null,
      });
      await refresh(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy("idle");
      return;
    }

    if (!hasActiveLlm) {
      setError(`Transcription complete. ${activeLlm === "claude" ? "Claude" : "DeepSeek"} API Key is missing. Please add it in settings to analyze viral moments.`);
      setBusy("idle");
      return;
    }

    // 2. LLM Moments
    try {
      setBusy("moments");
      const activeKey = activeLlm === "claude" ? anthropicKey.trim() : deepseekKey.trim();
      await invoke<Candidate[]>("generate_candidates", {
        projectId,
        apiKey: activeKey || null,
        allowDemo: false,
      });
      await refresh(projectId);
    } catch (err) {
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
        provider: "deepgram",
        apiKey: deepgramKey.trim() || null,
      });
      await refresh(detail.project.id);
    });
  }

  async function moments(allowDemo: boolean) {
    if (!detail) return;
    await run("moments", async () => {
      const activeKey = activeLlmProvider === "claude" ? anthropicKey.trim() : deepseekKey.trim();
      await invoke<Candidate[]>("generate_candidates", {
        projectId: detail.project.id,
        apiKey: activeKey || null,
        allowDemo,
      });
      await refresh(detail.project.id);
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
    await run("cut", async () => {
      await invoke<string>("render_flat_clip_for_candidate", { candidateId });
      await refresh(detail.project.id);
    });
  }

  async function cutSelected() {
    if (!detail) return;
    await run("cut", async () => {
      for (const candidate of selectedCandidates) {
        await invoke<string>("render_flat_clip_for_candidate", { candidateId: candidate.id });
      }
      await refresh(detail.project.id);
    });
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
                      <span>Deepgram API Key</span>
                      <input
                        value={deepgramKey}
                        onChange={(event) => setDeepgramKey(event.target.value)}
                        placeholder={environment?.hasDeepgramKey ? "Loaded from env" : "Optional (Deepgram API Key)"}
                        type="password"
                      />
                    </label>
                    <label>
                      <span>
                        Claude API Key {activeLlmProvider === "claude" && <strong style={{ color: "var(--accent-primary)" }}>(Active)</strong>}
                      </span>
                      <input
                        value={anthropicKey}
                        onChange={(event) => setAnthropicKey(event.target.value)}
                        placeholder={environment?.hasAnthropicKey ? "Loaded from env" : "Optional (Claude API Key)"}
                        type="password"
                      />
                    </label>
                    <label>
                      <span>
                        DeepSeek API Key {activeLlmProvider === "deepseek" && <strong style={{ color: "var(--accent-primary)" }}>(Active)</strong>}
                      </span>
                      <input
                        value={deepseekKey}
                        onChange={(event) => setDeepseekKey(event.target.value)}
                        placeholder={environment?.hasDeepseekKey ? "Loaded from env" : "Optional (DeepSeek API Key)"}
                        type="password"
                      />
                    </label>
                  </div>
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}

              <div className="pipeline-strip">
                <PipelineStep icon={<AudioLines size={16} />} label="Transcript" done={Boolean(detail.transcript)} />
                <PipelineStep icon={<Sparkles size={16} />} label="Moments" done={detail.candidates.length > 0} />
                <PipelineStep icon={<Scissors size={16} />} label="Cut" done={selectedCount > 0 && selectedCutCount === selectedCount} />
                <PipelineStep icon={<Captions size={16} />} label="Captions" done={false} />
                <PipelineStep icon={<Download size={16} />} label="Export" done={false} />
              </div>

              <div className="work-grid">
                <section className="panel transcript-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>Transcript</h3>
                      <p>{transcript ? `${transcript.segments.length} segments` : "No transcript"}</p>
                    </div>
                    <div className="button-pair">
                      <button onClick={transcribe} disabled={busy !== "idle" || !canUseCloudKey}>
                        {busy === "transcribe" ? <Loader2 className="spin" size={16} /> : <AudioLines size={16} />}
                        Transcribe
                      </button>
                    </div>
                  </div>

                  {!canUseCloudKey && (
                    <div className="api-warning">
                      ⚠️ Deepgram API Key is missing. Transcribing will not work. Please add your key in <strong>API Settings</strong>.
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
                      ⚠️ {activeLlmProvider === "claude" ? "Claude" : "DeepSeek"} API Key is missing. Viral moment identification will not work. Please add your key in <strong>API Settings</strong>.
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
                                {busy === "cut" ? <Loader2 className="spin" size={14} /> : <Scissors size={14} />}
                                {isCut ? "Re-cut" : "Cut"}
                              </button>
                            </div>
                            {clip?.outputPath && <div className="output-path">{clip.outputPath}</div>}
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
            <span className={`indicator ${canUseCloudKey ? "active" : ""}`} title="Deepgram Key status">Deepgram</span>
            <span className={`indicator ${canUseClaude ? "active" : ""}`} title="Claude Key status">Claude</span>
            <span className={`indicator ${canUseDeepseek ? "active" : ""}`} title="DeepSeek Key status">DeepSeek</span>
          </div>
        </div>
      </footer>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
