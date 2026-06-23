const BASE = "http://127.0.0.1:17999/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || String(res.status));
  return data as T;
}

export async function getEnvironmentStatus() {
  return request<{
    dataDir: string;
    hasFfmpeg: boolean;
    hasFfprobe: boolean;
    hasDeepgramKey: boolean;
    hasAnthropicKey: boolean;
    hasDeepseekKey: boolean;
    llmProvider: string;
  }>("GET", "/environment-status");
}

export async function listProjects() {
  return request<{
    id: string;
    name: string | null;
    sourcePath: string;
    sourceDuration: number | null;
    status: string;
    transcriptionMode: string;
    createdAt: string;
    updatedAt: string;
  }[]>("GET", "/projects");
}

export async function createProject(path: string) {
  return request<{
    id: string;
    name: string | null;
    sourcePath: string;
    sourceDuration: number | null;
    status: string;
    transcriptionMode: string;
    createdAt: string;
    updatedAt: string;
  }>("POST", "/projects", { path, transcriptionMode: "deepgram" });
}

export async function importFileDialog(path: string) {
  return request<{
    id: string;
    name: string | null;
    sourcePath: string;
    sourceDuration: number | null;
    status: string;
    transcriptionMode: string;
    createdAt: string;
    updatedAt: string;
  }>("POST", "/import-file", { path });
}

export async function getProjectDetail(projectId: string) {
  return request<{
    project: unknown;
    transcript: unknown | null;
    candidates: unknown[];
    clips: unknown[];
  }>("GET", `/projects/${projectId}/detail`);
}

export async function transcribeProject(
  projectId: string,
  apiKey?: string | null
) {
  return request("POST", `/projects/${projectId}/transcribe`, {
    provider: "deepgram",
    apiKey: apiKey || null,
  });
}

export async function generateCandidates(
  projectId: string,
  apiKey?: string | null
) {
  return request<unknown[]>("POST", `/projects/${projectId}/candidates`, {
    apiKey: apiKey || null,
  });
}

export async function setSelectedClipCount(
  projectId: string,
  count: number
) {
  return request("POST", `/projects/${projectId}/select`, { count });
}

export async function renderClip(candidateId: string) {
  return request<{ outputPath: string }>(
    "POST",
    `/candidates/${candidateId}/render`
  );
}

export async function deleteProject(projectId: string) {
  return request("DELETE", `/projects/${projectId}`);
}

export async function renameProject(projectId: string, name: string) {
  return request("POST", `/projects/${projectId}/rename`, { name });
}

export async function openFileDialog(): Promise<string | null> {
  if ((window as any).pywebview?.api?.open_file_dialog) {
    return (window as any).pywebview.api.open_file_dialog();
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mp4,.mov,.mp3,.wav,.m4a";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => resolve(file.name);
        reader.readAsDataURL(file);
      } else {
        resolve(null);
      }
    };
    input.click();
  });
}
