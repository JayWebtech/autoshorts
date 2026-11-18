import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState, PipelineStep, StatusPill } from "./common";

describe("PipelineStep", () => {
  it("renders the label and the base class", () => {
    render(<PipelineStep icon={<span>icon</span>} label="Transcript" done={false} />);

    const step = screen.getByText("Transcript").parentElement!;
    expect(step).toHaveClass("pipeline-step");
    expect(step).not.toHaveClass("done");
  });

  it("marks completed steps", () => {
    render(<PipelineStep icon={<span>icon</span>} label="Moments" done />);

    expect(screen.getByText("Moments").parentElement).toHaveClass("done");
  });

  it("renders the provided icon", () => {
    render(<PipelineStep icon={<span data-testid="step-icon" />} label="Cut" done />);

    expect(screen.getByTestId("step-icon")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the placeholder label", () => {
    render(<EmptyState icon={<span data-testid="empty-icon" />} label="Transcript pending" />);

    expect(screen.getByText("Transcript pending")).toBeInTheDocument();
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
  });
});

describe("StatusPill", () => {
  it("is not active by default", () => {
    render(<StatusPill label="GPU" />);

    expect(screen.getByText("GPU")).not.toHaveClass("active");
    expect(screen.getByText("GPU")).toHaveClass("status-pill");
  });

  it("adds the active class when requested", () => {
    render(<StatusPill label="GPU" active />);

    expect(screen.getByText("GPU")).toHaveClass("active");
  });
});
