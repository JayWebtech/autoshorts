import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";

/** Small pill used to advertise an active feature. */
export function StatusPill({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`status-pill ${active ? "active" : ""}`}>
      <BadgeCheck size={14} />
      {label}
    </div>
  );
}

/** One step of the ingest → export pipeline indicator. */
export function PipelineStep({
  icon,
  label,
  done,
}: {
  icon: ReactNode;
  label: string;
  done: boolean;
}) {
  return (
    <div className={`pipeline-step ${done ? "done" : ""}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

/** Placeholder shown when a panel has no data yet. */
export function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{label}</span>
    </div>
  );
}
