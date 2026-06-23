import httpx
from .models import NormalizedTranscript, TranscriptWord, TranscriptSegment


async def transcribe_deepgram(audio_path: str, api_key: str) -> NormalizedTranscript:
    with open(audio_path, "rb") as f:
        audio_data = f.read()
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(
            "https://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&utterances=true&language=en",
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "audio/wav",
            },
            content=audio_data,
        )
    data = r.json()
    results = data["results"]
    channels = results["channels"][0]
    alternatives = channels["alternatives"][0]
    words = []
    for w in alternatives.get("words", []):
        words.append(TranscriptWord(
            text=w["word"],
            start=w["start"],
            end=w["end"],
            speaker=w.get("speaker"),
        ))
    segments = build_segments(words)
    return NormalizedTranscript(
        language=alternatives.get("language", "en"),
        duration=alternatives.get("duration", 0.0) or (
            words[-1].end if words else 0.0
        ),
        speakers=list({s.speaker for s in segments if s.speaker}),
        words=words,
        segments=segments,
    )


def build_segments(words: list[TranscriptWord]) -> list[TranscriptSegment]:
    if not words:
        return []
    segments = []
    current = TranscriptSegment(
        start=words[0].start, end=words[0].end,
        speaker=words[0].speaker, text=words[0].text
    )
    for w in words[1:]:
        if w.speaker != current.speaker or w.start - current.end > 2.0:
            segments.append(current)
            current = TranscriptSegment(
                start=w.start, end=w.end, speaker=w.speaker, text=w.text
            )
        else:
            current.end = w.end
            current.text += " " + w.text
    segments.append(current)
    return segments
