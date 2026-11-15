import React, { useEffect, useRef, useState } from "react";
import {
  Terminal,
  X,
  Copy,
  Check,
  Trash2,
  ArrowDownCircle,
  Search,
  Activity,
  Download,
  Folder,
} from "lucide-react";
import { invoke } from "../../apiBridge";

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "SYSTEM";
  message: string;
  raw: string;
}

interface LogsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogsModal: React.FC<LogsModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch initial logs when opened
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    void invoke<LogEntry[]>("get_system_logs", { limit: 1000 }).then((entries) => {
      if (mounted && entries) {
        setLogs(entries);
      }
    });

    const handleLogEvent = (e: any) => {
      const entry = e.detail as LogEntry;
      if (!entry) return;
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 1000 ? next.slice(-1000) : next;
      });
    };

    window.addEventListener("log-event", handleLogEvent);
    return () => {
      mounted = false;
      window.removeEventListener("log-event", handleLogEvent);
    };
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (!isOpen) return null;

  const filteredLogs = filter.trim()
    ? logs.filter(
        (l) =>
          l.message.toLowerCase().includes(filter.toLowerCase()) ||
          l.level.toLowerCase().includes(filter.toLowerCase())
      )
    : logs;

  const fallbackCopyText = (text: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "-9999px";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy logs with fallback:", e);
    }
  };

  const handleCopyLogs = () => {
    const text = logs.map((l) => l.raw).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          fallbackCopyText(text);
        });
    } else {
      fallbackCopyText(text);
    }
  };

  const handleExportLogs = async () => {
    try {
      const res = await invoke<{
        success: boolean;
        cancelled?: boolean;
        path?: string;
        dir?: string;
      }>("export_system_logs");

      if (res && res.success && res.path) {
        setExported(true);
        setExportPath(res.path);
        setTimeout(() => setExported(false), 3000);
        return;
      }
      if (res && res.cancelled) {
        return;
      }
    } catch (err) {
      console.warn("Backend log export failed, falling back to browser blob download:", err);
    }

    // Fallback: browser blob download
    try {
      const text = logs.map((l) => l.raw).join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autoshorts_logs_${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 3000);
    } catch (blobErr) {
      console.error("Blob download also failed:", blobErr);
    }
  };

  const handleClearLogs = async () => {
    try {
      await invoke("clear_system_logs");
      setLogs([]);
    } catch (e) {
      console.error("Error clearing logs:", e);
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "ERROR":
        return "#f87171";
      case "WARNING":
        return "#fbbf24";
      case "SYSTEM":
        return "#38bdf8";
      default:
        return "#94a3b8";
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="logs-modal"
        style={{
          width: "100%",
          maxWidth: "960px",
          height: "85vh",
          backgroundColor: "#090d16",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "12px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
        }}
      >
        {/* Terminal Header */}
        <div
          style={{
            padding: "0.85rem 1.25rem",
            backgroundColor: "#0d1322",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Terminal size={18} color="#38bdf8" />
            <h2
              style={{
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "#f1f5f9",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>Consola y Logs del Sistema</span>
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 8px",
                  borderRadius: "9999px",
                  backgroundColor: "rgba(56, 189, 248, 0.12)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Activity size={10} />
                <span>En vivo</span>
              </span>
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={handleCopyLogs}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontSize: "0.75rem",
                backgroundColor: copied ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                color: copied ? "#34d399" : "#cbd5e1",
                cursor: "pointer",
              }}
              title="Copiar todos los logs al portapapeles"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "Copiado" : "Copiar"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportLogs}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontSize: "0.75rem",
                backgroundColor: exported ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                color: exported ? "#34d399" : "#cbd5e1",
                cursor: "pointer",
              }}
              title="Exportar archivo de logs a disco"
            >
              {exported ? <Check size={13} /> : <Download size={13} />}
              <span>{exported ? "Exportado" : "Exportar"}</span>
            </button>

            <button
              type="button"
              onClick={handleClearLogs}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontSize: "0.75rem",
                backgroundColor: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                color: "#cbd5e1",
                cursor: "pointer",
              }}
              title="Limpiar registro de pantalla"
            >
              <Trash2 size={13} />
              <span>Limpiar</span>
            </button>

            <button
              type="button"
              onClick={() => setAutoScroll((prev) => !prev)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                fontSize: "0.75rem",
                backgroundColor: autoScroll ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.06)",
                border: `1px solid ${autoScroll ? "rgba(56, 189, 248, 0.3)" : "rgba(255, 255, 255, 0.12)"}`,
                borderRadius: "6px",
                color: autoScroll ? "#38bdf8" : "#cbd5e1",
                cursor: "pointer",
              }}
              title="Alternar auto-scroll al recibir nuevas líneas"
            >
              <ArrowDownCircle size={13} />
              <span>Scroll</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Cerrar consola"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div
          style={{
            padding: "0.5rem 1.25rem",
            backgroundColor: "#070a12",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Search size={14} color="#64748b" />
          <input
            type="text"
            placeholder="Filtrar por palabra clave (VRAM, whisper, error, cuda, adaptive)..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: 1,
              backgroundColor: "transparent",
              border: "none",
              color: "#e2e8f0",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
              outline: "none",
            }}
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter("")}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                fontSize: "0.75rem",
              }}
            >
              ✕
            </button>
          )}
          <span style={{ fontSize: "0.72rem", color: "#64748b", fontFamily: "var(--font-mono)" }}>
            {filteredLogs.length} / {logs.length} líneas
          </span>
        </div>

        {/* Export Notification Banner */}
        {exportPath && (
          <div
            style={{
              padding: "6px 16px",
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              borderBottom: "1px solid rgba(16, 185, 129, 0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.75rem",
              color: "#34d399",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Logs exportados exitosamente en: <strong>{exportPath}</strong>
            </span>
            <button
              type="button"
              onClick={() => invoke("open_folder", { path: exportPath })}
              style={{
                marginLeft: "12px",
                background: "transparent",
                border: "1px solid rgba(52, 211, 153, 0.4)",
                borderRadius: "4px",
                color: "#34d399",
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: "0.72rem",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
              }}
              title="Abrir carpeta contenedora en el explorador"
            >
              <Folder size={11} />
              <span>Abrir carpeta</span>
            </button>
          </div>
        )}

        {/* Terminal Output */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem 1.25rem",
            backgroundColor: "#090d16",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: "0.76rem",
            lineHeight: 1.6,
            color: "#e2e8f0",
          }}
        >
          {filteredLogs.length === 0 ? (
            <div
              style={{
                color: "#64748b",
                textAlign: "center",
                padding: "3rem 1rem",
                fontStyle: "italic",
              }}
            >
              {filter ? "No se encontraron logs que coincidan con el filtro." : "No hay registros en el buffer aún."}
            </div>
          ) : (
            filteredLogs.map((log, index) => {
              const levelColor = getLevelColor(log.level);
              return (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    wordBreak: "break-word",
                    padding: "1px 0",
                  }}
                >
                  <span
                    style={{
                      color: "#475569",
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    [{log.timestamp}]
                  </span>
                  <span
                    style={{
                      color: levelColor,
                      fontWeight: 600,
                      flexShrink: 0,
                      minWidth: "60px",
                    }}
                  >
                    [{log.level}]
                  </span>
                  <span style={{ color: log.level === "ERROR" ? "#fca5a5" : "#e2e8f0" }}>
                    {log.message}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
