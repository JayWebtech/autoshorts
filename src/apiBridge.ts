/**
 * Bridge between React frontend and Python (PyWebView) or Tauri backend.
 */

async function getPyWebViewApi(): Promise<any> {
  if (typeof window === "undefined") return null;

  if ((window as any).pywebview?.api) {
    return (window as any).pywebview.api;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const onReady = () => {
      if (!resolved) {
        resolved = true;
        resolve((window as any).pywebview?.api || null);
      }
    };

    window.addEventListener("pywebviewready", onReady, { once: true });

    const interval = setInterval(() => {
      if ((window as any).pywebview?.api) {
        clearInterval(interval);
        if (!resolved) {
          resolved = true;
          resolve((window as any).pywebview.api);
        }
      }
    }, 50);

    setTimeout(() => {
      clearInterval(interval);
      if (!resolved) {
        resolved = true;
        resolve((window as any).pywebview?.api || null);
      }
    }, 2500);
  });
}

export async function invoke<T = any>(command: string, args?: Record<string, any>): Promise<T> {
  const pyApi = await getPyWebViewApi();
  if (pyApi) {
    if (typeof pyApi.invoke === "function") {
      return (await pyApi.invoke(command, args || {})) as T;
    }
    if (typeof pyApi[command] === "function") {
      return (await pyApi[command](args || {})) as T;
    }
  }

  // Fallback to Tauri if running inside Tauri webview
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const tauri = await import("@tauri-apps/api/core");
    return await tauri.invoke<T>(command, args);
  }

  throw new Error(`Comando '${command}' no pudo ejecutarse: no se detectó el backend de PyWebView ni de Tauri.`);
}

export async function open(options?: any): Promise<string | null> {
  const pyApi = await getPyWebViewApi();
  if (pyApi) {
    if (options?.directory) {
      if (typeof pyApi.select_output_directory === "function") {
        return await pyApi.select_output_directory();
      }
      if (typeof pyApi.invoke === "function") {
        return await pyApi.invoke("select_output_directory", {});
      }
    }
    if (typeof pyApi.open_file_dialog === "function") {
      return await pyApi.open_file_dialog();
    }
    if (typeof pyApi.invoke === "function") {
      return await pyApi.invoke("open_file_dialog", {});
    }
  }

  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    const dialog = await import("@tauri-apps/plugin-dialog");
    return (await dialog.open(options)) as string | null;
  }

  return null;
}

export async function listen<T = any>(
  eventName: string,
  handler: (event: { payload: T }) => void
): Promise<() => void> {
  // Listen for window CustomEvent (emitted by Python pywebview)
  const customListener = (e: Event) => {
    const custom = e as CustomEvent;
    handler({ payload: custom.detail as T });
  };
  window.addEventListener(eventName, customListener);

  let tauriUnlisten: (() => void) | null = null;
  if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
    try {
      const { listen: tauriListen } = await import("@tauri-apps/api/event");
      tauriUnlisten = await tauriListen<T>(eventName, handler);
    } catch {
      // ignore
    }
  }

  return () => {
    window.removeEventListener(eventName, customListener);
    if (tauriUnlisten) {
      tauriUnlisten();
    }
  };
}
