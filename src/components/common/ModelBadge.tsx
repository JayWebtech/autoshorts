import React from "react";

export type ModelTrafficLevel = "optimal" | "moderate" | "heavy";

export function getWhisperTrafficLevel(modelId: string, vramTotalMb: number = 12288): { level: ModelTrafficLevel; label: string; note: string } {
  const id = modelId.toLowerCase();
  const vramGb = vramTotalMb > 0 ? vramTotalMb / 1024 : 12;

  if (id.includes("base") || id.includes("tiny")) {
    return { level: "optimal", label: "Óptimo", note: "Ultrarrápido (~1GB VRAM)" };
  }
  if (id.includes("small")) {
    return { level: "optimal", label: "Óptimo", note: "Rápido y preciso (~2GB VRAM)" };
  }
  if (id.includes("turbo")) {
    return { level: "optimal", label: "Óptimo", note: "Recomendado (~3.5GB VRAM)" };
  }
  if (id.includes("medium")) {
    if (vramGb >= 10) return { level: "optimal", label: "Óptimo", note: "Excelente precisión (~5GB VRAM)" };
    return { level: "moderate", label: "Moderado", note: "Uso medio (~5GB VRAM)" };
  }
  if (id.includes("large")) {
    if (vramGb >= 12) return { level: "moderate", label: "Moderado", note: "Alta precisión (~6.5GB VRAM)" };
    return { level: "heavy", label: "Pesado", note: "Requiere alta VRAM (~6.5GB+)" };
  }
  return { level: "optimal", label: "Óptimo", note: "Modelo compatible" };
}

export function getOllamaTrafficLevel(modelName: string, vramTotalMb: number = 12288): { level: ModelTrafficLevel; label: string; note: string } {
  const name = modelName.toLowerCase();
  const vramGb = vramTotalMb > 0 ? vramTotalMb / 1024 : 12;

  // Extract parameter size (e.g., 3b, 7b, 8b, 12b, 14b, 32b, 70b)
  const match = name.match(/(\d+)(?:\.\d+)?b/);
  const paramSize = match ? parseFloat(match[1]) : null;

  if (paramSize !== null) {
    if (paramSize <= 8) {
      return { level: "optimal", label: "Óptimo", note: `Muy fluido en tu GPU (~${Math.round(paramSize * 0.6 + 1.5)}GB VRAM)` };
    }
    if (paramSize <= 14) {
      if (vramGb >= 11) {
        return { level: "moderate", label: "Moderado", note: `Excelente precisión en modo rápido (~${Math.round(paramSize * 0.65 + 1.5)}GB VRAM)` };
      }
      return { level: "heavy", label: "Pesado", note: `Al límite de VRAM (~${Math.round(paramSize * 0.65 + 1.5)}GB VRAM)` };
    }
    return { level: "heavy", label: "Pesado", note: "Excede 12GB VRAM, ralentizará el sistema" };
  }

  if (name.includes("embed") || name.includes("mini") || name.includes("tiny")) {
    return { level: "optimal", label: "Óptimo", note: "Ultraligero" };
  }

  return { level: "moderate", label: "Moderado", note: "Uso estándar" };
}

interface ModelBadgeProps {
  level: ModelTrafficLevel;
  label: string;
  note?: string;
}

export const ModelBadge: React.FC<ModelBadgeProps> = ({ level, label, note }) => {
  const styles: Record<ModelTrafficLevel, { bg: string; border: string; color: string; dot: string }> = {
    optimal: {
      bg: "rgba(16, 185, 129, 0.12)",
      border: "rgba(16, 185, 129, 0.35)",
      color: "#10b981",
      dot: "#10b981",
    },
    moderate: {
      bg: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.35)",
      color: "#f59e0b",
      dot: "#f59e0b",
    },
    heavy: {
      bg: "rgba(239, 68, 68, 0.12)",
      border: "rgba(239, 68, 68, 0.35)",
      color: "#f87171",
      dot: "#f87171",
    },
  };

  const current = styles[level];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 7px",
        borderRadius: "4px",
        fontSize: "0.72rem",
        fontWeight: 600,
        background: current.bg,
        border: `1px solid ${current.border}`,
        color: current.color,
      }}
      title={note}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: current.dot,
        }}
      />
      <span>{label}</span>
    </span>
  );
};
