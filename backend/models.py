import json
from dataclasses import dataclass, asdict, field
from typing import Optional


def _camel(s: str) -> str:
    first, *rest = s.split("_")
    return first + "".join(w.capitalize() for w in rest)


def dumps(obj):
    return json.dumps(obj, default=_serialize, ensure_ascii=False)


def _serialize(o):
    if hasattr(o, "__dataclass_fields__"):
        return {_camel(k): v for k, v in asdict(o).items()}
    return str(o)


@dataclass
class EnvironmentStatus:
    data_dir: str = ""
    has_ffmpeg: bool = False
    has_ffprobe: bool = False
    has_deepgram_key: bool = False
    has_anthropic_key: bool = False
    has_deepseek_key: bool = False
    llm_provider: str = "deepseek"


@dataclass
class MediaProbe:
    duration_sec: Optional[float] = None
    has_video: bool = False
    width: Optional[int] = None
    height: Optional[int] = None
    video_codec: Optional[str] = None
    audio_codec: Optional[str] = None


@dataclass
class Project:
    id: str = ""
    name: Optional[str] = None
    source_path: str = ""
    source_duration: Optional[float] = None
    status: str = "ingest"
    transcription_mode: str = ""
    created_at: str = ""
    updated_at: str = ""


@dataclass
class Transcript:
    id: str = ""
    project_id: str = ""
    engine: str = ""
    raw_json: str = ""
    language: Optional[str] = None
    created_at: str = ""


@dataclass
class Candidate:
    id: str = ""
    project_id: str = ""
    start_sec: float = 0.0
    end_sec: float = 0.0
    score: float = 0.0
    hook: str = ""
    rationale: str = ""
    rank: int = 0
    selected: bool = False


@dataclass
class Clip:
    id: str = ""
    candidate_id: str = ""
    status: str = "pending"
    output_path: Optional[str] = None
    face_track_json: Optional[str] = None
    caption_ass_path: Optional[str] = None
    render_log: Optional[str] = None


@dataclass
class ClipCopy:
    id: str = ""
    clip_id: str = ""
    platform: str = ""
    hook_text: Optional[str] = None
    caption_text: Optional[str] = None
    hashtags: Optional[str] = None


@dataclass
class ProjectDetail:
    project: Optional[Project] = None
    transcript: Optional[Transcript] = None
    candidates: list[Candidate] = field(default_factory=list)
    clips: list[Clip] = field(default_factory=list)
    copy: list[ClipCopy] = field(default_factory=list)


@dataclass
class TranscriptWord:
    text: str = ""
    start: float = 0.0
    end: float = 0.0
    speaker: Optional[str] = None


@dataclass
class TranscriptSegment:
    start: float = 0.0
    end: float = 0.0
    speaker: Optional[str] = None
    text: str = ""


@dataclass
class NormalizedTranscript:
    language: str = "en"
    duration: float = 0.0
    speakers: list[str] = field(default_factory=lambda: ["A"])
    words: list[TranscriptWord] = field(default_factory=list)
    segments: list[TranscriptSegment] = field(default_factory=list)


@dataclass
class CandidateDraft:
    start: float = 0.0
    end: float = 0.0
    score: float = 0.0
    hook: str = ""
    rationale: str = ""
