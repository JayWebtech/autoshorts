import React, { useEffect, useState } from "react";
import { BadgeCheck, Check, Clapperboard, Cloud, Copy, Database, Loader2 } from "lucide-react";
import { EnvironmentStatus, LlmEngine } from "../../types";
import { invoke, listen } from "../../apiBridge";

interface OnboardingModalProps {
  environment: EnvironmentStatus | null;
  onComplete: () => void;
  setTranscriptionEngine: (engine: "deepgram" | "local") => void;
  setLlmEngine: (engine: LlmEngine) => void;
  setLocalLlmModel: (model: string) => void;
  setDeepgramKey: (key: string) => void;
  setAnthropicKey: (key: string) => void;
  setDeepseekKey: (key: string) => void;
  setGroqKey: (key: string) => void;
  deepgramKey: string;
  anthropicKey: string;
  deepseekKey: string;
  groqKey: string;
  refreshEnv: () => Promise<void>;
}

export function OnboardingModal({
  environment,
  onComplete,
  setTranscriptionEngine,
  setLlmEngine,
  setLocalLlmModel,
  setDeepgramKey,
  setAnthropicKey,
  setDeepseekKey,
  setGroqKey,
  deepgramKey: initialDeepgramKey,
  anthropicKey: initialAnthropicKey,
  deepseekKey: initialDeepseekKey,
  groqKey: initialGroqKey,
  refreshEnv,
}: OnboardingModalProps) {
  const [setupMode, setSetupMode] = useState<"choose" | "local" | "cloud" | "downloading">("choose");
  const [selectedModel, setSelectedModel] = useState<string>("llama3.2");

  const [dgKey, setDgKey] = useState(initialDeepgramKey);
  const [antKey, setAntKey] = useState(initialAnthropicKey);
  const [dsKey, setDsKey] = useState(initialDeepseekKey);
  const [grKey, setGrKey] = useState(initialGroqKey);

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
    if (!antKey.trim() && !dsKey.trim() && !grKey.trim()) {
      setError("Please provide at least one LLM Key (Claude, DeepSeek, or Groq).");
      return;
    }

    setTranscriptionEngine("deepgram");
    setDeepgramKey(dgKey.trim());
    localStorage.setItem("autoshorts_deepgram_key", dgKey.trim());
    localStorage.setItem("autoshorts_transcription_engine", "deepgram");

    if (antKey.trim() || dsKey.trim() || grKey.trim()) {
      setLlmEngine("openrouter");
      const key = antKey.trim() || dsKey.trim() || grKey.trim();
      localStorage.setItem("autoshorts_openrouter_key", key);
      localStorage.setItem("autoshorts_llm_engine", "openrouter");
    } else {
      setLlmEngine("local");
      localStorage.setItem("autoshorts_llm_engine", "local");
    }

    localStorage.setItem("autoshorts_onboarded", "true");
    onComplete();
  };

  const isModelDownloaded = (modelKey: string) => {
    return (environment?.installedOllamaModels || []).some((m) => {
      const normM = m.toLowerCase();
      const normKey = modelKey.toLowerCase();
      return normM === normKey || normM.startsWith(normKey) || normKey.startsWith(normM);
    });
  };

  useEffect(() => {
    if (environment?.installedOllamaModels && environment.installedOllamaModels.length > 0) {
      const found = ["qwen2.5:7b", "qwen2.5:3b", "llama3.2"].find((candidate) =>
        isModelDownloaded(candidate)
      );
      if (found) {
        setSelectedModel(found);
      }
    }
  }, [environment?.installedOllamaModels]);

  const startLocalSetup = async () => {
    setError(null);
    setCheckingOllama(true);
    setDownloadProgress(0);

    try {
      try {
        await refreshEnv();
      } catch (e) {
        console.warn("refreshEnv warning:", e);
      }

      let currentEnv: EnvironmentStatus | null = null;
      try {
        currentEnv = await invoke<EnvironmentStatus>("environment_status");
      } catch (e) {
        console.warn("environment_status warning:", e);
      }

      const isOllamaRunning = currentEnv?.hasOllama ?? false;

      if (!isOllamaRunning) {
        setSetupMode("downloading");
        setDownloadStatus("Ollama no detectado. Iniciando...");

        try {
          const unlistenInstall = await listen<string>("ollama-install-status", (event) => {
            setDownloadStatus(event.payload);
          });

          await invoke("install_ollama");
          unlistenInstall();
        } catch (err) {
          setError("No se pudo iniciar Ollama automáticamente: " + String(err) + ". Asegúrate de abrir la app de Ollama en tu PC.");
          setSetupMode("local");
          return;
        }
      }

      // Check if selected model is ALREADY downloaded in Ollama!
      const installed = currentEnv?.installedOllamaModels || [];
      const alreadyDownloaded = installed.some((m) => {
        const normM = m.toLowerCase();
        const normSelected = selectedModel.toLowerCase();
        return normM === normSelected || normM.startsWith(normSelected) || normSelected.startsWith(normM);
      });

      if (!alreadyDownloaded) {
        setSetupMode("downloading");
        setDownloadStatus(`Descargando modelo ${selectedModel} en Ollama...`);

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

        try {
          await invoke("pull_ollama_model", { modelName: selectedModel });
        } finally {
          unlisten();
        }
      }

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
    } finally {
      setCheckingOllama(false);
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
                      {isModelDownloaded("llama3.2") && (
                        <div style={{ color: "#4ade80", fontSize: "12px", marginTop: "4px", fontWeight: 600 }}>✓ Ya instalado en Ollama</div>
                      )}
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
                      {isModelDownloaded("qwen2.5:3b") && (
                        <div style={{ color: "#4ade80", fontSize: "12px", marginTop: "4px", fontWeight: 600 }}>✓ Ya instalado en Ollama</div>
                      )}
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
                      {isModelDownloaded("qwen2.5:7b") && (
                        <div style={{ color: "#4ade80", fontSize: "12px", marginTop: "4px", fontWeight: 600 }}>✓ Ya instalado en Ollama</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="btn-cancel" onClick={() => setSetupMode("choose")}>Volver</button>
              <button
                type="button"
                className="btn-confirm compact"
                onClick={startLocalSetup}
                disabled={checkingOllama}
              >
                {checkingOllama ? <Loader2 className="spin" size={18} /> : null}
                {checkingOllama
                  ? "Verificando Ollama..."
                  : isModelDownloaded(selectedModel)
                    ? `Usar ${selectedModel} y Continuar`
                    : "Descargar y Continuar"}
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

              <div className="input-group">
                <label>Groq API Key</label>
                <input
                  type="password"
                  value={grKey}
                  onChange={(e) => setGrKey(e.target.value)}
                  placeholder="Insert your Groq API Key (alternative moment detection)"
                />
              </div>
              <p className="form-help">* Deepgram Key + at least one LLM Key (Claude, DeepSeek, or Groq) is required.</p>
            </div>

            <div className="onboarding-actions">
              <button type="button" className="btn-cancel" onClick={() => setSetupMode("choose")}>Volver</button>
              <button type="submit" className="btn-confirm compact">Guardar y Continuar</button>
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
