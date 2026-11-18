import { describe, expect, it } from "vitest";
import {
  fileName,
  formatEncoderLabel,
  formatModelSize,
  formatPercent,
  formatTime,
  formatTimeRange,
} from "./format";

describe("formatModelSize", () => {
  it("keeps sizes below one gigabyte in megabytes", () => {
    expect(formatModelSize(0)).toBe("0 MB");
    expect(formatModelSize(999)).toBe("999 MB");
  });

  it("switches to gigabytes from 1000 MB upwards", () => {
    expect(formatModelSize(1000)).toBe("1.0 GB");
    expect(formatModelSize(1500)).toBe("1.5 GB");
    expect(formatModelSize(3000)).toBe("3.0 GB");
  });
});

describe("fileName", () => {
  it("returns the last segment of a POSIX path", () => {
    expect(fileName("/home/leoso/videos/episode.mp4")).toBe("episode.mp4");
  });

  it("handles Windows separators", () => {
    expect(fileName("C:\\Users\\leoso\\Videos\\clip.mov")).toBe("clip.mov");
  });

  it("returns the input when there is no separator", () => {
    expect(fileName("clip.mp4")).toBe("clip.mp4");
    expect(fileName("")).toBe("");
  });
});

describe("formatTime", () => {
  it("formats sub-minute durations as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(59.9)).toBe("0:59");
  });

  it("rolls over into minutes", () => {
    expect(formatTime(60)).toBe("1:00");
    expect(formatTime(125)).toBe("2:05");
    expect(formatTime(3661)).toBe("61:01");
  });

  it("guards against negative and non-finite input", () => {
    expect(formatTime(-12)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatTimeRange", () => {
  it("joins both ends of a clip window", () => {
    expect(formatTimeRange(12, 45.7)).toBe("0:12 - 0:45");
  });
});

describe("formatPercent", () => {
  it("rounds and clamps the value", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(42.4)).toBe("42%");
    expect(formatPercent(99.6)).toBe("100%");
    expect(formatPercent(-10)).toBe("0%");
    expect(formatPercent(250)).toBe("100%");
  });
});

describe("formatEncoderLabel", () => {
  it("maps the hardware encoders to short names", () => {
    expect(formatEncoderLabel("h264_nvenc (NVIDIA GPU)")).toBe("NVENC");
    expect(formatEncoderLabel("h264_videotoolbox (Apple GPU)")).toBe("VideoToolbox");
    expect(formatEncoderLabel("h264_amf (AMD GPU)")).toBe("AMF");
    expect(formatEncoderLabel("h264_vaapi (VA-API GPU)")).toBe("VA-API");
  });

  it("recognizes the CPU encoder", () => {
    expect(formatEncoderLabel("libx264 (CPU)")).toBe("CPU");
    expect(formatEncoderLabel("libx264")).toBe("CPU");
  });

  it("falls back to unknown for missing or unrecognized values", () => {
    expect(formatEncoderLabel(null)).toBe("unknown");
    expect(formatEncoderLabel(undefined)).toBe("unknown");
    expect(formatEncoderLabel("")).toBe("unknown");
    expect(formatEncoderLabel("mystery_codec")).toBe("unknown");
  });
});
