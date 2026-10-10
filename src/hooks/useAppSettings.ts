import { useState, useEffect, useCallback } from "react";
import { invoke, listen } from "../apiBridge";
import type {
  EnvironmentStatus,
  HardwareTelemetry,
  LlmEngine,
  TranscriptionEngine,
  WhisperModel,
} from "../types";

export function useAppSettings() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [telemetry, setTelemetry] = useState<HardwareTelemetry | null>(null);
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);

  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine>(() => {
    return (localStorage.getItem("autoshorts_transcription_engine") as TranscriptionEngine) || "local";
  });
  const [llmEngine, setLlmEngine] = useState<LlmEngine>(() => {
    return (localStorage.getItem("autoshorts_llm_engine") as LlmEngine) || "local";
  });
  const [localLlmModel, setLocalLlmModel] = useState(() => {
    return localStorage.getItem("autoshorts_local_llm_model") || "llama3.2";
  });
  const [lmstudioModel, setLmstudioModel] = useState(() => {
    return localStorage.getItem("autoshorts_lmstudio_model") || "";
  });
  const [lmstudioBaseUrl, setLmstudioBaseUrl] = useState(() => {
    return localStorage.getItem("autoshorts_lmstudio_base_url") || "http://127.0.0.1:1234/v1";
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

  const [whisperModel, setWhisperModel] = useState<string>(() => {
    return localStorage.getItem("autoshorts_whisper_model") || "large-v3-turbo";
  });
  const [whisperModelsList, setWhisperModelsList] = useState<WhisperModel[]>([]);
  const [customMomentsPrompt, setCustomMomentsPrompt] = useState<string>(() => {
    return localStorage.getItem("autoshorts_custom_moments_prompt") || "";
  });
  const [defaultMomentsPrompt, setDefaultMomentsPrompt] = useState<string>("");

  const [enableThinking, setEnableThinking] = useState<boolean>(() => {
    return localStorage.getItem("autoshorts_enable_thinking") === "true";
  });
  const [customOutputDir, setCustomOutputDir] = useState<string>(
    () => localStorage.getItem("autoshorts_output_dir") || ""
  );

  const [pullInputModel, setPullInputModel] = useState("");
  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [modelDownloadStatus, setModelDownloadStatus] = useState("");
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);

  const syncConfig = useCallback((updates: Record<string, any>) => {
    void invoke("save_app_config", updates);
  }, []);

  const canUseCloudKey = Boolean(environment?.hasDeepgramKey || deepgramKey.trim().length > 0);
  const canUseClaude = Boolean(environment?.hasAnthropicKey || anthropicKey.trim().length > 0);
  const canUseDeepseek = Boolean(environment?.hasDeepseekKey || deepseekKey.trim().length > 0);
  const canUseGemini = Boolean(environment?.hasGeminiKey || geminiKey.trim().length > 0);
  const canUseOpenai = Boolean(environment?.hasOpenaiKey || openaiKey.trim().length > 0);
  const canUseOpenrouter = Boolean(environment?.hasOpenrouterKey || openrouterKey.trim().length > 0);
  const canUseGroq = Boolean(environment?.hasGroqKey || groqKey.trim().length > 0);
  const canUseLmStudio = Boolean(environment?.hasLmStudio);

  const canTranscribe =
    transcriptionEngine === "local"
      ? Boolean(environment?.hasLocalWhisperModel)
      : canUseCloudKey;

  const canUseActiveLlm =
    llmEngine === "local"
      ? Boolean(environment?.hasOllama)
      : llmEngine === "lmstudio"
      ? canUseLmStudio
      : llmEngine === "openrouter"
      ? canUseOpenrouter
      : false;

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

  const handleResetConfig = () => {
    if (window.confirm("¿Seguro que deseas reiniciar la configuración y volver al asistente inicial?")) {
      localStorage.clear();
      void invoke("save_app_config", { onboarded: false });
      setIsOnboarded(false);
    }
  };

  // Initial load
  useEffect(() => {
    invoke<WhisperModel[]>("get_whisper_models")
      .then((models) => {
        if (Array.isArray(models) && models.length > 0) {
          setWhisperModelsList(models);
          const saved = localStorage.getItem("autoshorts_whisper_model");
          if (!saved) {
            const rec =
              models.find((m) => m.downloaded && m.id === "large-v3-turbo") ||
              models.find((m) => m.downloaded) ||
              models[0];
            if (rec) setWhisperModel(rec.id);
          }
        }
      })
      .catch(console.error);

    invoke<any>("get_default_moments_prompt")
      .then((prompt) => {
        if (typeof prompt === "string") {
          setDefaultMomentsPrompt(prompt);
        } else if (prompt && typeof prompt === "object" && typeof prompt.defaultPrompt === "string") {
          setDefaultMomentsPrompt(prompt.defaultPrompt);
        }
      })
      .catch(console.error);

    invoke<any>("get_app_config")
      .then((cfg) => {
        const localOnboarded = localStorage.getItem("autoshorts_onboarded");
        if (cfg?.onboarded || localOnboarded === "true") {
          setIsOnboarded(true);
          if (cfg?.transcriptionEngine) setTranscriptionEngine(cfg.transcriptionEngine);
          if (cfg?.whisperModel) setWhisperModel(cfg.whisperModel);
          if (cfg?.customMomentsPrompt !== undefined) setCustomMomentsPrompt(cfg.customMomentsPrompt);
          if (cfg?.llmEngine) setLlmEngine(cfg.llmEngine);
          if (cfg?.localLlmModel) setLocalLlmModel(cfg.localLlmModel);
          if (cfg?.lmstudioModel) setLmstudioModel(cfg.lmstudioModel);
          if (cfg?.lmstudioBaseUrl) setLmstudioBaseUrl(cfg.lmstudioBaseUrl);
          if (cfg?.deepseekKey) setDeepseekKey(cfg.deepseekKey);
          if (cfg?.deepseekModel) setDeepseekModel(cfg.deepseekModel);
          if (cfg?.anthropicKey) setAnthropicKey(cfg.anthropicKey);
          if (cfg?.openrouterKey) setOpenrouterKey(cfg.openrouterKey);
          if (cfg?.openrouterModel) setOpenrouterModel(cfg.openrouterModel);
          if (cfg?.deepgramKey) setDeepgramKey(cfg.deepgramKey);
          if (cfg?.openaiKey) setOpenaiKey(cfg.openaiKey);
          if (cfg?.groqKey) setGroqKey(cfg.groqKey);
          if (cfg?.geminiKey) setGeminiKey(cfg.geminiKey);
        } else {
          setIsOnboarded(false);
        }
      })
      .catch(() => {
        const value = localStorage.getItem("autoshorts_onboarded");
        setIsOnboarded(value === "true");
      });

    const fetchTelemetry = () => {
      invoke<HardwareTelemetry>("get_hardware_telemetry")
        .then((data) => {
          if (data && typeof data === "object") setTelemetry(data);
        })
        .catch(() => {});
    };
    fetchTelemetry();
    const intervalTelemetry = setInterval(fetchTelemetry, 2500);

    return () => {
      clearInterval(intervalTelemetry);
    };
  }, []);

  // Sync state to localStorage & backend
  useEffect(() => {
    localStorage.setItem("autoshorts_whisper_model", whisperModel);
    syncConfig({ whisperModel });
  }, [whisperModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_custom_moments_prompt", customMomentsPrompt);
    syncConfig({ customMomentsPrompt });
  }, [customMomentsPrompt, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_transcription_engine", transcriptionEngine);
    syncConfig({ transcriptionEngine });
  }, [transcriptionEngine, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_llm_engine", llmEngine);
    syncConfig({ llmEngine });
  }, [llmEngine, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_local_llm_model", localLlmModel);
    syncConfig({ localLlmModel });
  }, [localLlmModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_lmstudio_model", lmstudioModel);
    syncConfig({ lmstudioModel });
  }, [lmstudioModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_lmstudio_base_url", lmstudioBaseUrl);
    syncConfig({ lmstudioBaseUrl });
  }, [lmstudioBaseUrl, syncConfig]);

  useEffect(() => {
    if (environment?.installedLmStudioModels && environment.installedLmStudioModels.length > 0) {
      const installed = environment.installedLmStudioModels;
      if (!lmstudioModel || !installed.includes(lmstudioModel)) {
        setLmstudioModel(installed[0]);
        syncConfig({ lmstudioModel: installed[0] });
      }
    }
  }, [environment?.installedLmStudioModels, lmstudioModel, syncConfig]);

  useEffect(() => {
    if (environment?.installedOllamaModels && environment.installedOllamaModels.length > 0) {
      const installed = environment.installedOllamaModels;
      if (!installed.includes(localLlmModel)) {
        const preferred =
          installed.find((m) => m.includes("qwen3.5") || m.includes("qwen2.5") || m.includes("qwen")) ||
          installed[0];
        setLocalLlmModel(preferred);
        syncConfig({ localLlmModel: preferred });
      }
    }
  }, [environment?.installedOllamaModels, localLlmModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepgram_key", deepgramKey);
    syncConfig({ deepgramKey });
  }, [deepgramKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_anthropic_key", anthropicKey);
    syncConfig({ anthropicKey });
  }, [anthropicKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepseek_key", deepseekKey);
    syncConfig({ deepseekKey });
  }, [deepseekKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_deepseek_model", deepseekModel);
    syncConfig({ deepseekModel });
  }, [deepseekModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_gemini_key", geminiKey);
    syncConfig({ geminiKey });
  }, [geminiKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openai_key", openaiKey);
    syncConfig({ openaiKey });
  }, [openaiKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openrouter_key", openrouterKey);
    syncConfig({ openrouterKey });
  }, [openrouterKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_groq_key", groqKey);
    syncConfig({ groqKey });
  }, [groqKey, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_openrouter_model", openrouterModel);
    syncConfig({ openrouterModel });
  }, [openrouterModel, syncConfig]);

  useEffect(() => {
    localStorage.setItem("autoshorts_output_dir", customOutputDir);
  }, [customOutputDir]);

  useEffect(() => {
    localStorage.setItem("autoshorts_enable_thinking", enableThinking ? "true" : "false");
  }, [enableThinking]);

  return {
    environment,
    setEnvironment,
    telemetry,
    isOnboarded,
    setIsOnboarded,
    handleResetConfig,
    transcriptionEngine,
    setTranscriptionEngine,
    llmEngine,
    setLlmEngine,
    localLlmModel,
    setLocalLlmModel,
    lmstudioModel,
    setLmstudioModel,
    lmstudioBaseUrl,
    setLmstudioBaseUrl,
    deepgramKey,
    setDeepgramKey,
    anthropicKey,
    setAnthropicKey,
    deepseekKey,
    setDeepseekKey,
    deepseekModel,
    setDeepseekModel,
    geminiKey,
    setGeminiKey,
    openaiKey,
    setOpenaiKey,
    openrouterKey,
    setOpenrouterKey,
    groqKey,
    setGroqKey,
    openrouterModel,
    setOpenrouterModel,
    whisperModel,
    setWhisperModel,
    whisperModelsList,
    customMomentsPrompt,
    setCustomMomentsPrompt,
    defaultMomentsPrompt,
    enableThinking,
    setEnableThinking,
    customOutputDir,
    setCustomOutputDir,
    pullInputModel,
    setPullInputModel,
    downloadingModelName,
    modelDownloadStatus,
    modelDownloadProgress,
    pullModelDirectly,
    syncConfig,
    canUseCloudKey,
    canUseClaude,
    canUseDeepseek,
    canUseGemini,
    canUseOpenai,
    canUseOpenrouter,
    canUseGroq,
    canUseLmStudio,
    canTranscribe,
    canUseActiveLlm,
  };
}
