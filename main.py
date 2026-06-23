"""
AutoShorts — Python Desktop App
Entry point. Runs Flask backend + pywebview frontend window.
"""
import os
import sys
import threading
import webview

# Ensure backend is importable from project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FLASK_PORT = 17999


class Api:
    """Bridge exposed to JS via pywebview."""

    def open_file_dialog(self):
        import webview as wv
        result = wv.windows[0].create_file_dialog(
            wv.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("Media Files (*.mp4;*.mov;*.mp3;*.wav;*.m4a)",),
        )
        if result:
            return result[0]
        return None


def start_flask():
    from backend.app import app
    app.run(host="127.0.0.1", port=FLASK_PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    t = threading.Thread(target=start_flask, daemon=True)
    t.start()

    # Serve from localhost — assumes `npm run build` has populated dist/
    dist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
    index_url = f"http://127.0.0.1:{FLASK_PORT}/api/environment-status"

    # Wait for Flask to be ready
    import urllib.request
    import time
    for _ in range(30):
        try:
            urllib.request.urlopen(index_url, timeout=1)
            break
        except Exception:
            time.sleep(0.5)

    window = webview.create_window(
        "AutoShorts",
        f"http://127.0.0.1:{FLASK_PORT}",
        width=1280,
        height=840,
        min_size=(1040, 700),
        js_api=Api(),
    )
    webview.start()
