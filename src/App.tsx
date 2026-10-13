import React, { useEffect, useState } from "react";
import { invoke } from "./apiBridge";
import { Loader2 } from "lucide-react";

// Hooks
import { useAppSettings } from "./hooks/useAppSettings";
import { useProjectActions } from "./hooks/useProjectActions";
import { useMediaPipeline } from "./hooks/useMediaPipeline";
import { useAutoEditState } from "./hooks/useAutoEditState";

// Panels
import { Sidebar } from "./components/panels/Sidebar";
import { WorkspaceHeader } from "./components/panels/WorkspaceHeader";
import { HomeDashboard } from "./components/panels/HomeDashboard";
import { TranscriptPanel } from "./components/panels/TranscriptPanel";
import { CandidatePanel } from "./components/panels/CandidatePanel";
import { AutoEditWorkspace } from "./components/panels/autoedit/AutoEditWorkspace";
import { StatusBar } from "./components/common/StatusBar";

// Modals
import { OnboardingModal } from "./components/modals/OnboardingModal";
import { SettingsPanel } from "./components/modals/SettingsPanel";
import { ModalContainer } from "./components/modals/ModalContainer";

export function App() {
  const [showSettings, setShowSettings] = useState(false);

  // References for cross-hook callbacks to guarantee safe access
  const mediaPipelineRef = React.useRef<ReturnType<typeof useMediaPipeline> | null>(null);
  const autoEditStateRef = React.useRef<ReturnType<typeof useAutoEditState> | null>(null);

  // 1. Settings & Persistence Hook
  const settings = useAppSettings();

  // 2. Project Actions & Workspace Hook
  const projectActions = useProjectActions({
    transcriptionEngine: settings.transcriptionEngine,
    setEnvironment: settings.setEnvironment,
    onWorkflowGoalSelected: (goal) => {
      if (autoEditStateRef.current) {
        autoEditStateRef.current.setProjectViewTab(goal === "autoedit" ? "autoedit" : "moments");
      }
    },
    onAutoPipeline: async (projectId, contentType, dur) => {
      if (mediaPipelineRef.current) {
        await mediaPipelineRef.current.runAutoPipeline(projectId, contentType, dur);
      }
    },
    onProjectSelected: (projectId, goal) => {
      if (autoEditStateRef.current) {
        if (!projectId) {
          autoEditStateRef.current.setAutoedits([]);
          autoEditStateRef.current.setProjectViewTab("moments");
        } else {
          void autoEditStateRef.current.loadAutoedits(projectId);
          autoEditStateRef.current.setProjectViewTab(goal === "autoedit" ? "autoedit" : "moments");
        }
      }
    },
  });

  // 3. Media Pipeline Hook (Transcription, LLM Moments, Cuts, Social Copy, Summary)
  const mediaPipeline = useMediaPipeline({
    detail: projectActions.detail,
    setDetail: projectActions.setDetail,
    refresh: projectActions.refresh,
    setError: projectActions.setError,
    busy: projectActions.busy,
    setBusy: projectActions.setBusy,
    transcriptionEngine: settings.transcriptionEngine,
    whisperModel: settings.whisperModel,
    deepgramKey: settings.deepgramKey,
    llmEngine: settings.llmEngine,
    localLlmModel: settings.localLlmModel,
    lmstudioModel: settings.lmstudioModel,
    openrouterKey: settings.openrouterKey,
    openrouterModel: settings.openrouterModel,
    enableThinking: settings.enableThinking,
    customMomentsPrompt: settings.customMomentsPrompt,
    customOutputDir: settings.customOutputDir,
    selectedContentType: projectActions.selectedContentType,
    targetDuration: projectActions.targetDuration,
    autoDetectMoments: projectActions.autoDetectMoments,
    pullModelDirectly: settings.pullModelDirectly,
  });
  mediaPipelineRef.current = mediaPipeline;

  // 4. AutoEdit State & Actions Hook
  const autoEditState = useAutoEditState({
    detail: projectActions.detail,
    localLlmModel: settings.localLlmModel,
    customOutputDir: settings.customOutputDir,
    setError: projectActions.setError,
  });
  autoEditStateRef.current = autoEditState;

  // Initial refresh
  useEffect(() => {
    void projectActions.refresh();
  }, []);

  if (settings.isOnboarded === null) {
    return (
      <div
        className="onboarding-loading"
        style={{ display: "grid", placeItems: "center", height: "100vh", background: "var(--bg-base)" }}
      >
        <Loader2 className="spin" size={32} color="var(--accent-primary)" />
      </div>
    );
  }

  if (settings.isOnboarded === false) {
    return (
      <OnboardingModal
        environment={settings.environment}
        onComplete={() => {
          localStorage.setItem("autoshorts_onboarded", "true");
          void invoke("save_app_config", { onboarded: true });
          settings.setIsOnboarded(true);
        }}
        setTranscriptionEngine={settings.setTranscriptionEngine}
        setLlmEngine={settings.setLlmEngine}
        setLocalLlmModel={settings.setLocalLlmModel}
        setDeepgramKey={settings.setDeepgramKey}
        setAnthropicKey={settings.setAnthropicKey}
        setDeepseekKey={settings.setDeepseekKey}
        setGroqKey={settings.setGroqKey}
        deepgramKey={settings.deepgramKey}
        anthropicKey={settings.anthropicKey}
        deepseekKey={settings.deepseekKey}
        groqKey={settings.groqKey}
        refreshEnv={() => projectActions.refresh()}
      />
    );
  }

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
      openrouterKey={settings.openrouterKey}
      setOpenrouterKey={settings.setOpenrouterKey}
      openrouterModel={settings.openrouterModel}
      setOpenrouterModel={settings.setOpenrouterModel}
      deepseekKey={settings.deepseekKey}
      setDeepseekKey={settings.setDeepseekKey}
      deepseekModel={settings.deepseekModel}
      setDeepseekModel={settings.setDeepseekModel}
      anthropicKey={settings.anthropicKey}
      setAnthropicKey={settings.setAnthropicKey}
      openaiKey={settings.openaiKey}
      setOpenaiKey={settings.setOpenaiKey}
      groqKey={settings.groqKey}
      setGroqKey={settings.setGroqKey}
      geminiKey={settings.geminiKey}
      setGeminiKey={settings.setGeminiKey}
      deepgramKey={settings.deepgramKey}
      setDeepgramKey={settings.setDeepgramKey}
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
          hasYtdlp={Boolean(settings.environment?.hasYtdlp)}
          showSettings={showSettings}
          onToggleSettings={() => setShowSettings(!showSettings)}
          onSelectProject={(id) => {
            if (id) void projectActions.selectProject(id);
            else void projectActions.selectProject(null);
          }}
          onImportMedia={projectActions.importMedia}
          onOpenYoutubeModal={() => projectActions.setYoutubeModalOpen(true)}
        />

        <section className="workspace">
          {projectActions.detail ? (
            <>
              <WorkspaceHeader
                detail={projectActions.detail}
                showSettings={showSettings}
                setShowSettings={setShowSettings}
                openSummaryModal={() => autoEditState.setProjectViewTab("autoedit")}
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
                activeView={autoEditState.projectViewTab}
                onChangeView={autoEditState.setProjectViewTab}
                onUpdateWorkflowGoal={projectActions.updateProjectWorkflowGoal}
              />

              {autoEditState.projectViewTab === "autoedit" ? (
                <AutoEditWorkspace
                  formatMode={autoEditState.autoEditFormatMode}
                  setFormatMode={autoEditState.setAutoEditFormatMode}
                  targetDurationMinutes={autoEditState.autoEditTargetMinutes}
                  setTargetDurationMinutes={autoEditState.setAutoEditTargetMinutes}
                  aspectRatio={autoEditState.autoEditAspectRatio}
                  setAspectRatio={autoEditState.setAutoEditAspectRatio}
                  assemblyStyle={autoEditState.autoEditAssemblyStyle}
                  setAssemblyStyle={autoEditState.setAutoEditAssemblyStyle}
                  includeTeaser={autoEditState.autoEditIncludeTeaser}
                  setIncludeTeaser={autoEditState.setAutoEditIncludeTeaser}
                  trimSilences={autoEditState.autoEditTrimSilences}
                  setTrimSilences={autoEditState.setAutoEditTrimSilences}
                  isRendering={autoEditState.autoEditStatus === "rendering"}
                  renderingPercentage={autoEditState.autoEditProgressPct}
                  renderingMessage={autoEditState.autoEditProgressMsg}
                  onAssemble={autoEditState.generateAutoEdit}
                  onCancel={autoEditState.cancelAutoEdit}
                  autoedits={autoEditState.autoedits}
                  isLoadingAutoedits={autoEditState.isLoadingAutoedits}
                  onPlay={(path) => void invoke("open_media_file", { path })}
                  onOpenFolder={(path) => void invoke("open_folder", { path })}
                  onDelete={autoEditState.deleteAutoedit}
                  onGenerateCopy={autoEditState.generateAutoeditSocialCopy}
                  isGeneratingCopyId={autoEditState.isGeneratingCopyId}
                />
              ) : autoEditState.projectViewTab === "transcript" ? (
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
              setYoutubeModalOpen={projectActions.setYoutubeModalOpen}
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
        canUseCloudKey={settings.canUseCloudKey}
        canUseOpenrouter={settings.canUseOpenrouter}
        llmMemoryStatus={settings.llmMemoryStatus}
        onUnloadLlm={settings.unloadActiveModel}
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
        openrouterKey={settings.openrouterKey}
        setOpenrouterKey={settings.setOpenrouterKey}
        openrouterModel={settings.openrouterModel}
        setOpenrouterModel={settings.setOpenrouterModel}
        deepseekKey={settings.deepseekKey}
        setDeepseekKey={settings.setDeepseekKey}
        deepseekModel={settings.deepseekModel}
        setDeepseekModel={settings.setDeepseekModel}
        anthropicKey={settings.anthropicKey}
        setAnthropicKey={settings.setAnthropicKey}
        openaiKey={settings.openaiKey}
        setOpenaiKey={settings.setOpenaiKey}
        groqKey={settings.groqKey}
        setGroqKey={settings.setGroqKey}
        geminiKey={settings.geminiKey}
        setGeminiKey={settings.setGeminiKey}
        deepgramKey={settings.deepgramKey}
        setDeepgramKey={settings.setDeepgramKey}
        customMomentsPrompt={settings.customMomentsPrompt}
        setCustomMomentsPrompt={settings.setCustomMomentsPrompt}
        defaultMomentsPrompt={settings.defaultMomentsPrompt}
        syncConfig={settings.syncConfig}
        onResetConfig={settings.handleResetConfig}
        // Capabilities
        canUseLmStudio={settings.canUseLmStudio}
        canUseDeepseek={settings.canUseDeepseek}
        canUseClaude={settings.canUseClaude}
        canUseOpenai={settings.canUseOpenai}
        canUseGroq={settings.canUseGroq}
        canUseGemini={settings.canUseGemini}
        canUseOpenrouter={settings.canUseOpenrouter}
        // Import / Style Modal
        showStyleModal={projectActions.showStyleModal}
        setShowStyleModal={projectActions.setShowStyleModal}
        workflowGoal={projectActions.workflowGoal}
        setWorkflowGoal={projectActions.setWorkflowGoal}
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
        // YouTube Modal
        youtubeModalOpen={projectActions.youtubeModalOpen}
        setYoutubeModalOpen={projectActions.setYoutubeModalOpen}
        youtubeUrl={projectActions.youtubeUrl}
        setYoutubeUrl={projectActions.setYoutubeUrl}
        youtubeStatus={projectActions.youtubeStatus}
        youtubeWarningLicense={projectActions.youtubeWarningLicense}
        onCheckAndDownloadYoutube={projectActions.handleYoutubeImport}
        onConfirmDownloadYoutubeRisk={projectActions.executeYoutubeDownload}
        // Summary Modal
        showSummaryModal={mediaPipeline.showSummaryModal}
        setShowSummaryModal={mediaPipeline.setShowSummaryModal}
        summaryTargetMinutes={mediaPipeline.summaryTargetMinutes}
        setSummaryTargetMinutes={mediaPipeline.setSummaryTargetMinutes}
        summaryAspectRatio={mediaPipeline.summaryAspectRatio}
        setSummaryAspectRatio={mediaPipeline.setSummaryAspectRatio}
        summaryVibe={mediaPipeline.summaryVibe}
        setSummaryVibe={mediaPipeline.setSummaryVibe}
        summaryStatus={mediaPipeline.summaryStatus}
        setSummaryStatus={mediaPipeline.setSummaryStatus}
        summaryProgressMsg={mediaPipeline.summaryProgressMsg}
        summaryResult={mediaPipeline.summaryResult}
        setSummaryResult={mediaPipeline.setSummaryResult}
        customOutputDir={settings.customOutputDir}
        onGenerateSummary={mediaPipeline.generateSummary}
        copiedChapters={mediaPipeline.copiedChapters}
        setCopiedChapters={mediaPipeline.setCopiedChapters}
        // AutoEdit Modal
        showAutoEditModal={autoEditState.showAutoEditModal}
        setShowAutoEditModal={autoEditState.setShowAutoEditModal}
        autoEditFormatMode={autoEditState.autoEditFormatMode}
        setAutoEditFormatMode={autoEditState.setAutoEditFormatMode}
        autoEditTargetMinutes={autoEditState.autoEditTargetMinutes}
        setAutoEditTargetMinutes={autoEditState.setAutoEditTargetMinutes}
        autoEditAspectRatio={autoEditState.autoEditAspectRatio}
        setAutoEditAspectRatio={autoEditState.setAutoEditAspectRatio}
        autoEditAssemblyStyle={autoEditState.autoEditAssemblyStyle}
        setAutoEditAssemblyStyle={autoEditState.setAutoEditAssemblyStyle}
        autoEditIncludeTeaser={autoEditState.autoEditIncludeTeaser}
        setAutoEditIncludeTeaser={autoEditState.setAutoEditIncludeTeaser}
        autoEditTrimSilences={autoEditState.autoEditTrimSilences}
        setAutoEditTrimSilences={autoEditState.setAutoEditTrimSilences}
        autoEditStatus={autoEditState.autoEditStatus}
        autoEditProgressMsg={autoEditState.autoEditProgressMsg}
        autoEditProgressPct={autoEditState.autoEditProgressPct}
        autoEditResult={autoEditState.autoEditResult}
        onStartAutoEdit={autoEditState.generateAutoEdit}
        onCancelAutoEdit={autoEditState.cancelAutoEdit}
      />
    </div>
  );
}

export default App;
