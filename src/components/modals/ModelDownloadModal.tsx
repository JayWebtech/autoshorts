import React from "react";
import { Loader2 } from "lucide-react";

interface ModelDownloadModalProps {
  downloadingModelName: string | null;
  modelDownloadProgress: number;
  modelDownloadStatus: string;
}

export const ModelDownloadModal: React.FC<ModelDownloadModalProps> = ({
  downloadingModelName,
  modelDownloadProgress,
  modelDownloadStatus,
}) => {
  if (!downloadingModelName) return null;

  return (
    <div className="onboarding-overlay" style={{ zIndex: 20000 }}>
      <div className="onboarding-card" style={{ maxWidth: "480px", textAlign: "center" }}>
        <div className="onboarding-header compact" style={{ textAlign: "center" }}>
          <h2>Downloading Ollama Model</h2>
          <p>Downloading model weights for "{downloadingModelName}". Please do not close the app.</p>
        </div>

        <div className="download-progress-container">
          <div className="download-loader">
            <Loader2 className="spin" size={48} />
          </div>

          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${modelDownloadProgress}%` }}></div>
          </div>

          <div className="download-stats">
            <span className="download-status">{modelDownloadStatus}</span>
            <span className="download-percentage">{modelDownloadProgress}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};
