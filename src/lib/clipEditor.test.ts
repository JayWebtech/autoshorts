import { describe, expect, it } from "vitest";
import {
  ASPECT_PRESETS,
  CAPTION_STYLES,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_AUTO_EDIT,
  aspectValue,
  autoEditSummary,
  canPlayDirectly,
  captionPreviewStyle,
  clampCues,
  hexToRgba,
  isLinuxWebview,
  needsProxyFor,
  normalizeAutoEdit,
  resolveCaptionStyle,
  sanitizeHex,
  cropGeometry,
  cropObjectPosition,
  cueAt,
  normalizeAspect,
  previewMimeType,
  stageMaxWidth,
  toPreviewTime,
  toSourceTime,
} from "./clipEditor";

describe("normalizeAspect", () => {
  it("keeps every known ratio", () => {
    for (const preset of ASPECT_PRESETS) {
      expect(normalizeAspect(preset.id)).toBe(preset.id);
    }
  });

  it("falls back to 9:16 for unknown or missing values", () => {
    expect(normalizeAspect("3:2")).toBe("9:16");
    expect(normalizeAspect("")).toBe("9:16");
    expect(normalizeAspect(null)).toBe("9:16");
    expect(normalizeAspect(undefined)).toBe(DEFAULT_ASPECT_RATIO);
  });
});

describe("aspectValue", () => {
  it("returns width / height for the presets", () => {
    expect(aspectValue("9:16")).toBeCloseTo(1080 / 1920, 10);
    expect(aspectValue("1:1")).toBeCloseTo(1, 10);
    expect(aspectValue("16:9")).toBeCloseTo(1920 / 1080, 10);
    expect(aspectValue("4:5")).toBeCloseTo(1080 / 1350, 10);
  });

  it("uses the 9:16 fallback for unknown ratios", () => {
    expect(aspectValue("nope")).toBeCloseTo(1080 / 1920, 10);
  });
});

describe("cropGeometry", () => {
  it("pillarboxes a wide source at 9:16", () => {
    // 1920x1080 -> 1080*9/16 tall window, full height.
    const geometry = cropGeometry(1920, 1080, "9:16", 0.5, 0.5);
    expect(geometry.height).toBeCloseTo(1080, 6);
    expect(geometry.width).toBeCloseTo(607.5, 6);
    expect(geometry.x).toBeCloseTo((1920 - 607.5) / 2, 6);
    expect(geometry.y).toBeCloseTo(0, 6);
  });

  it("letterboxes a tall source at 16:9", () => {
    // 1080x1920 -> full width, height 1080/(16/9).
    const geometry = cropGeometry(1080, 1920, "16:9", 0.5, 0.5);
    expect(geometry.width).toBeCloseTo(1080, 6);
    expect(geometry.height).toBeCloseTo(607.5, 6);
    expect(geometry.x).toBeCloseTo(0, 6);
    expect(geometry.y).toBeCloseTo((1920 - 607.5) / 2, 6);
  });

  it("keeps the whole frame when the source already matches the ratio", () => {
    const geometry = cropGeometry(1080, 1920, "9:16", 0.5, 0.5);
    expect(geometry.width).toBeCloseTo(1080, 6);
    expect(geometry.height).toBeCloseTo(1920, 6);
    expect(geometry.x).toBeCloseTo(0, 6);
    expect(geometry.y).toBeCloseTo(0, 6);
  });

  it("pins the window to the edges at 0 and 1", () => {
    const left = cropGeometry(1920, 1080, "9:16", 0, 0);
    expect(left.x).toBeCloseTo(0, 6);

    const right = cropGeometry(1920, 1080, "9:16", 1, 1);
    expect(right.x).toBeCloseTo(1920 - 607.5, 6);
  });

  it("clamps out-of-range crop offsets", () => {
    const under = cropGeometry(1920, 1080, "9:16", -3, -3);
    expect(under.x).toBeCloseTo(0, 6);
    expect(under.y).toBeCloseTo(0, 6);

    const over = cropGeometry(1920, 1080, "9:16", 7, 7);
    expect(over.x).toBeCloseTo(1920 - 607.5, 6);
  });

  it("returns zeros for unusable dimensions", () => {
    expect(cropGeometry(0, 1080, "9:16", 0.5, 0.5)).toEqual({ width: 0, height: 0, x: 0, y: 0 });
    expect(cropGeometry(Number.NaN, 1080, "9:16", 0.5, 0.5)).toEqual({
      width: 0,
      height: 0,
      x: 0,
      y: 0,
    });
  });
});

describe("cropObjectPosition", () => {
  it("centres the frame by default", () => {
    expect(cropObjectPosition(0.5, 0.5)).toBe("50% 50%");
  });

  it("maps the crop sliders onto object-position percentages", () => {
    expect(cropObjectPosition(0, 1)).toBe("0% 100%");
    expect(cropObjectPosition(1, 0)).toBe("100% 0%");
    expect(cropObjectPosition(0.25, 0.75)).toBe("25% 75%");
  });

  it("clamps out-of-range values instead of emitting invalid CSS", () => {
    expect(cropObjectPosition(-3, 7)).toBe("0% 100%");
    expect(cropObjectPosition(Number.NaN, 0.5)).toBe("0% 50%");
  });
});

describe("stageMaxWidth", () => {
  it("keeps the stage inside the height budget", () => {
    // 52vh tall at 9:16 is 29.25vh wide.
    expect(stageMaxWidth("9:16", 52)).toBe("calc(29.2500vh)");
    expect(stageMaxWidth("16:9", 52)).toBe("calc(92.4444vh)");
  });

  it("falls back to the default budget for invalid input", () => {
    expect(stageMaxWidth("1:1", Number.NaN)).toBe("calc(52.0000vh)");
  });
});

describe("cueAt", () => {
  const cues = [
    { start: 10, end: 12, text: "one" },
    { start: 12, end: 14.5, text: "two" },
  ];

  it("finds the cue covering the time", () => {
    expect(cueAt(cues, 10)?.text).toBe("one");
    expect(cueAt(cues, 11.9)?.text).toBe("one");
    expect(cueAt(cues, 13)?.text).toBe("two");
  });

  it("returns null outside every cue", () => {
    expect(cueAt(cues, 9.9)).toBeNull();
    expect(cueAt(cues, 14.5)).toBeNull();
    expect(cueAt([], 10)).toBeNull();
    expect(cueAt(null, 10)).toBeNull();
    expect(cueAt(cues, Number.NaN)).toBeNull();
  });
});

describe("clampCues", () => {
  it("drops empty and invalid cues", () => {
    const result = clampCues(
      [
        { start: 0, end: 1, text: "   " },
        { start: 5, end: 5, text: "zero length" },
        { start: 6, end: 4, text: "backwards" },
        { start: Number.NaN, end: 3, text: "nan" },
        { start: 1, end: 2, text: " keep " },
      ],
      0,
      10,
    );
    expect(result).toEqual([{ start: 1, end: 2, text: "keep" }]);
  });

  it("clamps into the window and sorts by start", () => {
    const result = clampCues(
      [
        { start: 8, end: 20, text: "late" },
        { start: 2, end: 6, text: "early" },
      ],
      5,
      10,
    );
    expect(result).toEqual([
      { start: 5, end: 6, text: "early" },
      { start: 8, end: 10, text: "late" },
    ]);
  });

  it("drops cues entirely outside the window", () => {
    expect(clampCues([{ start: 0, end: 1, text: "before" }], 5, 10)).toEqual([]);
  });

  it("handles missing input", () => {
    expect(clampCues(null, 0, 10)).toEqual([]);
    expect(clampCues(undefined, 0, 10)).toEqual([]);
  });
});

describe("CAPTION_STYLES", () => {
  it("exposes every backend style id", () => {
    expect(CAPTION_STYLES.map((style) => style.id)).toEqual([
      "modern-box",
      "classic-outline",
      "minimal-shadow",
      "vibrant-cyan",
      "vibrant-yellow-box",
      "vibrant-green",
      "vibrant-red",
    ]);
  });
});

describe("previewMimeType", () => {
  it("builds an mp4 mime for h264 + aac", () => {
    expect(previewMimeType("h264", "aac")).toBe('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  });

  it("builds a webm mime for vp9 + opus", () => {
    expect(previewMimeType("vp9", "opus")).toBe('video/webm; codecs="vp09.00.10.08, opus"');
  });

  it("returns null when the video codec is unknown", () => {
    expect(previewMimeType(null, "aac")).toBeNull();
    expect(previewMimeType("prores", "aac")).toBeNull();
  });
});

describe("canPlayDirectly", () => {
  it("returns null when the codec is unknown", () => {
    expect(canPlayDirectly(undefined, undefined, () => "maybe")).toBeNull();
  });

  it("reports support when canPlayType returns a non-empty value", () => {
    const probe = () => "probably";
    expect(canPlayDirectly("vp8", "opus", probe)).toBe(true);
  });

  it("reports failure for an empty canPlayType answer", () => {
    expect(canPlayDirectly("h264", "aac", () => "")).toBe(false);
  });
});

describe("preview time mapping", () => {
  it("offsets source time into proxy time and back", () => {
    expect(toPreviewTime(12, 9)).toBe(3);
    expect(toSourceTime(3, 9)).toBe(12);
  });

  it("keeps the raw offset (callers clamp to zero)", () => {
    expect(toPreviewTime(1, 9)).toBe(-8);
    expect(toSourceTime(-5, 9)).toBe(4);
  });

  it("treats a zero offset as identity", () => {
    expect(toPreviewTime(42, 0)).toBe(42);
    expect(toSourceTime(42, 0)).toBe(42);
  });
});

describe("needsProxyFor", () => {
  it("never proxies on non-Linux webviews", () => {
    expect(needsProxyFor("h264", false)).toBe(false);
    expect(needsProxyFor(null, false)).toBe(false);
  });

  it("proxies every non-WebM codec on Linux", () => {
    expect(needsProxyFor("h264", true)).toBe(true);
    expect(needsProxyFor("aac", true)).toBe(true);
    expect(needsProxyFor(null, true)).toBe(true);
  });

  it("plays WebM-family codecs directly on Linux", () => {
    expect(needsProxyFor("vp8", true)).toBe(false);
    expect(needsProxyFor("VP9", true)).toBe(false);
    expect(needsProxyFor("av1", true)).toBe(false);
  });
});

describe("isLinuxWebview", () => {
  it("detects a Linux user agent", () => {
    expect(isLinuxWebview()).toBe(/Linux/i.test(navigator.userAgent));
  });
});

describe("sanitizeHex", () => {
  it("keeps 6-digit hex and uppercases it", () => {
    expect(sanitizeHex("#ffcc00")).toBe("#FFCC00");
    expect(sanitizeHex(" #00ff00 ")).toBe("#00FF00");
  });

  it("rejects anything else", () => {
    expect(sanitizeHex("#abc")).toBeNull();
    expect(sanitizeHex("red")).toBeNull();
    expect(sanitizeHex(null)).toBeNull();
  });
});

describe("hexToRgba", () => {
  it("converts hex plus alpha", () => {
    expect(hexToRgba("#112233", 0.5)).toBe("rgba(17, 34, 51, 0.5)");
    expect(hexToRgba("#112233", 4)).toBe("rgba(17, 34, 51, 1)");
  });

  it("falls back to white for invalid input", () => {
    expect(hexToRgba("nope", 1)).toBe("rgba(255, 255, 255, 1)");
  });
});

describe("resolveCaptionStyle", () => {
  it("uses the preset defaults when there is no override", () => {
    const style = resolveCaptionStyle("vibrant-cyan", null);
    expect(style.textColor).toBe("#22D3EE");
    expect(style.borderStyle).toBe(1);
    expect(style.uppercase).toBe(true);
  });

  it("layers overrides and clamps out-of-range values", () => {
    const style = resolveCaptionStyle("modern-box", {
      textColor: "#00ff00",
      fontSize: 900,
      outline: -4,
      position: 3,
      maxWidth: 0.05,
      borderStyle: 1,
      bold: false,
      uppercase: false,
    });
    expect(style.textColor).toBe("#00FF00");
    expect(style.fontSize).toBe(200);
    expect(style.outline).toBe(0);
    expect(style.position).toBe(1);
    expect(style.maxWidth).toBe(0.2);
    expect(style.borderStyle).toBe(1);
    expect(style.bold).toBe(false);
    expect(style.uppercase).toBe(false);
  });

  it("ignores unknown presets", () => {
    expect(resolveCaptionStyle("nope", null)).toEqual(resolveCaptionStyle("modern-box", null));
  });
});

describe("captionPreviewStyle", () => {
  it("scales the ASS font size onto the rendered stage", () => {
    const style = resolveCaptionStyle("modern-box", { fontSize: 100 });
    const css = captionPreviewStyle(style, 270);
    expect(css.fontSize).toBeCloseTo(25, 5);
  });

  it("maps the position onto a top offset and keeps boxed presets unstroked", () => {
    const boxed = captionPreviewStyle(resolveCaptionStyle("modern-box", { position: 0.8 }), 540);
    expect(boxed.top).toBe("20%");
    expect(boxed.background).toContain("rgba(");
    expect(boxed.WebkitTextStroke).toBe("0");

    const outlined = captionPreviewStyle(
      resolveCaptionStyle("classic-outline", { position: 0.5, outline: 6 }),
      540,
    );
    expect(outlined.top).toBe("50%");
    expect(outlined.background).toBe("transparent");
    expect(outlined.WebkitTextStroke).toContain("px");
  });
});

describe("normalizeAutoEdit", () => {
  it("keeps null as null so untouched clips stay untouched", () => {
    expect(normalizeAutoEdit(null)).toBeNull();
    expect(normalizeAutoEdit(undefined)).toBeNull();
  });

  it("clamps every value into the range the backend accepts", () => {
    const normalized = normalizeAutoEdit({
      enabled: true,
      silenceThresholdDb: -120,
      minSilenceSec: 99,
      paddingSec: -1,
      silenceMode: "speed" as const,
      silenceSpeed: 0.2,
      punchInZoom: 5,
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.silenceThresholdDb).toBe(-60);
    expect(normalized?.minSilenceSec).toBe(5);
    expect(normalized?.paddingSec).toBe(0);
    expect(normalized?.silenceSpeed).toBe(1.1);
    expect(normalized?.punchInZoom).toBe(1.4);
  });

  it("falls back to cut for unknown silence modes", () => {
    const normalized = normalizeAutoEdit({
      ...DEFAULT_AUTO_EDIT,
      silenceMode: "explode" as unknown as "cut",
    });
    expect(normalized?.silenceMode).toBe("cut");
  });

  it("replaces non-finite numbers with the defaults", () => {
    const normalized = normalizeAutoEdit({
      ...DEFAULT_AUTO_EDIT,
      minSilenceSec: Number.NaN,
    });
    expect(normalized?.minSilenceSec).toBe(DEFAULT_AUTO_EDIT.minSilenceSec);
  });
});

describe("autoEditSummary", () => {
  it("reports the disabled state", () => {
    expect(autoEditSummary(null)).toBe("Auto-edit desligado");
    expect(autoEditSummary({ ...DEFAULT_AUTO_EDIT, enabled: false })).toBe(
      "Auto-edit desligado",
    );
  });

  it("describes a cut plan with the threshold and minimum pause", () => {
    const summary = autoEditSummary({ ...DEFAULT_AUTO_EDIT, enabled: true });
    expect(summary).toContain("pausas cortadas");
    expect(summary).toContain("-32 dB");
    expect(summary).toContain("0.45s");
    expect(summary).not.toContain("zoom dinâmico");
  });

  it("describes a speed plan and mentions punch-in when enabled", () => {
    const summary = autoEditSummary({
      ...DEFAULT_AUTO_EDIT,
      enabled: true,
      silenceMode: "speed",
      silenceSpeed: 2,
      punchInZoom: 1.15,
    });
    expect(summary).toContain("2x");
    expect(summary).toContain("zoom dinâmico");
  });
});
