import React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

interface YouTubeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  youtubeUrl: string;
  setYoutubeUrl: (val: string) => void;
  youtubeStatus: "idle" | "checking" | "warning" | "downloading";
  youtubeWarningLicense: string | null;
  onCheckAndDownload: () => Promise<void>;
  onConfirmDownloadRisk: () => Promise<void>;
}

export function YouTubeImportModal({
  isOpen,
  onClose,
  youtubeUrl,
  setYoutubeUrl,
  youtubeStatus,
  youtubeWarningLicense,
  onCheckAndDownload,
  onConfirmDownloadRisk,
}: YouTubeImportModalProps) {
  if (!isOpen) return null;

  return (
    <div className="style-modal-overlay">
      <div className="style-modal" style={{ maxWidth: "500px" }}>
        <div className="style-modal-header">
          <h3>Import from YouTube</h3>
          <p>Paste a YouTube URL below to download and import it directly.</p>
        </div>
        <div style={{ padding: "1rem" }}>
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            disabled={youtubeStatus !== "idle" && youtubeStatus !== "warning"}
            style={{
              width: "100%",
              padding: "0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontSize: "1rem",
              marginBottom: "1rem",
            }}
          />

          {youtubeStatus === "warning" && (
            <div
              style={{
                background: "rgba(255, 165, 0, 0.1)",
                border: "1px solid orange",
                padding: "1rem",
                borderRadius: "8px",
                marginBottom: "1rem",
                color: "orange",
              }}
            >
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", fontWeight: "bold" }}>
                <AlertTriangle size={20} />
                Copyright Warning
              </div>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>
                This video is not explicitly marked for reuse (Creative Commons). Its license appears to be: <strong>{youtubeWarningLicense}</strong>.
                <br /><br />
                Clipping this video may lead to copyright strikes. Are you sure you want to proceed?
              </p>
            </div>
          )}

          <div className="style-modal-actions" style={{ marginTop: "1rem" }}>
            <button
              className="btn-cancel"
              onClick={onClose}
              disabled={youtubeStatus === "checking" || youtubeStatus === "downloading"}
            >
              Cancel
            </button>
            {youtubeStatus === "warning" ? (
              <button className="btn-confirm" onClick={onConfirmDownloadRisk}>
                Yes, I understand the risks
              </button>
            ) : (
              <button
                className="btn-confirm"
                onClick={onCheckAndDownload}
                disabled={!youtubeUrl || youtubeStatus !== "idle"}
                style={{ minWidth: "120px" }}
              >
                {youtubeStatus === "checking" ? (
                  <><Loader2 className="spin" size={18} /> Checking...</>
                ) : youtubeStatus === "downloading" ? (
                  <><Loader2 className="spin" size={18} /> Downloading...</>
                ) : (
                  "Check & Download"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
