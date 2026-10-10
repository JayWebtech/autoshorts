import React from "react";
import { AutoEditConfigPanel } from "./AutoEditConfigPanel";
import { AutoEditGalleryPanel } from "./AutoEditGalleryPanel";
import { AutoEditRecord, AutoEditAssemblyStyle, AutoEditAspectRatio } from "../../../types";

interface AutoEditWorkspaceProps {
  formatMode: "youtube" | "shorts";
  setFormatMode: (mode: "youtube" | "shorts") => void;
  aspectRatio: AutoEditAspectRatio;
  setAspectRatio: (ar: AutoEditAspectRatio) => void;
  targetDurationMinutes: number;
  setTargetDurationMinutes: (m: number) => void;
  assemblyStyle: AutoEditAssemblyStyle;
  setAssemblyStyle: (style: AutoEditAssemblyStyle) => void;
  includeTeaser: boolean;
  setIncludeTeaser: (val: boolean) => void;
  trimSilences: boolean;
  setTrimSilences: (val: boolean) => void;
  isRendering: boolean;
  renderingPercentage: number;
  renderingMessage: string;
  onAssemble: () => void;
  onCancel: () => void;
  autoedits: AutoEditRecord[];
  isLoadingAutoedits: boolean;
  onPlay: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onDelete: (id: string) => void;
  onGenerateCopy: (id: string) => void;
  isGeneratingCopyId: string | null;
}

export const AutoEditWorkspace: React.FC<AutoEditWorkspaceProps> = ({
  formatMode,
  setFormatMode,
  aspectRatio,
  setAspectRatio,
  targetDurationMinutes,
  setTargetDurationMinutes,
  assemblyStyle,
  setAssemblyStyle,
  includeTeaser,
  setIncludeTeaser,
  trimSilences,
  setTrimSilences,
  isRendering,
  renderingPercentage,
  renderingMessage,
  onAssemble,
  onCancel,
  autoedits,
  isLoadingAutoedits,
  onPlay,
  onOpenFolder,
  onDelete,
  onGenerateCopy,
  isGeneratingCopyId
}) => {
  return (
    <div className="autoedit-workspace-grid">
      <AutoEditConfigPanel
        formatMode={formatMode}
        setFormatMode={setFormatMode}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        targetDurationMinutes={targetDurationMinutes}
        setTargetDurationMinutes={setTargetDurationMinutes}
        assemblyStyle={assemblyStyle}
        setAssemblyStyle={setAssemblyStyle}
        includeTeaser={includeTeaser}
        setIncludeTeaser={setIncludeTeaser}
        trimSilences={trimSilences}
        setTrimSilences={setTrimSilences}
        isRendering={isRendering}
        renderingPercentage={renderingPercentage}
        renderingMessage={renderingMessage}
        onAssemble={onAssemble}
        onCancel={onCancel}
      />

      <AutoEditGalleryPanel
        autoedits={autoedits}
        isLoading={isLoadingAutoedits}
        onPlay={onPlay}
        onOpenFolder={onOpenFolder}
        onDelete={onDelete}
        onGenerateCopy={onGenerateCopy}
        isGeneratingCopyId={isGeneratingCopyId}
      />
    </div>
  );
};
