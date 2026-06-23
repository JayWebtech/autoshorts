import os
import json
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

from .db import Database
from . import media as m
from . import transcription as tx
from . import llm
from .models import NormalizedTranscript

# Serve React build from dist/
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "dist"

app = Flask(__name__, static_folder=None)

DATA_DIR = Path(os.environ.get("AUTOSHORTS_DATA", str(Path.home() / ".autoshorts")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
db = Database(DATA_DIR / "autoshorts.sqlite")


def _error(msg: str, code=400):
    return jsonify({"error": msg}), code


def _ok(data):
    return jsonify(data)


def _validate_media(path: str):
    ext = Path(path).suffix.lower().lstrip(".")
    allowed = ("mp4", "mov", "mp3", "wav", "m4a")
    if ext not in allowed:
        raise ValueError(f"Unsupported file type .{ext}. Use {', '.join(allowed)}.")


def _project_dir(project_id: str) -> Path:
    return DATA_DIR / "projects" / project_id


def _documents_project_dir(project) -> Path:
    docs = Path.home() / "Documents" / "AutoShorts"
    stem = Path(project.source_path).stem
    slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in stem).strip("-")
    return docs / (slug or project.id)


@app.route("/api/environment-status")
def environment_status():
    return _ok({
        "dataDir": str(DATA_DIR),
        "hasFfmpeg": m.command_exists("ffmpeg"),
        "hasFfprobe": m.command_exists("ffprobe"),
        "hasDeepgramKey": bool(os.environ.get("DEEPGRAM_API_KEY")),
        "hasAnthropicKey": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "hasDeepseekKey": bool(os.environ.get("DEEPSEEK_API_KEY")),
        "llmProvider": os.environ.get("LLM_PROVIDER", "deepseek"),
    })


@app.route("/api/projects", methods=["POST"])
def create_project():
    body = request.get_json()
    path = body["path"]
    mode = body.get("transcriptionMode", "deepgram")
    try:
        _validate_media(path)
    except ValueError as e:
        return _error(str(e))
    probe = None
    try:
        probe = m.probe_media(path)
    except Exception:
        pass
    p = db.create_project(path, mode, probe.duration_sec if probe else None)
    return _ok(json.loads(json.dumps(p, default=str)))


@app.route("/api/projects", methods=["GET"])
def list_projects():
    projects = db.list_projects()
    return _ok(json.loads(json.dumps([vars(p) for p in projects], default=str)))


@app.route("/api/projects/<project_id>")
def get_project(project_id: str):
    p = db.get_project(project_id)
    if not p:
        return _error("Project not found", 404)
    return _ok(json.loads(json.dumps(vars(p), default=str)))


@app.route("/api/projects/<project_id>/detail")
def project_detail(project_id: str):
    d = db.project_detail(project_id)
    if not d:
        return _error("Project not found", 404)
    return _ok(json.loads(json.dumps(d, default=str)))


@app.route("/api/projects/<project_id>/probe", methods=["POST"])
def probe_project(project_id: str):
    p = db.get_project(project_id)
    if not p:
        return _error("Project not found", 404)
    probe = m.probe_media(p.source_path)
    db.update_project_status(project_id, "ingest", probe.duration_sec)
    return _ok(json.loads(json.dumps(vars(probe), default=str)))


@app.route("/api/projects/<project_id>/extract-audio", methods=["POST"])
def extract_audio(project_id: str):
    p = db.get_project(project_id)
    if not p:
        return _error("Project not found", 404)
    audio = m.extract_audio(p.source_path, _project_dir(project_id))
    return _ok({"audioPath": str(audio)})


@app.route("/api/projects/<project_id>/transcribe", methods=["POST"])
async def transcribe_project(project_id: str):
    p = db.get_project(project_id)
    if not p:
        return _error("Project not found", 404)
    body = request.get_json() or {}
    provider = body.get("provider", "deepgram")
    api_key = body.get("apiKey")
    db.update_project_status(project_id, "transcribing", None)
    if provider == "deepgram":
        key = api_key or os.environ.get("DEEPGRAM_API_KEY")
        if not key:
            return _error("Set DEEPGRAM_API_KEY or supply an API key")
        audio = m.extract_audio(p.source_path, _project_dir(project_id))
        transcript = await tx.transcribe_deepgram(str(audio), key)
    else:
        return _error(f"Unsupported provider: {provider}")
    raw_json = json.dumps(transcript, default=str)
    saved = db.save_transcript(project_id, provider, raw_json, transcript.language)
    db.update_project_status(project_id, "analyzing", transcript.duration)
    return _ok(json.loads(json.dumps(vars(saved), default=str)))


@app.route("/api/projects/<project_id>/demo-transcript", methods=["POST"])
def save_demo_transcript(project_id: str):
    lines = [
        "The surprising thing about short-form clips is that the best moment is rarely the loudest moment.",
        "It is usually the point where someone finally says the quiet part plainly and the listener can feel the stakes.",
        "That is why the system needs to understand the transcript as a story, not just search for keywords.",
    ]
    words = []
    cursor = 0.0
    for line in lines:
        for token in line.split():
            end = cursor + 0.32
            words.append({"text": token, "start": cursor, "end": end, "speaker": "A"})
            cursor = end + 0.08
        cursor += 0.75
    transcript = NormalizedTranscript(
        language="en", duration=cursor, speakers=["A"],
        words=[type("w", (), w)() for w in words],
        segments=[type("s", (), {"start": 0.0, "end": cursor, "speaker": "A", "text": " ".join(lines)})()],
    )
    raw = json.dumps(transcript, default=str)
    saved = db.save_transcript(project_id, "demo", raw, "en")
    db.update_project_status(project_id, "analyzing", cursor)
    return _ok(json.loads(json.dumps(vars(saved), default=str)))


@app.route("/api/projects/<project_id>/candidates", methods=["POST"])
async def generate_candidates(project_id: str):
    p = db.get_project(project_id)
    if not p:
        return _error("Project not found", 404)
    t = db.latest_transcript(project_id)
    if not t:
        return _error("Transcribe the project first")
    normalized = NormalizedTranscript(**json.loads(t.raw_json))
    body = request.get_json() or {}
    api_key = body.get("apiKey")
    provider = os.environ.get("LLM_PROVIDER", "deepseek").lower()
    if provider == "claude":
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return _error("Set ANTHROPIC_API_KEY or supply a Claude API key")
        drafts = await llm.detect_candidates_with_claude(normalized, key)
    else:
        key = api_key or os.environ.get("DEEPSEEK_API_KEY")
        if not key:
            return _error("Set DEEPSEEK_API_KEY or supply a DeepSeek API key")
        drafts = await llm.detect_candidates_with_deepseek(normalized, key)
    if not drafts:
        return _error("No viable clip candidates returned")
    candidates = db.replace_candidates(project_id, drafts)
    db.update_project_status(project_id, "ready", None)
    return _ok(json.loads(json.dumps([vars(c) for c in candidates], default=str)))


@app.route("/api/projects/<project_id>/select", methods=["POST"])
def set_selected(project_id: str):
    body = request.get_json()
    count = max(0, min(body.get("count", 6), 10))
    candidates = db.set_selected_clip_count(project_id, count)
    return _ok(json.loads(json.dumps([vars(c) for c in candidates], default=str)))


@app.route("/api/candidates/<candidate_id>/render", methods=["POST"])
def render_clip(candidate_id: str):
    result = db.get_candidate_with_project(candidate_id)
    if not result:
        return _error("Candidate not found", 404)
    candidate, project = result
    db.update_clip_for_candidate(candidate_id, "cutting")
    output = _documents_project_dir(project) / "clips" / f"clip-{candidate.rank:02d}_flat.mp4"
    try:
        path = m.render_flat_clip(project.source_path, candidate.start_sec, candidate.end_sec, output)
        db.update_clip_for_candidate(candidate_id, "done", str(path))
        return _ok({"outputPath": str(path)})
    except Exception as e:
        db.update_clip_for_candidate(candidate_id, "error", render_log=str(e))
        return _error(str(e))


@app.route("/api/projects/<project_id>", methods=["DELETE"])
def delete_project(project_id: str):
    db.delete_project(project_id)
    return _ok({"ok": True})


@app.route("/api/projects/<project_id>/rename", methods=["POST"])
def rename_project(project_id: str):
    body = request.get_json()
    db.rename_project(project_id, body["name"])
    return _ok({"ok": True})


@app.route("/api/import-file", methods=["POST"])
def import_file():
    body = request.get_json()
    path = body.get("path", "")
    if not path or not Path(path).exists():
        return _error("File not found", 404)
    try:
        _validate_media(path)
    except ValueError as e:
        return _error(str(e))
    probe = None
    try:
        probe = m.probe_media(path)
    except Exception:
        pass
    p = db.create_project(path, "deepgram", probe.duration_sec if probe else None)
    return _ok(json.loads(json.dumps(p, default=str)))


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path: str):
    target = FRONTEND_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(str(FRONTEND_DIR), path)
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return send_from_directory(str(FRONTEND_DIR), "index.html")
    return _error("Frontend not built. Run: npm run build", 500)
