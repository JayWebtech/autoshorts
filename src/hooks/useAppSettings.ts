import { useState, useEffect, useCallback } from "react";
import { invoke, listen } from "../apiBridge";
import {
  DEFAULT_WHISPER_MODELS,
  type EnvironmentStatus,
  type HardwareTelemetry,
  type LlmEngine,
  type LlmMemoryStatus,
  type TranscriptionEngine,
  type WhisperModel,
} from "../types";

export const DEFAULT_MOMENTS_PROMPT = `Eres un Editor de Video de Alto Rendimiento y Experto en Retención para TikTok, YouTube Shorts y Reels. Tu misión es analizar la transcripción con marcas de tiempo y extraer exclusivamente los momentos con mayor potencial de viralidad.

Criterios de selección obligatorios:
1. Ganchos de Alto Impacto: Frases polémicas, preguntas intrigantes, remates o revelaciones clave en los primeros 3 segundos.
2. Picos Emocionales y Gameplay: Momentos que describan jugadas destacadas, clutches, risas contagiosas, gritos, enfados (rage quits), sustos o celebraciones.
3. Contenido Narrativo y Humor: Fails cómicos, anécdotas rápidas, debates intensos o explicaciones de alto valor simplificadas.

Reglas estrictas de segmentación:
- Auto-conclusión: El clip debe tener un inicio claro, un desarrollo completo y un remate o conclusión lógica. No debe requerir contexto externo.
- Cortes limpios: Nunca cortes una palabra o frase a la mitad. Usa los silencios o pausas naturales como puntos de corte.
- Exclusiones: Ignora introducciones lentas, transiciones silenciosas, pausas largas de lectura y segmentos puramente promocionales.`;

export function useAppSettings() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [telemetry, setTelemetry] = useState<HardwareTelemetry | null>(null);

  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngine>(() => {
    return (localStorage.getItem("autoshorts_transcription_engine") as TranscriptionEngine) || "local";
  });
  const [llmEngine, setLlmEngine] = useState<LlmEngine>(() => {
    return (localStorage.getItem("autoshorts_llm_engine") as LlmEngine) || "local";
  });
  const [localLlmModel, setLocalLlmModel] = useState(() => {
    return localStorage.getItem("autoshorts_local_llm_model") || "qwen2.5:7b";
  });
  const [lmstudioModel, setLmstudioModel] = useState(() => {
    return localStorage.getItem("autoshorts_lmstudio_model") || "";
  });
  const [lmstudioBaseUrl, setLmstudioBaseUrl] = useState(() => {
    return localStorage.getItem("autoshorts_lmstudio_base_url") || "http://127.0.0.1:1234/v1";
  });

  const [whisperModel, setWhisperModel] = useState<string>(() => {
    return localStorage.getItem("autoshorts_whisper_model") || "large-v3-turbo";
  });
  const [whisperModelsList, setWhisperModelsList] = useState<WhisperModel[]>(DEFAULT_WHISPER_MODELS);

  // Sincronizar modelos reactivamente cuando el backend actualiza el estado de entorno
  useEffect(() => {
    if (environment?.whisperModels && environment.whisperModels.length > 0) {
      setWhisperModelsList(environment.whisperModels);
    }
  }, [environment]);
  const [customMomentsPrompt, setCustomMomentsPrompt] = useState<string>(() => {
    return localStorage.getItem("autoshorts_custom_moments_prompt") || "";
  });
  const [defaultMomentsPrompt, setDefaultMomentsPrompt] = useState<string>(DEFAULT_MOMENTS_PROMPT);

  const [enableThinking, setEnableThinking] = useState<boolean>(() => {
    return localStorage.getItem("autoshorts_enable_thinking") === "true";
  });
  const [customOutputDir, setCustomOutputDir] = useState<string>(
    () => localStorage.getItem("autoshorts_output_dir") || ""
  );
  const [autoTranscribeOnImport, setAutoTranscribeOnImport] = useState<boolean>(() => {
    const saved = localStorage.getItem("autoshorts_auto_transcribe_on_import");
    return saved !== null ? saved === "true" : true;
  });

  useEffect(() => {
    localStorage.setItem("autoshorts_auto_transcribe_on_import", String(autoTranscribeOnImport));
  }, [autoTranscribeOnImport]);

  const [pullInputModel, setPullInputModel] = useState("");
  const [downloadingModelName, setDownloadingModelName] = useState<string | null>(null);
  const [modelDownloadStatus, setModelDownloadStatus] = useState("");
  const [modelDownloadProgress, setModelDownloadProgress] = useState(0);

  const [llmMemoryStatus, setLlmMemoryStatus] = useState<LlmMemoryStatus | null>(null);
  const [keepModelLoaded, setKeepModelLoaded] = useState<boolean>(() => {
    return localStorage.getItem("autoshorts_keep_model_loaded") === "true";
  });
  const [isMemoryActionBusy, setIsMemoryActionBusy] = useState(false);

  const syncConfig = useCallback((updates: Record<string, any>) => {
    void invoke("save_app_config", updates);
  }, []);

  const canUseLmStudio = Boolean(environment?.hasLmStudio);
  const canTranscribe = Boolean(environment?.hasLocalWhisperModel);
  const canUseActiveLlm =
    llmEngine === "local"
      ? Boolean(environment?.hasOllama)
      : canUseLmStudio;

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
    if (window.confirm("¿Seguro que deseas restablecer la configuración por defecto?")) {
      localStorage.clear();
      void invoke("save_app_config", {
        llmEngine: "local",
        localLlmModel: "qwen2.5:7b",
        whisperModel: "large-v3-turbo",
      });
      setLlmEngine("local");
      setLocalLlmModel("qwen2.5:7b");
      setWhisperModel("large-v3-turbo");
      void refreshEnv();
    }
  };

  const refreshEnv = useCallback(async () => {
    try {
      const env = await invoke<EnvironmentStatus>("environment_status");
      setEnvironment(env);
      if (env.whisperModels) {
        setWhisperModelsList(env.whisperModels);
      }

      // Autodetección inteligente si el usuario no tiene fijado un motor válido o si el actual está caído
      const savedEngine = localStorage.getItem("autoshorts_llm_engine");
      const hasSavedEngine = savedEngine === "local" || savedEngine === "lmstudio";

      if (env.hasLmStudio && env.installedLmStudioModels && env.installedLmStudioModels.length > 0) {
        if (!hasSavedEngine || (savedEngine === "local" && !env.hasOllama)) {
          setLlmEngine("lmstudio");
          localStorage.setItem("autoshorts_llm_engine", "lmstudio");
          const savedLmModel = localStorage.getItem("autoshorts_lmstudio_model");
          if (!savedLmModel && env.installedLmStudioModels[0]) {
            setLmstudioModel(env.installedLmStudioModels[0]);
            localStorage.setItem("autoshorts_lmstudio_model", env.installedLmStudioModels[0]);
          }
        }
      } else if (env.hasOllama && env.installedOllamaModels && env.installedOllamaModels.length > 0) {
        if (!hasSavedEngine || (savedEngine === "lmstudio" && !env.hasLmStudio)) {
          setLlmEngine("local");
          localStorage.setItem("autoshorts_llm_engine", "local");
          const savedOllamaModel = localStorage.getItem("autoshorts_local_llm_model");
          if (!savedOllamaModel && env.installedOllamaModels[0]) {
            setLocalLlmModel(env.installedOllamaModels[0]);
            localStorage.setItem("autoshorts_local_llm_model", env.installedOllamaModels[0]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load environment status", err);
    }
  }, []);

  useEffect(() => {
    void refreshEnv();

    invoke<string>("get_default_moments_prompt")
      .then((p) => {
        if (p) setDefaultMomentsPrompt(p);
      })
      .catch(() => {});

    invoke<Record<string, any>>("get_app_config")
      .then((cfg) => {
        if (!cfg) return;
        if (cfg.whisperModel) setWhisperModel(cfg.whisperModel);
        if (cfg.llmEngine) setLlmEngine(cfg.llmEngine);
        if (cfg.localLlmModel) setLocalLlmModel(cfg.localLlmModel);
        if (cfg.lmstudioModel) setLmstudioModel(cfg.lmstudioModel);
        if (cfg.lmstudioBaseUrl) setLmstudioBaseUrl(cfg.lmstudioBaseUrl);
        if (cfg.customMomentsPrompt) setCustomMomentsPrompt(cfg.customMomentsPrompt);
      })
      .catch(() => {});

    const fetchTelemetry = () => {
      invoke<HardwareTelemetry>("get_hardware_telemetry")
        .then((data) => {
          if (data && typeof data === "object") setTelemetry(data);
        })
        .catch(() => {});
    };
    fetchTelemetry();
    const intervalTelemetry = setInterval(fetchTelemetry, 2500);

    const retryTimer1 = setTimeout(() => {
      void refreshEnv();
    }, 1200);
    const retryTimer2 = setTimeout(() => {
      void refreshEnv();
    }, 3500);

    return () => {
      clearInterval(intervalTelemetry);
      clearTimeout(retryTimer1);
      clearTimeout(retryTimer2);
    };
  }, [refreshEnv]);

  const fetchLlmMemoryStatus = useCallback(() => {
    invoke<LlmMemoryStatus>("get_llm_memory_status", {
      provider: llmEngine,
      lmstudioBaseUrl,
    })
      .then((status) => {
        if (status && typeof status === "object") {
          setLlmMemoryStatus(status);
          if (status.keepModelLoaded !== undefined) {
            setKeepModelLoaded(Boolean(status.keepModelLoaded));
          }
        }
      })
      .catch(() => {});
  }, [llmEngine, lmstudioBaseUrl]);

  useEffect(() => {
    fetchLlmMemoryStatus();
    const intervalMem = setInterval(fetchLlmMemoryStatus, 3500);
    return () => clearInterval(intervalMem);
  }, [fetchLlmMemoryStatus]);

  const toggleKeepModelLoaded = useCallback(
    async (enabled: boolean) => {
      setKeepModelLoaded(enabled);
      localStorage.setItem("autoshorts_keep_model_loaded", String(enabled));
      setIsMemoryActionBusy(true);
      try {
        const res = await invoke<LlmMemoryStatus>("set_keep_model_loaded", { enabled });
        if (res) setLlmMemoryStatus(res);
      } catch (err) {
        console.error("Error toggling keep model loaded:", err);
      } finally {
        setIsMemoryActionBusy(false);
      }
    },
    []
  );

  const preloadActiveModel = useCallback(async () => {
    setIsMemoryActionBusy(true);
    try {
      const activeModel =
        llmEngine === "lmstudio"
          ? lmstudioModel.trim() || undefined
          : localLlmModel.trim() || "qwen2.5:7b";
      const res = await invoke<LlmMemoryStatus>("preload_llm_model", {
        provider: llmEngine,
        modelName: activeModel,
        lmstudioBaseUrl,
      });
      if (res) setLlmMemoryStatus(res);
    } catch (err) {
      console.error("Error preloading model:", err);
    } finally {
      setIsMemoryActionBusy(false);
    }
  }, [llmEngine, localLlmModel, lmstudioModel, lmstudioBaseUrl]);

  const unloadActiveModel = useCallback(async () => {
    setIsMemoryActionBusy(true);
    try {
      const res = await invoke<LlmMemoryStatus>("unload_llm_model", {
        provider: llmEngine,
        lmstudioBaseUrl,
      });
      if (res) setLlmMemoryStatus(res);
    } catch (err) {
      console.error("Error unloading model:", err);
    } finally {
      setIsMemoryActionBusy(false);
    }
  }, [llmEngine, lmstudioBaseUrl]);

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
    localStorage.setItem("autoshorts_output_dir", customOutputDir);
  }, [customOutputDir]);

  useEffect(() => {
    localStorage.setItem("autoshorts_enable_thinking", enableThinking ? "true" : "false");
  }, [enableThinking]);

  return {
    environment,
    setEnvironment,
    telemetry,
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
    autoTranscribeOnImport,
    setAutoTranscribeOnImport,
    pullInputModel,
    setPullInputModel,
    downloadingModelName,
    modelDownloadStatus,
    modelDownloadProgress,
    pullModelDirectly,
    syncConfig,
    canUseLmStudio,
    canTranscribe,
    canUseActiveLlm,
    llmMemoryStatus,
    keepModelLoaded,
    isMemoryActionBusy,
    toggleKeepModelLoaded,
    preloadActiveModel,
    unloadActiveModel,
  };
}
