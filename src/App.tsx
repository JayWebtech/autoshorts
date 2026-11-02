import React, { useEffect, useState } from "react";
import { invoke } from "./apiBridge";
import { Loader2 } from "lucide-react";

// Hooks
import { useAppSettings } from "./hooks/useAppSettings";
import { useProjectActions } from "./hooks/useProjectActions";
import { useMediaPipeline } from "./hooks/useMediaPipeline";

// Panels
import { Sidebar } from "./components/panels/Sidebar";
import { WorkspaceHeader } from "./components/panels/WorkspaceHeader";
import { HomeDashboard } from "./components/panels/HomeDashboard";
import { TranscriptPanel } from "./components/panels/TranscriptPanel";
import { CandidatePanel } from "./components/panels/CandidatePanel";
import { StatusBar } from "./components/common/StatusBar";

// Modals
import { SettingsPanel } from "./components/modals/SettingsPanel";
import { ModalContainer } from "./components/modals/ModalContainer";
import { LogsModal } from "./components/modals/LogsModal";

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [activeView, setActiveView] = useState<"transcript" | "moments">("moments");

  // Reference for cross-hook callback to guarantee safe pipeline access
  const mediaPipelineRef = React.useRef<ReturnType<typeof useMediaPipeline> | null>(null);

  // 1. Settings & Persistence Hook
  const settings = useAppSettings();

  // 2. Project Actions & Workspace Hook
  const projectActions = useProjectActions({
    transcriptionEngine: settings.transcriptionEngine,
    setEnvironment: settings.setEnvironment,
    onAutoPipeline: async (projectId, contentType, dur) => {
      if (mediaPipelineRef.current) {
        await mediaPipelineRef.current.runAutoPipeline(projectId, contentType, dur);
      }
    },
    onProjectSelected: (projectId) => {
      if (!projectId) {
        setActiveView("moments");
      }
    },
  });

  // 3. Media Pipeline Hook (Transcription, LLM Moments, Cuts, Social Copy)
  const mediaPipeline = useMediaPipeline({
    detail: projectActions.detail,
    setDetail: projectActions.setDetail,
    refresh: projectActions.refresh,
    setError: projectActions.setError,
    busy: projectActions.busy,
    setBusy: projectActions.setBusy,
    transcriptionEngine: settings.transcriptionEngine,
    whisperModel: settings.whisperModel,
    llmEngine: settings.llmEngine,
    localLlmModel: settings.localLlmModel,
    lmstudioModel: settings.lmstudioModel,
    enableThinking: settings.enableThinking,
    customMomentsPrompt: settings.customMomentsPrompt,
    customOutputDir: settings.customOutputDir,
    selectedContentType: projectActions.selectedContentType,
    targetDuration: projectActions.targetDuration,
    autoDetectMoments: projectActions.autoDetectMoments,
    pullModelDirectly: settings.pullModelDirectly,
  });
  mediaPipelineRef.current = mediaPipeline;

  // Initial refresh
  useEffect(() => {
    void projectActions.refresh();
  }, []);

  const settingsNode = (
    <SettingsPanel
      isOpen={showSettings}
      onClose={() => setShowSettings(false)}
      telemetry={settings.telemetry}
      transcriptionEngine={settings.transcriptionEngine}
      setTranscriptionEngine={settings.setTranscriptionEngine}
      whisperModel={settings.whisperModel}
      setWhisperModel={settings.setWhisperModel}
      whisperModelsList={settings.whisperModelsList}
      llmEngine={settings.llmEngine}
      setLlmEngine={settings.setLlmEngine}
      localLlmModel={settings.localLlmModel}
      setLocalLlmModel={settings.setLocalLlmModel}
      lmstudioModel={settings.lmstudioModel}
      setLmstudioModel={settings.setLmstudioModel}
      lmstudioBaseUrl={settings.lmstudioBaseUrl}
      setLmstudioBaseUrl={settings.setLmstudioBaseUrl}
      enableThinking={settings.enableThinking}
      setEnableThinking={settings.setEnableThinking}
      environment={settings.environment}
      onRefreshEnv={() => projectActions.refresh(projectActions.detail?.project.id)}
      pullInputModel={settings.pullInputModel}
      setPullInputModel={settings.setPullInputModel}
      downloadingModelName={settings.downloadingModelName}
      modelDownloadStatus={settings.modelDownloadStatus}
      modelDownloadProgress={settings.modelDownloadProgress}
      onPullModel={settings.pullModelDirectly}
      customMomentsPrompt={settings.customMomentsPrompt}
      setCustomMomentsPrompt={settings.setCustomMomentsPrompt}
      defaultMomentsPrompt={settings.defaultMomentsPrompt}
      syncConfig={settings.syncConfig}
      onResetConfig={settings.handleResetConfig}
    />
  );

  return (
    <div className="app-shell-container">
      <main className="app-shell">
        <Sidebar
          projects={projectActions.projects}
          activeProjectId={projectActions.detail?.project.id ?? null}
          busy={projectActions.busy}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings(!showSettings)}
          showLogs={showLogs}
          onToggleLogs={() => setShowLogs(!showLogs)}
          onSelectProject={(id) => {
            if (id) void projectActions.selectProject(id);
            else void projectActions.selectProject(null);
          }}
          onImportMedia={projectActions.importMedia}
        />

        <section className="workspace">
          {projectActions.detail ? (
            <>
              <WorkspaceHeader
                detail={projectActions.detail}
                showSettings={showSettings}
                setShowSettings={setShowSettings}
                refresh={projectActions.refresh}
                toggleProjectCompleted={projectActions.toggleProjectCompleted}
                relinkProjectVideo={projectActions.relinkProjectVideo}
                onBackToDashboard={() => void projectActions.selectProject(null)}
                openProjectFolder={projectActions.openProjectFolder}
                moveProjectFolder={projectActions.moveProjectFolder}
                error={projectActions.error}
                selectedCount={mediaPipeline.selectedCount}
                selectedCutCount={mediaPipeline.selectedCutCount}
                selectedCaptionsCount={mediaPipeline.selectedCaptionsCount}
                activeView={activeView}
                onChangeView={setActiveView}
              />

              {activeView === "transcript" ? (
                <div className="work-full-container">
                  <TranscriptPanel
                    detail={projectActions.detail}
                    transcript={mediaPipeline.transcript}
                    busy={projectActions.busy}
                    transcriptionEngine={settings.transcriptionEngine}
                    canTranscribe={settings.canTranscribe}
                    isRefiningTranscript={mediaPipeline.isRefiningTranscript}
                    isDetectingActionCues={mediaPipeline.isDetectingActionCues}
                    transcriptionProgress={mediaPipeline.transcriptionProgress}
                    onTranscribe={mediaPipeline.transcribe}
                    onCancelTranscription={mediaPipeline.cancelTranscription}
                    onRefineTranscript={mediaPipeline.refineTranscript}
                    onDetectActionCues={mediaPipeline.detectActionCues}
                  />
                </div>
              ) : (
                <div className="work-full-container">
                  <CandidatePanel
                    detail={projectActions.detail}
                    selectedCount={mediaPipeline.selectedCount}
                    llmEngine={settings.llmEngine}
                    localLlmModel={settings.localLlmModel}
                    busy={projectActions.busy}
                    environment={settings.environment}
                    canUseActiveLlm={settings.canUseActiveLlm}
                    targetDuration={projectActions.targetDuration}
                    setTargetDuration={projectActions.setTargetDuration}
                    enableThinking={settings.enableThinking}
                    setEnableThinking={settings.setEnableThinking}
                    cutSelected={mediaPipeline.cutSelected}
                    cancelMoments={mediaPipeline.cancelMoments}
                    moments={mediaPipeline.moments}
                    updateClipCount={mediaPipeline.updateClipCount}
                    toggleCandidateDismissed={mediaPipeline.toggleCandidateDismissed}
                    clipByCandidate={mediaPipeline.clipByCandidate}
                    copiedDescId={mediaPipeline.copiedDescId}
                    copyDescription={mediaPipeline.copyDescription}
                    openCandidatePreview={mediaPipeline.openCandidatePreview}
                    cutCandidate={mediaPipeline.cutCandidate}
                    renderingCandidateId={mediaPipeline.renderingCandidateId}
                    candidateProgress={mediaPipeline.candidateProgress}
                    aspectRatio={mediaPipeline.clipAspectRatio}
                    setAspectRatio={mediaPipeline.setClipAspectRatio}
                    regenerateCandidateCopy={mediaPipeline.regenerateCandidateCopy}
                    regeneratingCopyCandidateId={mediaPipeline.regeneratingCopyCandidateId}
                    llmMemoryStatus={settings.llmMemoryStatus}
                    keepModelLoaded={settings.keepModelLoaded}
                    toggleKeepModelLoaded={settings.toggleKeepModelLoaded}
                    preloadActiveModel={settings.preloadActiveModel}
                    unloadActiveModel={settings.unloadActiveModel}
                    isMemoryActionBusy={settings.isMemoryActionBusy}
                  />
                </div>
              )}
            </>
          ) : (
            <HomeDashboard
              projects={projectActions.projects}
              busy={projectActions.busy}
              environment={settings.environment}
              showSettings={showSettings}
              setShowSettings={setShowSettings}
              importMedia={projectActions.importMedia}
              openExistingProject={projectActions.openExistingProject}
              selectProject={projectActions.selectProject}
              renameProject={projectActions.renameProject}
              deleteProject={projectActions.deleteProject}
              toggleProjectCompleted={projectActions.toggleProjectCompleted}
              relinkProjectVideo={projectActions.relinkProjectVideo}
              openProjectFolder={projectActions.openProjectFolder}
              onOpenQuickCopy={() => mediaPipeline.setShowQuickCopyModal(true)}
              settingsNode={settingsNode}
            />
          )}
        </section>
      </main>

      <StatusBar
        environment={settings.environment}
        telemetry={settings.telemetry}
        llmMemoryStatus={settings.llmMemoryStatus}
        onUnloadLlm={settings.unloadActiveModel}
        onOpenSettings={() => setShowSettings(true)}
        onOpenLogs={() => setShowLogs(true)}
      />

      <ModalContainer
        // Settings
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        telemetry={settings.telemetry}
        transcriptionEngine={settings.transcriptionEngine}
        setTranscriptionEngine={settings.setTranscriptionEngine}
        whisperModel={settings.whisperModel}
        setWhisperModel={settings.setWhisperModel}
        whisperModelsList={settings.whisperModelsList}
        llmEngine={settings.llmEngine}
        setLlmEngine={settings.setLlmEngine}
        localLlmModel={settings.localLlmModel}
        setLocalLlmModel={settings.setLocalLlmModel}
        lmstudioModel={settings.lmstudioModel}
        setLmstudioModel={settings.setLmstudioModel}
        lmstudioBaseUrl={settings.lmstudioBaseUrl}
        setLmstudioBaseUrl={settings.setLmstudioBaseUrl}
        enableThinking={settings.enableThinking}
        setEnableThinking={settings.setEnableThinking}
        environment={settings.environment}
        onRefreshEnv={() => projectActions.refresh(projectActions.detail?.project.id)}
        pullInputModel={settings.pullInputModel}
        setPullInputModel={settings.setPullInputModel}
        downloadingModelName={settings.downloadingModelName}
        modelDownloadStatus={settings.modelDownloadStatus}
        modelDownloadProgress={settings.modelDownloadProgress}
        onPullModel={settings.pullModelDirectly}
        customMomentsPrompt={settings.customMomentsPrompt}
        setCustomMomentsPrompt={settings.setCustomMomentsPrompt}
        defaultMomentsPrompt={settings.defaultMomentsPrompt}
        syncConfig={settings.syncConfig}
        onResetConfig={settings.handleResetConfig}
        // Capabilities
        canUseLmStudio={settings.canUseLmStudio}
        // Import / Style Modal
        showStyleModal={projectActions.showStyleModal}
        setShowStyleModal={projectActions.setShowStyleModal}
        setMediaPathToImport={projectActions.setMediaPathToImport}
        selectedStyle={projectActions.selectedStyle}
        setSelectedStyle={projectActions.setSelectedStyle}
        selectedContentType={projectActions.selectedContentType}
        setSelectedContentType={projectActions.setSelectedContentType}
        targetDuration={projectActions.targetDuration}
        setTargetDuration={projectActions.setTargetDuration}
        importModalTab={projectActions.importModalTab}
        setImportModalTab={projectActions.setImportModalTab}
        autoTranscribeOnImport={projectActions.autoTranscribeOnImport}
        setAutoTranscribeOnImport={projectActions.setAutoTranscribeOnImport}
        refineTranscriptWithLlm={projectActions.refineTranscriptWithLlm}
        setRefineTranscriptWithLlm={projectActions.setRefineTranscriptWithLlm}
        autoDetectMoments={projectActions.autoDetectMoments}
        setAutoDetectMoments={projectActions.setAutoDetectMoments}
        customProjectDir={projectActions.customProjectDir}
        onSelectProjectDir={projectActions.handleSelectImportDir}
        moveSourceVideo={projectActions.moveSourceVideo}
        setMoveSourceVideo={projectActions.setMoveSourceVideo}
        onConfirmImport={() =>
          projectActions.confirmImport(
            projectActions.selectedStyle,
            projectActions.selectedContentType,
            projectActions.targetDuration
          )
        }
        // Social Copy Modal
        showCopyModal={mediaPipeline.showCopyModal}
        setShowCopyModal={mediaPipeline.setShowCopyModal}
        isGeneratingCopy={mediaPipeline.isGeneratingCopy}
        copyResult={mediaPipeline.copyResult}
        copyExtraContext={mediaPipeline.copyExtraContext}
        setCopyExtraContext={mediaPipeline.setCopyExtraContext}
        onGenerateSocialCopy={mediaPipeline.generateSocialCopy}
        copiedField={mediaPipeline.copiedField}
        onCopyText={mediaPipeline.copyTextToClipboard}
        // Quick Copy Modal
        showQuickCopyModal={mediaPipeline.showQuickCopyModal}
        setShowQuickCopyModal={mediaPipeline.setShowQuickCopyModal}
        // Candidate Preview Modal
        previewCandidate={mediaPipeline.previewCandidate}
        setPreviewCandidate={mediaPipeline.setPreviewCandidate}
        detail={projectActions.detail}
        trimStart={mediaPipeline.trimStart}
        setTrimStart={mediaPipeline.setTrimStart}
        trimEnd={mediaPipeline.trimEnd}
        setTrimEnd={mediaPipeline.setTrimEnd}
        isSavingTrim={mediaPipeline.isSavingTrim}
        onSaveTrim={mediaPipeline.saveCandidateTrim}
        onCutCandidate={mediaPipeline.cutCandidate}
        clipByCandidate={mediaPipeline.clipByCandidate}
        busy={projectActions.busy}
        onToggleDismissed={mediaPipeline.toggleCandidateDismissed}
      />

      <LogsModal isOpen={showLogs} onClose={() => setShowLogs(false)} />
    </div>
  );
}

export default App;
