import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

import App from "./App";

const environment = {
  dataDir: "/tmp/autoshorts",
  hasFfmpeg: true,
  hasFfprobe: true,
  hasDeepgramKey: false,
  hasAnthropicKey: false,
  hasDeepseekKey: false,
  hasGeminiKey: false,
  hasOpenaiKey: false,
  hasOpenrouterKey: false,
  hasGroqKey: false,
  hasOpenaiCompatibleKey: false,
  openaiBaseUrl: null,
  llmProvider: "local",
  hasLocalWhisperModel: true,
  hasOllama: false,
  hasYtdlp: true,
  gpuAccel: false,
  videoEncoder: "libx264",
};

const projects = [
  {
    id: "project-1",
    name: "Podcast Episode",
    sourcePath: "/media/podcast.mp4",
    sourceDuration: 3600,
    status: "ready",
    transcriptionMode: "local",
    captionStyle: "modern-box",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "project-2",
    name: null,
    sourcePath: "/media/webinar-final.mp4",
    sourceDuration: 1200,
    status: "ingest",
    transcriptionMode: "deepgram",
    captionStyle: null,
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
];

function mockBackend(projectList: typeof projects) {
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "environment_status":
        return environment;
      case "list_projects":
        return projectList;
      case "list_whisper_models":
        return [];
      default:
        return null;
    }
  });
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it("shows the onboarding screen until the user finishes setup", async () => {
    mockBackend([]);
    render(<App />);

    expect(await screen.findByText("Welcome to AutoShorts")).toBeInTheDocument();
  });

  it("renders the sidebar with every persisted project", async () => {
    localStorage.setItem("autoshorts_onboarded", "true");
    mockBackend(projects);
    render(<App />);

    const sidebar = await screen.findByRole("complementary");
    expect(within(sidebar).getByText("AutoShorts")).toBeInTheDocument();
    expect(within(sidebar).getByText("All Projects")).toBeInTheDocument();
    expect(within(sidebar).getByText("Podcast Episode")).toBeInTheDocument();
    // Falls back to the file name when the project has no explicit name.
    expect(within(sidebar).getByText("webinar-final.mp4")).toBeInTheDocument();
    expect(screen.queryByText("No projects found")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no projects", async () => {
    localStorage.setItem("autoshorts_onboarded", "true");
    mockBackend([]);
    render(<App />);

    expect(await screen.findByText("No projects found")).toBeInTheDocument();
  });

  it("asks the backend for the environment and the project list on mount", async () => {
    localStorage.setItem("autoshorts_onboarded", "true");
    mockBackend([]);
    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("environment_status");
      expect(invokeMock).toHaveBeenCalledWith("list_projects");
    });
  });

  it("loads the selected project detail when a project row is clicked", async () => {
    localStorage.setItem("autoshorts_onboarded", "true");
    const detail = {
      project: projects[0],
      transcript: {
        id: "transcript-1",
        projectId: projects[0].id,
        engine: "whisper",
        rawJson: JSON.stringify({
          language: "pt",
          duration: 60,
          speakers: ["S1"],
          words: [],
          segments: [{ start: 0, end: 2, speaker: "S1", text: "hello world" }],
        }),
        language: "pt",
        createdAt: "2024-01-01T00:00:00Z",
      },
      candidates: [],
      clips: [],
    };

    invokeMock.mockImplementation(async (command: string) => {
      switch (command) {
        case "environment_status":
          return environment;
        case "list_projects":
          return projects;
        case "list_whisper_models":
          return [];
        case "get_project_detail":
          return detail;
        default:
          return null;
      }
    });

    render(<App />);

    const sidebar = await screen.findByRole("complementary");
    fireEvent.click(within(sidebar).getByText("Podcast Episode"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_project_detail", {
        projectId: "project-1",
      });
    });
    expect(await screen.findAllByText("ready")).not.toHaveLength(0);
  });
});
