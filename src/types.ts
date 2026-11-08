export type WhisperModel = {
  id: string;
  name: string;
  vram: string;
  downloaded: boolean;
  recommended: boolean;
  desc: string;
};

export const DEFAULT_WHISPER_MODELS: WhisperModel[] = [
  {
    id: "large-v3-turbo",
    name: "large-v3-turbo",
    vram: "~3.2 GB",
    downloaded: false,
    recommended: true,
    desc: "Alta precisión y velocidad máxima optimizada (Faster Turbo)",
  },
  {
    id: "large-v3",
    name: "large-v3",
    vram: "~4.5 GB",
    downloaded: false,
    recommended: false,
    desc: "Máxima precisión absoluta en acentos y jerga gamer",
  },
  {
    id: "medium",
    name: "medium",
    vram: "~2.5 GB",
    downloaded: false,
    recommended: false,
    desc: "Gran precisión en diálogos y fondos ruidosos",
  },
  {
    id: "small",
    name: "small",
    vram: "~1.2 GB",
    downloaded: false,
    recommended: false,
    desc: "Equilibrado para transcripción ágil en hardware estándar",
  },
  {
    id: "base",
    name: "base",
    vram: "~0.7 GB",
    downloaded: false,
    recommended: false,
    desc: "Rápido y ligero para pruebas o equipos modestos",
  },
  {
    id: "tiny",
    name: "tiny",
    vram: "~0.5 GB",
    downloaded: false,
    recommended: false,
    desc: "Ultrarrápido y mínimo consumo de memoria",
  },
];

export type CopyResult = {
  hooks: string[];
  caption: string;
  cta: string;
  hashtags: string[];
  full_copy: string;
};

export type EnvironmentStatus = {
  dataDir: string;
  hasFfmpeg: boolean;
  hasFfprobe: boolean;
  llmProvider: string;
  hasLocalWhisperModel: boolean;
  hasOllama: boolean;
  hasLmStudio?: boolean;
  installedOllamaModels?: string[];
  installedLmStudioModels?: string[];
  whisperModels?: WhisperModel[];
};

export type Project = {
  id: string;
  name: string | null;
  sourcePath: string;
  sourceDuration: number | null;
  status: string;
  transcriptionMode: string;
  captionStyle?: string | null;
  aspectRatio?: string | null;
  sourceExists?: boolean;
  sourceWidth?: number;
  sourceHeight?: number;
  nativeAspectRatio?: string;
  projectDir?: string | null;
  workflowGoal?: "clips";
  createdAt: string;
  updatedAt: string;
};

export type Transcript = {
  id: string;
  projectId: string;
  engine: string;
  rawJson: string;
  language: string | null;
  createdAt: string;
};

export type ViralityBreakdown = {
  hook_score: number;
  engagement_score: number;
  value_score: number;
  shareability_score: number;
  total_score: number;
  hook_type?: string;
};

export type Candidate = {
  id: string;
  projectId: string;
  startSec: number;
  endSec: number;
  score: number;
  hook: string;
  rationale: string;
  description?: string;
  hookTitle?: string;
  virality?: ViralityBreakdown;
  rank: number;
  selected: boolean;
  dismissed?: boolean;
};

export type Clip = {
  id: string;
  candidateId: string;
  status: string;
  outputPath: string | null;
  faceTrackJson: string | null;
  captionAssPath: string | null;
  captionPath?: string | null;
  renderLog: string | null;
};

export type ProjectDetail = {
  project: Project;
  transcript: Transcript | null;
  candidates: Candidate[];
  clips: Clip[];
};

export type NormalizedTranscript = {
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

export type BusyState =
  | "idle"
  | "import"
  | "transcribe"
  | "demoTranscript"
  | "moments"
  | "clipCount"
  | "cut";

export type TargetDuration = "30s" | "60s" | "2m" | "3m" | "5m" | "10m" | "15m";

export type GamingSubgenre =
  | "competitive"
  | "campaign"
  | "souls_rage"
  | "rhythmic"
  | "horror"
  | "sandbox"
  | "general_gaming";

export type AspectRatioOption = "original" | "16:9" | "9:16";

export type ContentType = "gaming" | "tutorial" | "podcast" | "general";

export type TranscriptionEngine = "local" | "faster-whisper";

export type LlmEngine = "local" | "ollama" | "lmstudio";

export type HardwareTelemetry = {
  hasGpu: boolean;
  gpuName: string;
  gpuUsagePercent: number;
  gpuTempC: number;
  vramTotalMb: number;
  vramUsedMb: number;
  vramFreeMb: number;
  vramUsagePercent: number;
  cpuUsagePercent: number;
};

export type LlmMemoryStatus = {
  isLoaded: boolean;
  loadedModel: string | null;
  provider: "ollama" | "lmstudio" | string | null;
  sizeMb: number | null;
  keepModelLoaded: boolean;
  details?: Array<{ name: string; sizeMb: number }>;
  success?: boolean;
  error?: string | null;
};
