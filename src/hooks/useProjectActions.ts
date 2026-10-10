import { useState, useCallback } from "react";
import { invoke, open } from "../apiBridge";
import type {
  BusyState,
  ContentType,
  EnvironmentStatus,
  Project,
  ProjectDetail,
  TargetDuration,
} from "../types";
import { fileName } from "../utils/format";

interface UseProjectActionsOptions {
  transcriptionEngine: string;
  onAutoPipeline?: (projectId: string, contentType: ContentType, dur: TargetDuration) => Promise<void>;
  onProjectSelected?: (projectId: string | null) => void;
  setEnvironment?: (env: EnvironmentStatus) => void;
}

export function useProjectActions(options: UseProjectActionsOptions) {
  const { transcriptionEngine, onAutoPipeline, onProjectSelected, setEnvironment } = options;

  const [projects, setProjects] = useState<Project[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState<BusyState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Import state
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState("modern-box");
  const [selectedContentType, setSelectedContentType] = useState<ContentType>("gaming");
  const [targetDuration, setTargetDuration] = useState<TargetDuration>(() => {
    return (localStorage.getItem("autoshorts_target_duration") as TargetDuration) || "60s";
  });
  const [mediaPathToImport, setMediaPathToImport] = useState<string | null>(null);
  const [customProjectDir, setCustomProjectDir] = useState<string>("");
  const [moveSourceVideo, setMoveSourceVideo] = useState<boolean>(false);
  const [autoTranscribeOnImport, setAutoTranscribeOnImport] = useState<boolean>(true);
  const [autoDetectMoments, setAutoDetectMoments] = useState<boolean>(false);
  const [refineTranscriptWithLlm, setRefineTranscriptWithLlm] = useState<boolean>(false);
  const [importModalTab, setImportModalTab] = useState<"subtitles" | "ai">("subtitles");

  // YouTube import state
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeStatus, setYoutubeStatus] = useState<"idle" | "checking" | "warning" | "downloading">("idle");
  const [youtubeWarningLicense, setYoutubeWarningLicense] = useState<string | null>(null);

  const refresh = useCallback(
    async (nextProjectId?: string) => {
      setError(null);
      const [env, projectList] = await Promise.all([
        invoke<EnvironmentStatus>("environment_status"),
        invoke<Project[]>("list_projects"),
      ]);
      if (setEnvironment) setEnvironment(env);
      setProjects(projectList);

      if (nextProjectId) {
        const nextDetail = await invoke<ProjectDetail>("get_project_detail", { projectId: nextProjectId });
        setDetail(nextDetail);
      } else {
        setDetail(null);
      }
    },
    [setEnvironment]
  );

  const run = useCallback(async (action: BusyState, task: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("idle");
    }
  }, []);

  const selectProject = useCallback(
    async (projectId: string | null) => {
      if (!projectId) {
        setDetail(null);
        if (onProjectSelected) onProjectSelected(null);
        return;
      }
      await run("idle", async () => {
        const nextDetail = await invoke<ProjectDetail>("get_project_detail", { projectId });
        setDetail(nextDetail);
        if (onProjectSelected) onProjectSelected(projectId);
      });
    },
    [run, onProjectSelected]
  );

  const renameProject = useCallback(
    async (projectId: string) => {
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
    },
    [projects, detail?.project.id, refresh]
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
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
    },
    [projects, detail?.project.id, refresh]
  );

  const toggleProjectCompleted = useCallback(
    async (projectId: string) => {
      try {
        await invoke("toggle_project_completed", { projectId });
        await refresh(detail?.project.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [detail?.project.id, refresh]
  );

  const relinkProjectVideo = useCallback(
    async (projectId: string) => {
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Video Files", extensions: ["mp4", "mov", "mkv", "avi", "webm", "m4v"] }],
        });
        if (!selected) return;
        const newSourcePath = Array.isArray(selected) ? selected[0] : (selected as string);
        if (!newSourcePath) return;

        await invoke("relink_project_video", { projectId, newSourcePath });
        await refresh(detail?.project.id === projectId ? projectId : undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [detail?.project.id, refresh]
  );

  const openProjectFolder = useCallback(async (projectId: string) => {
    try {
      await invoke("open_project_folder", { projectId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const moveProjectFolder = useCallback(
    async (projectId: string) => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Seleccionar nueva ubicación para la carpeta del proyecto",
        });
        if (!selected) return;
        const targetDir = Array.isArray(selected) ? selected[0] : (selected as string);
        if (!targetDir) return;

        await invoke("move_project_folder", {
          projectId,
          newParentDir: targetDir,
        });

        await refresh(detail?.project.id === projectId ? projectId : undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [detail?.project.id, refresh]
  );

  const importMedia = useCallback(async () => {
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
    setMediaPathToImport(selected);
    setMoveSourceVideo(false);
    try {
      const defaultDir = await invoke<string>("get_default_project_dir", { sourcePath: selected });
      setCustomProjectDir(defaultDir);
    } catch {
      setCustomProjectDir("");
    }
    setImportModalTab("subtitles");
    setShowStyleModal(true);
  }, []);

  const handleSelectImportDir = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Seleccionar carpeta para el proyecto",
      });
      if (!selected) return;
      const targetDir = Array.isArray(selected) ? selected[0] : (selected as string);
      if (!targetDir) return;

      const stem = mediaPathToImport ? fileName(mediaPathToImport).replace(/\.[^/.]+$/, "") : "Proyecto";
      const normalizedTarget = targetDir.replace(/[\\/]+$/, "");
      const endsWithStem = normalizedTarget.toLowerCase().endsWith(stem.toLowerCase());
      const finalDir = endsWithStem ? normalizedTarget : `${normalizedTarget}\\${stem}`;
      setCustomProjectDir(finalDir);
    } catch (err) {
      console.error(err);
    }
  }, [mediaPathToImport]);

  const confirmImport = useCallback(
    async (
      style: string,
      contentType: ContentType = selectedContentType,
      dur: TargetDuration = targetDuration
    ) => {
      if (!mediaPathToImport) return;
      const selected = mediaPathToImport;
      const projDir = customProjectDir.trim() || null;
      const shouldMove = moveSourceVideo;
      setMediaPathToImport(null);
      setShowStyleModal(false);

      let newProjectId: string | null = null;
      await run("import", async () => {
        const project = await invoke<Project>("create_project_from_path", {
          path: selected,
          transcriptionMode: transcriptionEngine === "local" ? "local" : "cloud",
          captionStyle: style,
          projectDir: projDir,
          moveSourceVideo: shouldMove,
        });
        newProjectId = project.id;
        await refresh(project.id);
      });

      if (newProjectId && autoTranscribeOnImport && onAutoPipeline) {
        await onAutoPipeline(newProjectId, contentType, dur);
      }
    },
    [
      mediaPathToImport,
      customProjectDir,
      moveSourceVideo,
      transcriptionEngine,
      selectedContentType,
      targetDuration,
      autoTranscribeOnImport,
      run,
      refresh,
      onAutoPipeline,
    ]
  );

  const executeYoutubeDownload = useCallback(async () => {
    setYoutubeStatus("downloading");
    setError(null);
    try {
      const downloadedPath = await invoke<string>("download_youtube_video", { url: youtubeUrl });
      setYoutubeModalOpen(false);
      setYoutubeUrl("");
      setYoutubeStatus("idle");
      setMediaPathToImport(downloadedPath);
      setMoveSourceVideo(false);
      try {
        const defaultDir = await invoke<string>("get_default_project_dir", { sourcePath: downloadedPath });
        setCustomProjectDir(defaultDir);
      } catch {
        setCustomProjectDir("");
      }
      setImportModalTab("subtitles");
      setShowStyleModal(true);
    } catch (err: any) {
      setError(err.toString());
      setYoutubeStatus("idle");
    }
  }, [youtubeUrl]);

  const handleYoutubeImport = useCallback(async () => {
    if (!youtubeUrl) return;
    setYoutubeStatus("checking");
    setError(null);
    try {
      const result = await invoke<{ isSafe: boolean; license: string | null }>("check_youtube_copyright", {
        url: youtubeUrl,
      });
      if (!result.isSafe) {
        setYoutubeWarningLicense(result.license || "Unknown / Not specified");
        setYoutubeStatus("warning");
        return;
      }
      await executeYoutubeDownload();
    } catch (err: any) {
      setError(err.toString());
      setYoutubeStatus("idle");
    }
  }, [youtubeUrl, executeYoutubeDownload]);

  return {
    projects,
    setProjects,
    detail,
    setDetail,
    busy,
    setBusy,
    error,
    setError,
    refresh,
    run,
    selectProject,
    renameProject,
    deleteProject,
    toggleProjectCompleted,
    relinkProjectVideo,
    openProjectFolder,
    moveProjectFolder,
    // Import state & actions
    showStyleModal,
    setShowStyleModal,
    selectedStyle,
    setSelectedStyle,
    selectedContentType,
    setSelectedContentType,
    targetDuration,
    setTargetDuration,
    mediaPathToImport,
    setMediaPathToImport,
    customProjectDir,
    setCustomProjectDir,
    moveSourceVideo,
    setMoveSourceVideo,
    autoTranscribeOnImport,
    setAutoTranscribeOnImport,
    autoDetectMoments,
    setAutoDetectMoments,
    refineTranscriptWithLlm,
    setRefineTranscriptWithLlm,
    importModalTab,
    setImportModalTab,
    importMedia,
    handleSelectImportDir,
    confirmImport,
    // YouTube
    youtubeModalOpen,
    setYoutubeModalOpen,
    youtubeUrl,
    setYoutubeUrl,
    youtubeStatus,
    setYoutubeStatus,
    youtubeWarningLicense,
    handleYoutubeImport,
    executeYoutubeDownload,
  };
}
