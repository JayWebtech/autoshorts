import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

import { ClipEditor } from "./ClipEditor";
import type { ClipEditor as ClipEditorData } from "../lib/clipEditor";

function buildPayload(overrides: Partial<ClipEditorData> = {}): ClipEditorData {
  return {
    candidate: {
      id: "cand-1",
      projectId: "project-1",
      startSec: 10,
      endSec: 20,
      score: 0.9,
      hook: "The hook",
      rationale: "Why",
      rank: 1,
      selected: true,
    },
    sourcePath: "/media/source.mp4",
    edit: {
      candidateId: "cand-1",
      aspectRatio: "9:16",
      cropX: 0.5,
      cropY: 0.5,
      captions: [],
      captionStyle: null,
    },
    cues: [
      { start: 5, end: 9.5, text: "before" },
      { start: 10.5, end: 12.5, text: "hello there" },
      { start: 18, end: 22, text: "after" },
    ],
    captionStyle: "modern-box",
    sourceWidth: 1920,
    sourceHeight: 1080,
    ...overrides,
  };
}

function renderEditor(payload: ClipEditorData = buildPayload()) {
  invokeMock.mockImplementation(async (command: string, args?: { edit?: unknown }) => {
    if (command === "get_clip_editor") return payload;
    if (command === "save_clip_edit") return args?.edit ?? null;
    if (command === "prepare_project_preview") {
      return {
        path: "/cache/previews/source.webm",
        url: "http://127.0.0.1:51999/media/abc123/source.webm",
        startSec: 0,
        endSec: 0,
      };
    }
    return null;
  });

  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onRender = vi.fn();

  const utils = render(
    <ClipEditor candidateId="cand-1" onClose={onClose} onSaved={onSaved} onRender={onRender} />,
  );

  return { ...utils, onClose, onSaved, onRender };
}

describe("ClipEditor", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the editor and renders the source video inside the crop stage", async () => {
    // WebM-family codecs play directly, so this test exercises the raw source.
    renderEditor(buildPayload({ sourceVideoCodec: "vp8", sourceAudioCodec: "opus" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_clip_editor", { candidateId: "cand-1" }));

    const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;
    expect(video.getAttribute("src")).toContain("source.mp4");
    // The stage keeps the output ratio; the video fills it without stretching.
    expect(video.style.objectPosition).toBe("50% 50%");
    expect(video.style.width).toBe("");
    expect(video.style.height).toBe("");

    const stage = screen.getByLabelText("Crop preview");
    expect(stage.style.aspectRatio).toBe("1080 / 1920");
    expect(stage.style.maxWidth).toBe("calc(29.25vh)");
  });

  it("switches the output aspect ratio", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    const square = screen.getByRole("button", { name: "1:1" });
    fireEvent.click(square);
    expect(square).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_clip_edit",
        expect.objectContaining({
          edit: expect.objectContaining({ candidateId: "cand-1", aspectRatio: "1:1" }),
        }),
      );
    });
  });

  it("moves the crop with the sliders and resets it to the center", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    const horizontal = screen.getByLabelText("Horizontal crop") as HTMLInputElement;
    const vertical = screen.getByLabelText("Vertical crop") as HTMLInputElement;
    fireEvent.change(horizontal, { target: { value: "0.2" } });
    fireEvent.change(vertical, { target: { value: "0.9" } });
    expect(horizontal.value).toBe("0.2");
    expect(vertical.value).toBe("0.9");

    fireEvent.click(screen.getByRole("button", { name: /Center/ }));
    expect(horizontal.value).toBe("0.5");
    expect(vertical.value).toBe("0.5");

    fireEvent.change(horizontal, { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_clip_edit",
        expect.objectContaining({ edit: expect.objectContaining({ cropX: 0.75, cropY: 0.5 }) }),
      );
    });
  });

  it("drags inside the preview to move the crop window", async () => {
    renderEditor();
    const video = await screen.findByTestId("clip-editor-video");

    const stage = screen.getByLabelText("Crop preview");
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 200, height: 200, left: 0, top: 0, right: 200, bottom: 200, x: 0, y: 0 }),
    });

    fireEvent.pointerDown(stage, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 140, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 140, clientY: 80, pointerId: 1 });

    // Dragging right by 20% of the stage reveals the left edge: cropX 0.5 -> 0.3.
    const horizontal = screen.getByLabelText("Horizontal crop") as HTMLInputElement;
    expect(Number(horizontal.value)).toBeCloseTo(0.3, 5);
    const vertical = screen.getByLabelText("Vertical crop") as HTMLInputElement;
    expect(Number(vertical.value)).toBeCloseTo(0.6, 5);

    // Video crop follows the new offset through `object-position`.
    expect(video.style.objectPosition).toBe("30% 60%");
  });

  it("shows the active caption as an uppercase overlay", async () => {
    // Direct playback keeps source time == player time for this assertion.
    renderEditor(buildPayload({ sourceVideoCodec: "vp8", sourceAudioCodec: "opus" }));
    const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;

    Object.defineProperty(video, "currentTime", { configurable: true, value: 11, writable: true });
    fireEvent.timeUpdate(video);

    const overlay = await screen.findByTestId("clip-editor-caption");
    expect(overlay).toHaveTextContent("HELLO THERE");
    expect(overlay).toHaveAttribute("data-style", "modern-box");
  });

  it("lists only cues overlapping the clip and lets them be edited", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    expect(screen.queryByDisplayValue("before")).toBeNull();
    expect(screen.getByDisplayValue("hello there")).toBeInTheDocument();
    expect(screen.getByDisplayValue("after")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Caption 2 text"), { target: { value: "edited" } });
    fireEvent.change(screen.getByLabelText("Caption 2 start"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Caption 2 end"), { target: { value: "19" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_clip_edit",
        expect.objectContaining({
          edit: expect.objectContaining({
            captions: expect.arrayContaining([
              { start: 5, end: 9.5, text: "before" },
              { start: 16, end: 19, text: "edited" },
              { start: 18, end: 22, text: "after" },
            ]),
          }),
        }),
      );
    });
  });

  it("flags an end time that is not after the start time", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    // Keep both times inside the clip window so the row stays mounted.
    fireEvent.change(screen.getByLabelText("Caption 2 start"), { target: { value: "19" } });
    const end = screen.getByLabelText("Caption 2 end");
    fireEvent.change(end, { target: { value: "18" } });
    expect(screen.getByLabelText("Caption 2 end")).toHaveAttribute("aria-invalid", "true");
  });

  it("adds a caption at the playhead and deletes rows", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    expect(screen.getAllByLabelText(/Caption \d+ text/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Add caption/ }));

    // The new cue starts at the playhead (clip start) and sorts before the
    // transcript cue that begins at 10.5s.
    expect(screen.getAllByLabelText(/Caption \d+ text/)).toHaveLength(3);
    expect((screen.getByLabelText("Caption 2 start") as HTMLInputElement).value).toBe("10");

    fireEvent.click(screen.getByRole("button", { name: "Delete caption 2" }));
    expect(screen.getAllByLabelText(/Caption \d+ text/)).toHaveLength(2);
  });

  it("resets captions from the transcript", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.change(screen.getByLabelText("Caption 2 text"), { target: { value: "edited" } });
    expect(screen.getByDisplayValue("edited")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Reset to transcript/ }));

    await waitFor(() => expect(screen.getByDisplayValue("hello there")).toBeInTheDocument());
    const editorLoads = invokeMock.mock.calls.filter(([command]) => command === "get_clip_editor");
    expect(editorLoads).toHaveLength(2);
  });

  it("saves and cuts", async () => {
    const { onSaved, onRender, onClose } = renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.click(screen.getByRole("button", { name: /Save & Cut/ }));

    await waitFor(() => expect(onRender).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: "cand-1", aspectRatio: "9:16" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the caption style", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.change(screen.getByLabelText("Caption style"), {
      target: { value: "vibrant-cyan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_clip_edit",
        expect.objectContaining({
          edit: expect.objectContaining({ captionStyle: "vibrant-cyan" }),
        }),
      );
    });
  });

  it("closes on Escape and on Cancel", async () => {
    const { onClose } = renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows an error state when loading fails", async () => {
    invokeMock.mockRejectedValue(new Error("backend offline"));
    const onClose = vi.fn();
    render(<ClipEditor candidateId="cand-1" onClose={onClose} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("backend offline");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("restyles the caption colour, font and area", async () => {
    renderEditor();
    const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;
    Object.defineProperty(video, "currentTime", { configurable: true, value: 11, writable: true });
    fireEvent.timeUpdate(video);

    const caption = await screen.findByTestId("clip-editor-caption");
    expect(caption).toHaveTextContent("HELLO THERE");

    fireEvent.change(screen.getByLabelText("Cor do texto"), { target: { value: "#ff0000" } });
    await waitFor(() => expect(caption).toHaveStyle({ color: "#ff0000" }));

    fireEvent.change(screen.getByLabelText(/Posição vertical/), { target: { value: "0.5" } });
    await waitFor(() => expect(caption).toHaveStyle({ top: "50%" }));

    fireEvent.change(screen.getByLabelText(/Largura da área/), { target: { value: "0.4" } });
    await waitFor(() => expect(caption).toHaveStyle({ maxWidth: "40%" }));

    fireEvent.click(screen.getByLabelText("Maiúsculas"));
    await waitFor(() => expect(caption).toHaveTextContent("hello there"));
  });

  it("persists caption overrides on save and clears them on reset", async () => {
    renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.change(screen.getByLabelText(/Posição vertical/), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Cor do texto"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByLabelText("Negrito"));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_clip_edit",
        expect.objectContaining({
          edit: expect.objectContaining({
            captionOverride: expect.objectContaining({
              position: 0.5,
              textColor: "#00FF00",
              bold: false,
            }),
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Resetar estilo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenLastCalledWith(
        "save_clip_edit",
        expect.objectContaining({ edit: expect.objectContaining({ captionOverride: null }) }),
      );
    });
  });

  it("plays the source directly when the webview can decode it", async () => {
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = (() => "probably") as unknown as () => CanPlayTypeResult;

    try {
      renderEditor(buildPayload({ sourceVideoCodec: "vp9", sourceAudioCodec: "opus" }));

      const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;
      await waitFor(() => expect(video.getAttribute("src")).toContain("source.mp4"));
      expect(invokeMock).not.toHaveBeenCalledWith("prepare_project_preview", expect.anything());
    } finally {
      HTMLMediaElement.prototype.canPlayType = original;
    }
  });

  it("falls back to a transcoded proxy when the source codec is undecodable", async () => {
    const canPlayType = vi.fn(() => "");
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = canPlayType as unknown as () => CanPlayTypeResult;

    try {
      renderEditor(buildPayload({ sourceVideoCodec: "h264", sourceAudioCodec: "aac" }));

      const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("prepare_project_preview", {
          projectId: "project-1",
        }),
      );
      // Served over loopback HTTP: WebKitGTK cannot open the `asset:` scheme.
      await waitFor(() => expect(video.getAttribute("src")).toContain("127.0.0.1"));
      expect(video.getAttribute("src")).toContain("source.webm");
      expect(video.getAttribute("src")).not.toContain("source.mp4");
    } finally {
      HTMLMediaElement.prototype.canPlayType = original;
    }
  });

  it("seeks the whole-video proxy to the clip start", async () => {
    const canPlayType = vi.fn(() => "");
    const original = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = canPlayType as unknown as () => CanPlayTypeResult;

    try {
      renderEditor(buildPayload({ sourceVideoCodec: "h264", sourceAudioCodec: "aac" }));
      const video = (await screen.findByTestId("clip-editor-video")) as HTMLVideoElement;
      await waitFor(() => expect(video.getAttribute("src")).toContain("source.webm"));

      // The proxy covers the whole source, so clip start 10s is proxy time 10s.
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        value: 10,
        writable: true,
      });
      fireEvent.timeUpdate(video);

      await waitFor(() => {
        const slider = screen.getByLabelText("Playhead") as HTMLInputElement;
        expect(Number(slider.value)).toBeCloseTo(10, 5);
      });
    } finally {
      HTMLMediaElement.prototype.canPlayType = original;
    }
  });

  it("reports a preview error when the proxy also fails to load", async () => {
    renderEditor();

    const video = await screen.findByTestId("clip-editor-video");
    fireEvent.error(video);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("prepare_project_preview", {
        projectId: "project-1",
      }),
    );

    fireEvent.error(video);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("pré-visualização");
  });
});

describe("ClipEditor auto-edit", () => {
  it("saves null when auto-edit stays off", async () => {
    const { onSaved } = renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, args] = invokeMock.mock.calls.find(([command]) => command === "save_clip_edit")!;
    expect((args as { edit: { autoEdit: unknown } }).edit.autoEdit).toBeNull();
  });

  it("sends sanitized settings once the toggle is enabled", async () => {
    const { onSaved } = renderEditor();
    await screen.findByTestId("clip-editor-video");

    fireEvent.click(screen.getByLabelText("Ativar auto-edit"));
    await screen.findByText(/pausas cortadas/);

    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [, args] = invokeMock.mock.calls.find(([command]) => command === "save_clip_edit")!;
    const autoEdit = (args as { edit: { autoEdit: Record<string, unknown> } }).edit.autoEdit;
    expect(autoEdit).toMatchObject({
      enabled: true,
      silenceMode: "cut",
      silenceThresholdDb: -32,
      minSilenceSec: 0.45,
    });
  });

  it("restores saved settings from the backend payload", async () => {
    renderEditor(
      buildPayload({
        edit: {
          candidateId: "cand-1",
          aspectRatio: "9:16",
          cropX: 0.5,
          cropY: 0.5,
          captions: [],
          captionStyle: null,
          autoEdit: {
            enabled: true,
            silenceThresholdDb: -40,
            minSilenceSec: 0.6,
            paddingSec: 0.1,
            silenceMode: "speed",
            silenceSpeed: 2.5,
            punchInZoom: 1.12,
          },
        },
      }),
    );

    const toggle = (await screen.findByLabelText("Ativar auto-edit")) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/pausas em 2.5x/)).toBeTruthy();
  });
});
