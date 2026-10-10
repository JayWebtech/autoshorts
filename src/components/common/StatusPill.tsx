import React from "react";
import { BadgeCheck } from "lucide-react";

interface StatusPillProps {
  label: string;
  active?: boolean;
}

export function StatusPill({ label, active }: StatusPillProps) {
  return (
    <div className={`status-pill ${active ? "active" : ""}`}>
      <BadgeCheck size={14} />
      {label}
    </div>
  );
}
