import json
import os
import httpx
from .models import NormalizedTranscript, CandidateDraft

SYSTEM_PROMPT = """You are a viral clip analyst. Given a transcript with word-level timing, identify the top short-form clip candidates (5-30 seconds each) that would perform well as vertical shorts/reels. For each candidate:

- `start` / `end` in seconds
- `score` 0.0-1.0 (viral potential)
- `hook` — one-line hook title
- `rationale` — why this moment works

Return ONLY a JSON array of objects with those keys. No markdown, no explanation."""


def _format_transcript(t: NormalizedTranscript) -> str:
    lines = []
    for seg in t.segments:
        speaker = f"[{seg.speaker}] " if seg.speaker else ""
        ts = f"{seg.start:.1f}s-{seg.end:.1f}s"
        lines.append(f"{ts} {speaker}{seg.text}")
    return "\n".join(lines)


async def detect_candidates_with_deepseek(
    transcript: NormalizedTranscript, api_key: str
) -> list[CandidateDraft]:
    text = _format_transcript(transcript)
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.deepseek.com/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
                "response_format": {"type": "json_object"},
            },
        )
    data = r.json()
    content = data["choices"][0]["message"]["content"]
    return [CandidateDraft(**c) for c in json.loads(content)]


async def detect_candidates_with_claude(
    transcript: NormalizedTranscript, api_key: str
) -> list[CandidateDraft]:
    text = _format_transcript(transcript)
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 4096,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": text}],
            },
        )
    data = r.json()
    content = data["content"][0]["text"]
    return [CandidateDraft(**c) for c in json.loads(content)]
