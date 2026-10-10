import React from "react";

interface PipelineStepProps {
  icon: React.ReactNode;
  label: string;
  done: boolean;
}

export function PipelineStep({ icon, label, done }: PipelineStepProps) {
  return (
    <div className={`pipeline-step ${done ? "done" : ""}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
