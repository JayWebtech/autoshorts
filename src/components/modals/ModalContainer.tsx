import React from "react";
import type {
  BusyState,
  Candidate,
  ContentType,
  CopyResult,
  EnvironmentStatus,
  HardwareTelemetry,
  LlmEngine,
  ProjectDetail,
  TargetDuration,
  TranscriptionEngine,
  WhisperModel,
} from "../../types";

import { SettingsPanel } from "./SettingsPanel";
import { StyleModal } from "./StyleModal";
import { SocialCopyModal } from "./SocialCopyModal";
import { QuickCopyModal } from "./QuickCopyModal";
import { CandidatePreviewModal } from "./CandidatePreviewModal";
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
  environment: EnvironmentStatus | null;
  onRefreshEnv: () => Promise<void>;
  pullInputModel: string;
  setPullInputModel: (val: string) => void;
  downloadingModelName: string | null;
  modelDownloadStatus: string;
  modelDownloadProgress: number;
  onPullModel: (model: string) => Promise<void>;
  customMomentsPrompt: string;
  setCustomMomentsPrompt: (val: string) => void;
  defaultMomentsPrompt: string;
  syncConfig: (updates: Record<string, any>) => void;
  onResetConfig: () => void;

  // Capabilities
  canUseLmStudio: boolean;

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
  onToggleDismissed?: (candidateId: string, dismissed: boolean) => Promise<void>;
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
        environment={props.environment}
        onRefreshEnv={props.onRefreshEnv}
        pullInputModel={props.pullInputModel}
        setPullInputModel={props.setPullInputModel}
        downloadingModelName={props.downloadingModelName}
        modelDownloadStatus={props.modelDownloadStatus}
        modelDownloadProgress={props.modelDownloadProgress}
        onPullModel={props.onPullModel}
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
        onToggleDismissed={props.onToggleDismissed}
      />

      <ModelDownloadModal
        downloadingModelName={props.downloadingModelName}
        modelDownloadProgress={props.modelDownloadProgress}
        modelDownloadStatus={props.modelDownloadStatus}
      />
    </>
  );
}
