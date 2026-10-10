import re
from typing import Any, Dict, List, Optional, Tuple

DURATION_SPECS = {
    "30s": {
        "label": "30 segundos",
        "instruction": "Cada clip DEBE durar aproximadamente 30 segundos (rango permitido: 30 a 50 segundos, mínimo 30 segundos).",
        "min": 30.0,
        "max": 50.0,
    },
    "60s": {
        "label": "1 minuto",
        "instruction": "Cada clip DEBE durar aproximadamente 1 minuto (rango permitido: 45 a 75 segundos).",
        "min": 45.0,
        "max": 75.0,
    },
    "2m": {
        "label": "2 minutos",
        "instruction": "Cada clip DEBE durar aproximadamente 2 minutos (rango permitido: 105 a 140 segundos).",
        "min": 105.0,
        "max": 140.0,
    },
    "3m": {
        "label": "3 minutos",
        "instruction": "Cada clip DEBE durar aproximadamente 3 minutos completos (rango permitido: 165 a 210 segundos, alrededor de 3 minutos).",
        "min": 165.0,
        "max": 210.0,
    },
    "5m": {
        "label": "5 minutos",
        "instruction": "Cada clip DEBE durar aproximadamente 5 minutos completos (rango permitido: 270 a 330 segundos, es decir ~5 minutos, NUNCA clips cortos de 2 o 3 minutos).",
        "min": 270.0,
        "max": 330.0,
    },
}


def parse_time_to_seconds(time_str: str) -> float:
    clean_time = re.sub(r"[^\d:\.]", "", str(time_str).strip())
    parts = clean_time.split(":")
    try:
        if len(parts) == 3:
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        elif len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            clean = re.sub(r"[^\d\.]", "", parts[0])
            return float(clean) if clean else 0.0
    except Exception:
        return 0.0
    return 0.0


def parse_markdown_clips(text: str) -> List[Dict[str, Any]]:
    """
    Parses plain text clips formatted like:
    [CLIP 1]
    - Tiempo de Inicio: 00:03:26
    - Tiempo de Fin: 00:04:12
    - Hook en Pantalla: ¡NO ME LO CREO!
    - Descripción: Jugada impresionante...
    """
    clip_blocks = re.split(r"\[CLIP\s*\d+\]", text, flags=re.IGNORECASE)
    results = []
    for block in clip_blocks:
        if not block.strip():
            continue
        start_match = re.search(r"Tiempo\s+de\s+Inicio\s*:\s*([^\n\r]+)", block, re.IGNORECASE)
        end_match = re.search(r"Tiempo\s+de\s+Fin\s*:\s*([^\n\r]+)", block, re.IGNORECASE)
        hook_match = re.search(r"Hook(?:\s+en\s+Pantalla)?\s*:\s*([^\n\r]+)", block, re.IGNORECASE)
        desc_match = re.search(r"Descripci[oó]n\s*:\s*([^\n\r]+)", block, re.IGNORECASE)
        cat_match = re.search(r"Categor[ií]a\s*:\s*([^\n\r]+)", block, re.IGNORECASE)

        if start_match and end_match:
            start_sec = parse_time_to_seconds(start_match.group(1))
            end_sec = parse_time_to_seconds(end_match.group(1))
            hook = hook_match.group(1).strip() if hook_match else "Momento Viral"
            desc = desc_match.group(1).strip() if desc_match else ""
            cat = cat_match.group(1).strip() if cat_match else ""

            rationale = f"Categoría: {cat}" if cat else "Momento destacado por alto potencial de viralidad."
            if not desc:
                desc = f"{hook} - ¡Mira este clip increíble! #viral #gaming #shorts"

            results.append({
                "start": start_sec,
                "end": end_sec,
                "score": 0.90,
                "hook": hook,
                "rationale": rationale,
                "description": desc
            })
    return results


DEFAULT_MOMENTS_PROMPT = """Eres un editor profesional de clips virales para TikTok, YouTube Shorts y Reels.
Tu misión es encontrar los mejores momentos del video o stream:
- Jugadas destacadas, clutches, partidas épicas o acción intensa.
- Momentos divertidos, risas, gritos, enfados, sustos o celebraciones.
- Fails cómicos, anécdotas, debates, discusiones o explicaciones clave.
- Remates y frases de alto impacto que enganchen desde el primer segundo."""


def build_system_prompt(
    content_type: str = "gaming",
    target_duration: str = "60s",
    has_thinking: bool = False,
    custom_prompt: Optional[str] = None
) -> str:
    dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
    dur_rule = dur_info["instruction"]

    if custom_prompt and custom_prompt.strip():
        focus_text = custom_prompt.strip()
    else:
        focus_dict = {
            "gaming": """Eres un editor profesional de clips de GAMING para TikTok, YouTube Shorts y Reels virales.
Tu misión es encontrar los mejores momentos de gameplays, directos o torneos:
- Jugadas destacadas, clutches, kills o partidas épicas.
- Momentos divertidos, risas, gritos, enfados (rage), sustos o celebraciones.
- Fails cómicos, bugs o troleos.
- Anuncios de torneos, retos 1v1, fechas o reglas del juego.
- Remates y anécdotas entretenidas.""",
            "tutorial": """Eres un editor profesional de contenido educativo, tutoriales y avisos para Shorts/Reels/TikTok.
Tu misión es encontrar los mejores segmentos con valor informativo:
- Explicaciones claras de cómo hacer algo o resolver un problema.
- Trucos (tips, hacks) o configuraciones clave.
- Anuncios oficiales, convocatorias o fechas importantes.""",
            "podcast": """Eres un estratega de redes sociales buscando momentos virales en podcasts, entrevistas y charlas.
Tu misión es encontrar historias fascinantes, opiniones controvertidas o lecciones impactantes.""",
            "general": DEFAULT_MOMENTS_PROMPT
        }
        focus_text = focus_dict.get(content_type, focus_dict["gaming"])

    thinking_guide = ""
    if has_thinking:
        thinking_guide = f"""
PROCESO DE RAZONAMIENTO (THINKING):
- En tu razonamiento interno (thinking), analiza la transcripción de forma directa y concisa (máximo 15 a 20 líneas de razonamiento).
- Calcula la duración exacta de cada candidato restando (end - start).
- Verifica estrictamente que cada momento cumpla con la duración objetivo solicitada ({dur_rule}). Si el gancho inicial dura poco, revisa los segmentos contiguos y extiende 'end' hasta completar la jugada, anécdota o remate cómico.
- Tras razonar brevemente, produce inmediatamente el objeto JSON final con datos reales (sin puntos suspensivos "..." ni 0.0)."""

    return f"""{focus_text}

REGLAS DE DURACIÓN Y TIMESTAMPS:
- CRÍTICO: {dur_rule}
- NO elijas solo una frase corta de 2 a 5 segundos. El timestamp 'start' debe marcar el inicio del momento y 'end' debe abarcar el desarrollo completo hasta alcanzar la duración objetivo indicada.
- SILENCIO Y ACCIÓN: En streams de gaming, a veces el streamer se concentra y no habla mientras dispara o juega una ronda tensa. Si la transcripción incluye notas como [ACCIÓN DE JUEGO / DISPAROS / ALTA CONCENTRACIÓN] o si hay una jugada tensa con poco diálogo, selecciónala como un clip épico de gameplay.
- 'hook': Título gancho llamativo, directo y viral (en Español).
- 'hook_title': Titular corto y punchy de 3 a 7 palabras para mostrar en pantalla grande al inicio del clip (ej. "¡Clutch 1v3 Imposible!", "¿Quién me invitó a la sala?", "El fallo más tonto").
- 'rationale': Explicación breve de por qué este momento es entretenido o viral.
- 'virality': Desglose de puntuación viral (0 a 25 cada métrica): {{"hook_score": 24, "engagement_score": 23, "value_score": 19, "shareability_score": 24, "hook_type": "reacción"}} (donde hook_type es: "pregunta", "reacción", "anécdota", "contraste" o "destacado").
- 'description': Descripción optimizada para redes sociales (TikTok, Reels, Shorts, X) de 1 a 2 frases vendedoras invitando a interactuar, con 3 a 4 hashtags relevantes (ej. #gaming #clipviral).{thinking_guide}

REGLAS ESTRICTAS DE RESPUESTA:
- NUNCA devuelvas puntos suspensivos ("...") ni valores en 0.0.
- Extrae momentos reales con timestamps y textos concretos de la transcripción.
- Devuelve entre 1 y 5 candidatos en formato JSON exactamente con esta estructura:
{{"candidates":[{{"start":15.0,"end":315.0,"score":0.95,"hook":"¡Jugada Épica y Victoria!","hook_title":"¡Clutch 1v3 Imposible!","rationale":"Momento de alta tensión y clutch impresionante","virality":{{"hook_score":24,"engagement_score":23,"value_score":19,"shareability_score":24,"hook_type":"reacción"}},"description":"¡Mira lo que pasó en esta partida! 🔥 #gaming #viral"}}]}}

IMPORTANTE: Analiza en español y genera todos los textos estrictamente en Español. No traduzcas al inglés."""


def strip_emojis_from_text(text: str) -> str:
    """Strips all emoji icons from text strings for clean filenames and chapter displays."""
    clean = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', text)
    return re.sub(r'\s+', ' ', clean).strip()


def locate_moment_active_window(
    candidate: Dict[str, Any],
    target_dur: float,
    transcript_segments: Optional[List[Dict[str, Any]]] = None,
    max_source_duration: Optional[float] = None
) -> Tuple[float, float]:
    """
    Intelligently identifies the exact active time window for a candidate moment.
    If the candidate is shorter than target_dur, expands context (setup + aftermath) around the play.
    If longer, pinpoints the climactic anchor (shots, screams, keywords) and extracts target_dur.
    """
    c_start = float(candidate.get("startSec", candidate.get("start", 0.0)))
    c_end = float(candidate.get("endSec", candidate.get("end", c_start + target_dur)))
    c_dur = max(1.0, c_end - c_start)

    if c_dur < target_dur:
        deficit = target_dur - c_dur
        new_start = max(0.0, c_start - (deficit * 0.40))
        new_end = new_start + target_dur
        if max_source_duration and new_end > max_source_duration:
            new_end = max_source_duration
            new_start = max(0.0, new_end - target_dur)
        return round(new_start, 2), round(new_end, 2)

    hook_text = str(candidate.get("hook", ""))
    rationale_text = str(candidate.get("rationale", ""))
    combined_meta = f"{hook_text} {rationale_text}".lower()
    combined_meta = re.sub(r'[^\w\s]', ' ', combined_meta)

    stopwords = {
        'el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'una', 'los', 'las', 'por', 'con', 'no',
        'es', 'mi', 'se', 'del', 'al', 'lo', 'su', 'más', 'pero', 'sus', 'le', 'ya', 'o', 'fue',
        'este', 'ha', 'si', 'porque', 'esta', 'son', 'entre', 'está', 'cuando', 'muy', 'sin',
        'sobre', 'ser', 'tiene', 'también', 'me', 'hasta', 'hay', 'donde', 'quien', 'desde',
        'todo', 'nos', 'durante', 'todos', 'uno', 'les', 'ni', 'contra', 'otros', 'ese', 'eso',
        'ante', 'ellos', 'e', 'esto', 'mí', 'antes', 'algunos', 'qué', 'unos', 'yo', 'otro',
        'otras', 'otra', 'él', 'tanto', 'esa', 'estos', 'mucho', 'quienes', 'nada', 'muchos',
        'cual', 'poco', 'ella', 'estar', 'estas', 'algunas', 'algo', 'nosotros', 'para', 'como',
        'the', 'and', 'that', 'this', 'with', 'from', 'have', 'for', 'you', 'was', 'are'
    }
    keywords = [w for w in combined_meta.split() if len(w) > 3 and w not in stopwords]

    c_segs = [
        s for s in (transcript_segments or [])
        if float(s.get("start", 0.0)) >= (c_start - 2.0) and float(s.get("end", 0.0)) <= (c_end + 2.0)
    ]

    best_anchor = None
    best_score = -1.0

    if c_segs:
        for s in c_segs:
            text = str(s.get("text", "")).lower()
            if not text.strip():
                continue
            kw_hits = sum(1 for kw in keywords if kw in text)
            score = kw_hits * 12.0
            raw_text = str(s.get("text", ""))
            if "!" in raw_text or "¿" in raw_text or "?" in raw_text:
                score += 3.0
            if "disparo" in text or "grito" in text or "acción" in text or "accion" in text or "euforia" in text:
                score += 18.0
            score += len(text.split()) * 0.15

            if score > best_score and (kw_hits > 0 or score >= 4.0):
                best_score = score
                best_anchor = float(s["start"])

    if best_anchor is None:
        best_anchor = c_start + (c_dur * 0.25)

    lead_in = target_dur * 0.35
    sub_start = max(c_start, best_anchor - lead_in)
    sub_end = min(c_end, sub_start + target_dur)

    if (sub_end - sub_start) < target_dur:
        sub_start = max(c_start, sub_end - target_dur)

    return round(sub_start, 2), round(sub_end, 2)
