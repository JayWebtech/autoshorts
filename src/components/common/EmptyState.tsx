import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  label: string;
}

export function EmptyState({ icon, label }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon}
      <span>{label}</span>
    </div>
  );
}
