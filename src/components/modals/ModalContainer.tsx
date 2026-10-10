import React from "react";
import { invoke } from "../../apiBridge";
import type {
  BusyState,
  Candidate,
  ContentType,
  CopyResult,
  EnvironmentStatus,
  HardwareTelemetry,
  LlmEngine,
  ProjectDetail,
  SummaryResult,
  AutoEditResult,
  AutoEditAssemblyStyle,
  AutoEditAspectRatio,
  TargetDuration,
  TranscriptionEngine,
  WhisperModel,
} from "../../types";

import { SettingsPanel } from "./SettingsPanel";
import { StyleModal } from "./StyleModal";
import { SocialCopyModal } from "./SocialCopyModal";
import { QuickCopyModal } from "./QuickCopyModal";
import { CandidatePreviewModal } from "./CandidatePreviewModal";
import { YouTubeImportModal } from "./YouTubeImportModal";
import { SummaryModal } from "./SummaryModal";
import { AutoEditModal } from "./AutoEditModal";
import { ModelDownloadModal } from "./ModelDownloadModal";

export interface ModalContainerProps {
  // Settings
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  telemetry: HardwareTelemetry | null;
  transcriptionEngine: TranscriptionEngine;
  setTranscriptionEngine: (engine: TranscriptionEngine) => void;
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  whisperModelsList: WhisperModel[];
  llmEngine: LlmEngine;
  setLlmEngine: (engine: LlmEngine) => void;
  localLlmModel: string;
  setLocalLlmModel: (model: string) => void;
  lmstudioModel: string;
  setLmstudioModel: (model: string) => void;
  lmstudioBaseUrl: string;
  setLmstudioBaseUrl: (url: string) => void;
  enableThinking: boolean;
  setEnableThinking: (val: boolean | ((prev: boolean) => boolean)) => void;
  environment: EnvironmentStatus | null;
  onRefreshEnv: () => Promise<void>;
  pullInputModel: string;
  setPullInputModel: (val: string) => void;
  downloadingModelName: string | null;
  modelDownloadStatus: string;
  modelDownloadProgress: number;
  onPullModel: (model: string) => Promise<void>;
  openrouterKey: string;
  setOpenrouterKey: (val: string) => void;
  openrouterModel: string;
  setOpenrouterModel: (val: string) => void;
  deepseekKey: string;
  setDeepseekKey: (val: string) => void;
  deepseekModel: string;
  setDeepseekModel: (val: string) => void;
  anthropicKey: string;
  setAnthropicKey: (val: string) => void;
  openaiKey: string;
  setOpenaiKey: (val: string) => void;
  groqKey: string;
  setGroqKey: (val: string) => void;
  geminiKey: string;
  setGeminiKey: (val: string) => void;
  deepgramKey: string;
  setDeepgramKey: (val: string) => void;
  customMomentsPrompt: string;
  setCustomMomentsPrompt: (val: string) => void;
  defaultMomentsPrompt: string;
  syncConfig: (updates: Record<string, any>) => void;
  onResetConfig: () => void;

  // Capabilities
  canUseLmStudio: boolean;
  canUseDeepseek: boolean;
  canUseClaude: boolean;
  canUseOpenai: boolean;
  canUseGroq: boolean;
  canUseGemini: boolean;
  canUseOpenrouter: boolean;

  // Import / Style Modal
  showStyleModal: boolean;
  setShowStyleModal: (show: boolean) => void;
  setMediaPathToImport: (path: string | null) => void;
  selectedStyle: string;
  setSelectedStyle: (style: string) => void;
  selectedContentType: ContentType;
  setSelectedContentType: (type: ContentType) => void;
  targetDuration: TargetDuration;
  setTargetDuration: (dur: TargetDuration) => void;
  importModalTab: "subtitles" | "ai";
  setImportModalTab: (tab: "subtitles" | "ai") => void;
  autoTranscribeOnImport: boolean;
  setAutoTranscribeOnImport: (val: boolean) => void;
  refineTranscriptWithLlm: boolean;
  setRefineTranscriptWithLlm: (val: boolean) => void;
  autoDetectMoments: boolean;
  setAutoDetectMoments: (val: boolean) => void;
  customProjectDir: string;
  onSelectProjectDir: () => Promise<void>;
  moveSourceVideo: boolean;
  setMoveSourceVideo: (val: boolean) => void;
  onConfirmImport: () => Promise<void>;

  // Social Copy Modal
  showCopyModal: boolean;
  setShowCopyModal: (show: boolean) => void;
  isGeneratingCopy: boolean;
  copyResult: CopyResult | null;
  copyExtraContext: string;
  setCopyExtraContext: (val: string) => void;
  onGenerateSocialCopy: (extraContextOverride?: string) => Promise<void>;
  copiedField: string | null;
  onCopyText: (key: string, text: string) => void;

  // Quick Copy Modal
  showQuickCopyModal: boolean;
  setShowQuickCopyModal: (show: boolean) => void;

  // Candidate Preview Modal
  previewCandidate: Candidate | null;
  setPreviewCandidate: (cand: Candidate | null) => void;
  detail: ProjectDetail | null;
  trimStart: number;
  setTrimStart: (val: number | ((prev: number) => number)) => void;
  trimEnd: number;
  setTrimEnd: (val: number | ((prev: number) => number)) => void;
  isSavingTrim: boolean;
  onSaveTrim: () => Promise<void>;
  onCutCandidate: (candidateId: string, options?: any) => Promise<void>;
  clipByCandidate: Map<string, any>;
  busy: BusyState;

  // YouTube Modal
  youtubeModalOpen: boolean;
  setYoutubeModalOpen: (val: boolean) => void;
  youtubeUrl: string;
  setYoutubeUrl: (val: string) => void;
  youtubeStatus: "idle" | "checking" | "warning" | "downloading";
  youtubeWarningLicense: string | null;
  onCheckAndDownloadYoutube: () => Promise<void>;
  onConfirmDownloadYoutubeRisk: () => Promise<void>;

  // Summary Modal
  showSummaryModal: boolean;
  setShowSummaryModal: (val: boolean) => void;
  summaryTargetMinutes: number;
  setSummaryTargetMinutes: (val: number) => void;
  summaryAspectRatio: "original" | "9:16";
  setSummaryAspectRatio: (val: "original" | "9:16") => void;
  summaryVibe: "balanced" | "tryhard" | "funny";
  setSummaryVibe: (val: "balanced" | "tryhard" | "funny") => void;
  summaryStatus: "idle" | "rendering" | "done";
  setSummaryStatus: (val: "idle" | "rendering" | "done") => void;
  summaryProgressMsg: string;
  summaryResult: SummaryResult | null;
  setSummaryResult: (res: SummaryResult | null) => void;
  customOutputDir: string;
  onGenerateSummary: () => Promise<void>;
  copiedChapters: boolean;
  setCopiedChapters: (val: boolean) => void;

  // AutoEdit Modal
  showAutoEditModal: boolean;
  setShowAutoEditModal: (val: boolean) => void;
  autoEditFormatMode: "youtube" | "shorts";
  setAutoEditFormatMode: (mode: "youtube" | "shorts") => void;
  autoEditTargetMinutes: number;
  setAutoEditTargetMinutes: (val: number) => void;
  autoEditAspectRatio: AutoEditAspectRatio;
  setAutoEditAspectRatio: (val: AutoEditAspectRatio) => void;
  autoEditAssemblyStyle: AutoEditAssemblyStyle;
  setAutoEditAssemblyStyle: (val: AutoEditAssemblyStyle) => void;
  autoEditIncludeTeaser: boolean;
  setAutoEditIncludeTeaser: (val: boolean) => void;
  autoEditTrimSilences: boolean;
  setAutoEditTrimSilences: (val: boolean) => void;
  autoEditStatus: "idle" | "rendering" | "done";
  autoEditProgressMsg: string;
  autoEditProgressPct: number;
  autoEditResult: AutoEditResult | null;
  onStartAutoEdit: () => Promise<void>;
  onCancelAutoEdit: () => Promise<void>;
}

export function ModalContainer(props: ModalContainerProps) {
  return (
    <>
      <SettingsPanel
        isOpen={props.showSettings}
        onClose={() => props.setShowSettings(false)}
        telemetry={props.telemetry}
        transcriptionEngine={props.transcriptionEngine}
        setTranscriptionEngine={props.setTranscriptionEngine}
        whisperModel={props.whisperModel}
        setWhisperModel={props.setWhisperModel}
        whisperModelsList={props.whisperModelsList}
        llmEngine={props.llmEngine}
        setLlmEngine={props.setLlmEngine}
        localLlmModel={props.localLlmModel}
        setLocalLlmModel={props.setLocalLlmModel}
        lmstudioModel={props.lmstudioModel}
        setLmstudioModel={props.setLmstudioModel}
        lmstudioBaseUrl={props.lmstudioBaseUrl}
        setLmstudioBaseUrl={props.setLmstudioBaseUrl}
        enableThinking={props.enableThinking}
        setEnableThinking={props.setEnableThinking}
        environment={props.environment}
        onRefreshEnv={props.onRefreshEnv}
        pullInputModel={props.pullInputModel}
        setPullInputModel={props.setPullInputModel}
        downloadingModelName={props.downloadingModelName}
        modelDownloadStatus={props.modelDownloadStatus}
        modelDownloadProgress={props.modelDownloadProgress}
        onPullModel={props.onPullModel}
        openrouterKey={props.openrouterKey}
        setOpenrouterKey={props.setOpenrouterKey}
        openrouterModel={props.openrouterModel}
        setOpenrouterModel={props.setOpenrouterModel}
        deepseekKey={props.deepseekKey}
        setDeepseekKey={props.setDeepseekKey}
        deepseekModel={props.deepseekModel}
        setDeepseekModel={props.setDeepseekModel}
        anthropicKey={props.anthropicKey}
        setAnthropicKey={props.setAnthropicKey}
        openaiKey={props.openaiKey}
        setOpenaiKey={props.setOpenaiKey}
        groqKey={props.groqKey}
        setGroqKey={props.setGroqKey}
        geminiKey={props.geminiKey}
        setGeminiKey={props.setGeminiKey}
        deepgramKey={props.deepgramKey}
        setDeepgramKey={props.setDeepgramKey}
        customMomentsPrompt={props.customMomentsPrompt}
        setCustomMomentsPrompt={props.setCustomMomentsPrompt}
        defaultMomentsPrompt={props.defaultMomentsPrompt}
        syncConfig={props.syncConfig}
        onResetConfig={props.onResetConfig}
      />

      <StyleModal
        isOpen={props.showStyleModal}
        onClose={() => {
          props.setShowStyleModal(false);
          props.setMediaPathToImport(null);
        }}
        telemetry={props.telemetry}
        selectedStyle={props.selectedStyle}
        setSelectedStyle={props.setSelectedStyle}
        selectedContentType={props.selectedContentType}
        setSelectedContentType={props.setSelectedContentType}
        targetDuration={props.targetDuration}
        setTargetDuration={props.setTargetDuration}
        importModalTab={props.importModalTab}
        setImportModalTab={props.setImportModalTab}
        llmEngine={props.llmEngine}
        setLlmEngine={props.setLlmEngine}
        localLlmModel={props.localLlmModel}
        setLocalLlmModel={props.setLocalLlmModel}
        lmstudioModel={props.lmstudioModel}
        setLmstudioModel={props.setLmstudioModel}
        canUseLmStudio={props.canUseLmStudio}
        deepseekModel={props.deepseekModel}
        setDeepseekModel={props.setDeepseekModel}
        openrouterModel={props.openrouterModel}
        setOpenrouterModel={props.setOpenrouterModel}
        canUseDeepseek={props.canUseDeepseek}
        canUseClaude={props.canUseClaude}
        canUseOpenai={props.canUseOpenai}
        canUseGroq={props.canUseGroq}
        canUseGemini={props.canUseGemini}
        canUseOpenrouter={props.canUseOpenrouter}
        transcriptionEngine={props.transcriptionEngine}
        whisperModel={props.whisperModel}
        setWhisperModel={props.setWhisperModel}
        whisperModelsList={props.whisperModelsList}
        autoTranscribeOnImport={props.autoTranscribeOnImport}
        setAutoTranscribeOnImport={props.setAutoTranscribeOnImport}
        refineTranscriptWithLlm={props.refineTranscriptWithLlm}
        setRefineTranscriptWithLlm={props.setRefineTranscriptWithLlm}
        autoDetectMoments={props.autoDetectMoments}
        setAutoDetectMoments={props.setAutoDetectMoments}
        enableThinking={props.enableThinking}
        setEnableThinking={props.setEnableThinking}
        customProjectDir={props.customProjectDir}
        onSelectProjectDir={props.onSelectProjectDir}
        moveSourceVideo={props.moveSourceVideo}
        setMoveSourceVideo={props.setMoveSourceVideo}
        environment={props.environment}
        onOpenSettings={() => {
          props.setShowStyleModal(false);
          props.setShowSettings(true);
        }}
        onConfirm={props.onConfirmImport}
      />

      <SocialCopyModal
        isOpen={props.showCopyModal}
        onClose={() => props.setShowCopyModal(false)}
        isGeneratingCopy={props.isGeneratingCopy}
        copyResult={props.copyResult}
        llmEngine={props.llmEngine}
        localLlmModel={props.localLlmModel}
        copyExtraContext={props.copyExtraContext}
        setCopyExtraContext={props.setCopyExtraContext}
        onGenerateCopy={props.onGenerateSocialCopy}
        copiedField={props.copiedField}
        onCopyText={props.onCopyText}
      />

      <QuickCopyModal
        isOpen={props.showQuickCopyModal}
        onClose={() => props.setShowQuickCopyModal(false)}
        llmEngine={props.llmEngine}
        localLlmModel={props.localLlmModel}
        lmstudioModel={props.lmstudioModel}
        openrouterKey={props.openrouterKey}
        openrouterModel={props.openrouterModel}
        enableThinking={props.enableThinking}
      />

      <CandidatePreviewModal
        candidate={props.previewCandidate}
        detail={props.detail}
        onClose={() => props.setPreviewCandidate(null)}
        trimStart={props.trimStart}
        setTrimStart={props.setTrimStart}
        trimEnd={props.trimEnd}
        setTrimEnd={props.setTrimEnd}
        isSavingTrim={props.isSavingTrim}
        onSaveTrim={props.onSaveTrim}
        onCutCandidate={props.onCutCandidate}
        clipByCandidate={props.clipByCandidate}
        busy={props.busy}
      />

      <ModelDownloadModal
        downloadingModelName={props.downloadingModelName}
        modelDownloadProgress={props.modelDownloadProgress}
        modelDownloadStatus={props.modelDownloadStatus}
      />

      <YouTubeImportModal
        isOpen={props.youtubeModalOpen}
        onClose={() => {
          props.setYoutubeModalOpen(false);
          props.setYoutubeUrl("");
        }}
        youtubeUrl={props.youtubeUrl}
        setYoutubeUrl={props.setYoutubeUrl}
        youtubeStatus={props.youtubeStatus}
        youtubeWarningLicense={props.youtubeWarningLicense}
        onCheckAndDownload={props.onCheckAndDownloadYoutube}
        onConfirmDownloadRisk={props.onConfirmDownloadYoutubeRisk}
      />

      {props.showSummaryModal && props.detail && (
        <SummaryModal
          isOpen={props.showSummaryModal}
          onClose={() => {
            if (props.summaryStatus !== "rendering") {
              props.setShowSummaryModal(false);
              props.setSummaryStatus("idle");
            }
          }}
          detail={props.detail}
          summaryTargetMinutes={props.summaryTargetMinutes}
          setSummaryTargetMinutes={props.setSummaryTargetMinutes}
          summaryAspectRatio={props.summaryAspectRatio}
          setSummaryAspectRatio={props.setSummaryAspectRatio}
          summaryVibe={props.summaryVibe}
          setSummaryVibe={props.setSummaryVibe}
          summaryStatus={props.summaryStatus}
          setSummaryStatus={props.setSummaryStatus}
          summaryProgressMsg={props.summaryProgressMsg}
          summaryResult={props.summaryResult}
          setSummaryResult={props.setSummaryResult}
          customOutputDir={props.customOutputDir}
          onGenerateSummary={props.onGenerateSummary}
          copiedChapters={props.copiedChapters}
          setCopiedChapters={props.setCopiedChapters}
        />
      )}

      {props.showAutoEditModal && props.detail && (
        <AutoEditModal
          isOpen={props.showAutoEditModal}
          onClose={() => {
            if (props.autoEditStatus !== "rendering") {
              props.setShowAutoEditModal(false);
            }
          }}
          project={props.detail.project}
          candidateCount={props.detail.candidates.length}
          formatMode={props.autoEditFormatMode}
          setFormatMode={props.setAutoEditFormatMode}
          targetMinutes={props.autoEditTargetMinutes}
          setTargetMinutes={props.setAutoEditTargetMinutes}
          aspectRatio={props.autoEditAspectRatio}
          setAspectRatio={props.setAutoEditAspectRatio}
          assemblyStyle={props.autoEditAssemblyStyle}
          setAssemblyStyle={props.setAutoEditAssemblyStyle}
          includeTeaser={props.autoEditIncludeTeaser}
          setIncludeTeaser={props.setAutoEditIncludeTeaser}
          trimSilences={props.autoEditTrimSilences}
          setTrimSilences={props.setAutoEditTrimSilences}
          status={props.autoEditStatus}
          progressMsg={props.autoEditProgressMsg}
          progressPct={props.autoEditProgressPct}
          result={props.autoEditResult}
          onStartAutoEdit={props.onStartAutoEdit}
          onCancelAutoEdit={props.onCancelAutoEdit}
          onOpenFolder={(dir) => void invoke("open_folder", { path: dir })}
          onOpenFile={(filePath) => void invoke("open_media_file", { path: filePath })}
        />
      )}
    </>
  );
}
