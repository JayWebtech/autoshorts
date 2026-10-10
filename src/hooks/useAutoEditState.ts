import { useState, useEffect, useCallback } from "react";
import { invoke, listen } from "../apiBridge";
import type {
  AutoEditAssemblyStyle,
  AutoEditAspectRatio,
  AutoEditRecord,
  AutoEditResult,
  ProjectDetail,
} from "../types";

interface UseAutoEditStateOptions {
  detail: ProjectDetail | null;
  localLlmModel: string;
  customOutputDir: string;
  setError: (err: string | null) => void;
}

export function useAutoEditState(options: UseAutoEditStateOptions) {
  const { detail, localLlmModel, customOutputDir, setError } = options;

  const [projectViewTab, setProjectViewTab] = useState<"transcript" | "moments" | "autoedit">("moments");
  const [autoedits, setAutoedits] = useState<AutoEditRecord[]>([]);
  const [isLoadingAutoedits, setIsLoadingAutoedits] = useState<boolean>(false);
  const [isGeneratingCopyId, setIsGeneratingCopyId] = useState<string | null>(null);

  const [showAutoEditModal, setShowAutoEditModal] = useState<boolean>(false);
  const [autoEditFormatMode, setAutoEditFormatMode] = useState<"youtube" | "shorts">("youtube");
  const [autoEditTargetMinutes, setAutoEditTargetMinutes] = useState<number>(12);
  const [autoEditIncludeTeaser, setAutoEditIncludeTeaser] = useState<boolean>(true);
  const [autoEditTrimSilences, setAutoEditTrimSilences] = useState<boolean>(true);
  const [autoEditAssemblyStyle, setAutoEditAssemblyStyle] = useState<AutoEditAssemblyStyle>("balanced");
  const [autoEditAspectRatio, setAutoEditAspectRatio] = useState<AutoEditAspectRatio>("original");

  const [autoEditStatus, setAutoEditStatus] = useState<"idle" | "rendering" | "done">("idle");
  const [autoEditProgressMsg, setAutoEditProgressMsg] = useState<string>("");
  const [autoEditProgressPct, setAutoEditProgressPct] = useState<number>(0);
  const [autoEditResult, setAutoEditResult] = useState<AutoEditResult | null>(null);

  // AutoEdit progress listener
  useEffect(() => {
    let unlistenAutoEdit: (() => void) | null = null;
    void listen<{ status: string; message: string; percentage: number }>("autoedit-progress", (event) => {
      setAutoEditProgressMsg(event.payload.message);
      if (typeof event.payload.percentage === "number") {
        setAutoEditProgressPct(event.payload.percentage);
      }
    }).then((unsub) => {
      unlistenAutoEdit = unsub;
    });

    return () => {
      if (unlistenAutoEdit) unlistenAutoEdit();
    };
  }, []);

  const loadAutoedits = useCallback(
    async (projectId?: string) => {
      const pId = projectId || detail?.project.id;
      if (!pId) return;
      try {
        setIsLoadingAutoedits(true);
        const list = await invoke<AutoEditRecord[]>("get_autoedits", { projectId: pId });
        setAutoedits(list || []);
      } catch (e) {
        console.error("Error cargando autoedits:", e);
      } finally {
        setIsLoadingAutoedits(false);
      }
    },
    [detail?.project.id]
  );

  const generateAutoEdit = useCallback(async () => {
    if (!detail) return;
    try {
      setAutoEditStatus("rendering");
      setAutoEditProgressPct(5);
      setAutoEditProgressMsg("Iniciando estructuración de guion con IA...");
      const res = await invoke<AutoEditResult>("render_auto_edit", {
        projectId: detail.project.id,
        formatMode: autoEditFormatMode,
        targetDurationMinutes: autoEditTargetMinutes,
        includeTeaser: autoEditIncludeTeaser,
        trimSilences: autoEditTrimSilences,
        assemblyStyle: autoEditAssemblyStyle,
        aspectRatio: autoEditAspectRatio,
        modelName: localLlmModel,
        outputDir: customOutputDir || null,
      });
      setAutoEditResult(res);
      setAutoEditStatus("done");
      setAutoEditProgressPct(100);
      void loadAutoedits(detail.project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAutoEditStatus("idle");
    }
  }, [
    detail,
    autoEditFormatMode,
    autoEditTargetMinutes,
    autoEditIncludeTeaser,
    autoEditTrimSilences,
    autoEditAssemblyStyle,
    autoEditAspectRatio,
    localLlmModel,
    customOutputDir,
    loadAutoedits,
    setError,
  ]);

  const deleteAutoedit = useCallback(
    async (autoeditId: string) => {
      if (!detail) return;
      try {
        await invoke("delete_autoedit", { autoeditId, deleteFile: true });
        void loadAutoedits(detail.project.id);
      } catch (e) {
        console.error("Error eliminando autoedit:", e);
      }
    },
    [detail, loadAutoedits]
  );

  const generateAutoeditSocialCopy = useCallback(
    async (autoeditId: string) => {
      if (!detail) return;
      try {
        setIsGeneratingCopyId(autoeditId);
        await invoke("generate_autoedit_social_copy", {
          autoeditId,
          projectId: detail.project.id,
        });
        void loadAutoedits(detail.project.id);
      } catch (e) {
        console.error("Error regenerando copy de autoedit:", e);
      } finally {
        setIsGeneratingCopyId(null);
      }
    },
    [detail, loadAutoedits]
  );

  const cancelAutoEdit = useCallback(async () => {
    try {
      await invoke("cancel_auto_edit");
      setAutoEditStatus("idle");
      setAutoEditProgressMsg("Proceso cancelado.");
    } catch (e) {
      console.error("Error al cancelar autoedición:", e);
    }
  }, []);

  return {
    projectViewTab,
    setProjectViewTab,
    autoedits,
    setAutoedits,
    isLoadingAutoedits,
    isGeneratingCopyId,
    showAutoEditModal,
    setShowAutoEditModal,
    autoEditFormatMode,
    setAutoEditFormatMode,
    autoEditTargetMinutes,
    setAutoEditTargetMinutes,
    autoEditIncludeTeaser,
    setAutoEditIncludeTeaser,
    autoEditTrimSilences,
    setAutoEditTrimSilences,
    autoEditAssemblyStyle,
    setAutoEditAssemblyStyle,
    autoEditAspectRatio,
    setAutoEditAspectRatio,
    autoEditStatus,
    setAutoEditStatus,
    autoEditProgressMsg,
    autoEditProgressPct,
    autoEditResult,
    setAutoEditResult,
    loadAutoedits,
    generateAutoEdit,
    deleteAutoedit,
    generateAutoeditSocialCopy,
    cancelAutoEdit,
  };
}
