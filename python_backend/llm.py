import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
import requests

from python_backend.llm_prompts import (
    DURATION_SPECS,
    parse_time_to_seconds,
    parse_markdown_clips,
    DEFAULT_MOMENTS_PROMPT,
    build_system_prompt,
    strip_emojis_from_text,
    locate_moment_active_window,
)


def unload_all_ollama_models(specific_model: Optional[str] = None):
    """
    Unloads Ollama models from VRAM immediately so RAM/VRAM is freed for other tasks or models.
    """
    try:
        if specific_model:
            requests.post("http://127.0.0.1:11434/api/generate", json={"model": specific_model, "keep_alive": 0}, timeout=5)
        resp = requests.get("http://127.0.0.1:11434/api/ps", timeout=5)
        if resp.ok:
            data = resp.json()
            for m in data.get("models", []):
                m_name = m.get("name") or m.get("model")
                if m_name:
                    requests.post("http://127.0.0.1:11434/api/generate", json={"model": m_name, "keep_alive": 0}, timeout=5)
        print("VRAM liberada: Modelos de Ollama descargados de memoria.")
    except Exception as e:
        print(f"Nota al descargar modelos de Ollama: {e}")


def unload_all_lmstudio_models(base_url: Optional[str] = None):
    """
    Unloads all LM Studio models/instances from VRAM immediately and aborts active generations.
    """
    try:
        raw_url = (base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
        root_url = raw_url[:-3] if raw_url.endswith("/v1") else raw_url
        resp = requests.get(f"{root_url}/api/v1/models", timeout=3)
        if resp.ok:
            data = resp.json()
            for m in data.get("models", []):
                for inst in m.get("loaded_instances", []):
                    inst_id = inst.get("id")
                    if inst_id:
                        requests.post(f"{root_url}/api/v1/models/unload", json={"instance_id": inst_id}, timeout=3)
                        print(f"VRAM liberada: Modelo de LM Studio '{inst_id}' descargado de memoria.")
    except Exception as e:
        print(f"Nota al descargar modelos de LM Studio: {e}")


def get_loaded_models_status(provider: Optional[str] = None, lmstudio_base_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Checks Ollama and/or LM Studio to detect if any model is actively resident in VRAM/RAM.
    """
    result = {
        "isLoaded": False,
        "loadedModel": None,
        "provider": None,
        "sizeMb": None,
        "details": []
    }

    # 1. Check Ollama
    if not provider or provider in ["local", "ollama"]:
        try:
            resp = requests.get("http://127.0.0.1:11434/api/ps", timeout=1.5)
            if resp.ok:
                data = resp.json()
                models = data.get("models", [])
                if models:
                    m = models[0]
                    name = m.get("name") or m.get("model") or "ollama-model"
                    size_b = m.get("size_vram") or m.get("size") or 0
                    result["isLoaded"] = True
                    result["loadedModel"] = name
                    result["provider"] = "ollama"
                    result["sizeMb"] = round(size_b / (1024 * 1024)) if size_b else None
                    result["details"] = [
                        {
                            "name": (x.get("name") or x.get("model")),
                            "sizeMb": round((x.get("size_vram") or x.get("size") or 0) / (1024 * 1024))
                        }
                        for x in models
                    ]
                    return result
        except Exception:
            pass

    # 2. Check LM Studio
    if not provider or provider == "lmstudio":
        try:
            raw_url = (lmstudio_base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
            root_url = raw_url[:-3] if raw_url.endswith("/v1") else raw_url
            resp = requests.get(f"{root_url}/api/v1/models", timeout=1.5)
            if resp.ok:
                data = resp.json()
                for m in data.get("models", []):
                    instances = m.get("loaded_instances", [])
                    if instances:
                        result["isLoaded"] = True
                        result["loadedModel"] = m.get("display_name") or m.get("key") or m.get("id")
                        result["provider"] = "lmstudio"
                        size_b = m.get("size_bytes", 0)
                        result["sizeMb"] = round(size_b / (1024 * 1024)) if size_b else None
                        result["details"] = [{"name": m.get("key") or m.get("id"), "sizeMb": result["sizeMb"]}]
                        return result
        except Exception:
            pass

    return result


def preload_local_model(model_name: str, provider: str = "local", lmstudio_base_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Explicitly loads and pins a model into VRAM/RAM so subsequent generations are instant.
    """
    if provider in ["local", "ollama"]:
        try:
            resp = requests.post(
                "http://127.0.0.1:11434/api/generate",
                json={"model": model_name, "prompt": "", "keep_alive": -1},
                timeout=120
            )
            if resp.ok:
                print(f"Modelo Ollama '{model_name}' pre-cargado con éxito en VRAM.")
                return {"success": True, "model": model_name, "provider": "ollama"}
            else:
                return {"success": False, "error": f"Ollama HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    elif provider == "lmstudio":
        try:
            raw_url = (lmstudio_base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
            resp = requests.post(
                f"{raw_url}/chat/completions",
                json={
                    "model": model_name or "local-model",
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1
                },
                timeout=120
            )
            if resp.ok:
                print(f"Modelo LM Studio '{model_name}' pre-cargado con éxito en memoria.")
                return {"success": True, "model": model_name, "provider": "lmstudio"}
            else:
                return {"success": False, "error": f"LM Studio HTTP {resp.status_code}: {resp.text}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": f"El proveedor {provider} no admite carga en VRAM local."}


def compact_segments(segments: List[Dict[str, Any]]) -> str:
    lines = []
    for s in segments:
        spk = s.get("speaker", "Hablante")
        lines.append(f"[{s['start']:.2f}-{s['end']:.2f}] {spk}: {s['text']}")
    return "\n".join(lines)


def expand_short_candidate(
    start: float,
    end: float,
    segments: Optional[List[Dict[str, Any]]],
    target_min: float = 30.0,
    target_max: float = 60.0
) -> tuple[float, float]:
    """
    If the LLM selected only a short hook sentence, this expands the clip forward
    across subsequent speech segments so the viewer gets the full context or play.
    """
    dur = end - start
    if not segments:
        if dur < target_min:
            return start, start + target_min
        return start, min(end, start + target_max)

    target_ideal = (target_min + target_max) / 2.0
    if dur >= target_min:
        return start, min(end, start + target_max)

    # Find the segment closest to start
    start_idx = 0
    for i, s in enumerate(segments):
        if s["start"] <= start <= s["end"] or abs(s["start"] - start) < 2.0:
            start_idx = i
            break

    # Expand end timestamp across subsequent segments until reaching target_ideal
    new_end = end
    for s in segments[start_idx:]:
        new_end = max(new_end, s["end"])
        if (new_end - start) >= target_ideal:
            break

    # If still shorter than target_min (e.g. speech ended), extend numerically
    if (new_end - start) < target_min:
        new_end = start + target_min

    return start, min(new_end, start + target_max)


def parse_candidate_json(
    text: str,
    min_duration: float = 5.0,
    segments: Optional[List[Dict[str, Any]]] = None,
    target_duration: str = "60s"
) -> List[Dict[str, Any]]:
    clean = text.strip()
    # Strip any thinking tags if present in text
    clean = re.sub(r"<think>.*?</think>", "", clean, flags=re.DOTALL).strip()
    clean = re.sub(r"^```json\s*", "", clean)
    clean = re.sub(r"^```\s*", "", clean)

    val = None
    # 1. Try raw_decode from first '{' (safely ignores any trailing CoT thinking or text)
    start_brace = clean.find('{')
    if start_brace != -1:
        try:
            val, _ = json.JSONDecoder().raw_decode(clean[start_brace:])
        except Exception:
            pass

    # 2. Try raw_decode from first '['
    if val is None:
        start_bracket = clean.find('[')
        if start_bracket != -1:
            try:
                val, _ = json.JSONDecoder().raw_decode(clean[start_bracket:])
            except Exception:
                pass

    # 3. Fallback regex
    if val is None:
        match = re.search(r"(\{.*\})", clean, re.DOTALL)
        if match:
            try:
                val = json.loads(match.group(1))
            except Exception:
                pass

    # 4. Auto-repair unclosed/truncated JSON (when LLM hit token limits mid-output)
    if val is None:
        start_pos = clean.find('{')
        if start_pos != -1:
            trimmed = clean[start_pos:].strip()
            trimmed = re.sub(r",\s*$", "", trimmed)
            if trimmed.count('"') % 2 != 0:
                trimmed += '"'
            open_cur = trimmed.count("{") - trimmed.count("}")
            open_sq = trimmed.count("[") - trimmed.count("]")
            for closer in [
                ("}" * max(0, open_cur - 1) + "]" * max(0, open_sq) + "}"),
                ("}" * max(0, open_cur) + "]" * max(0, open_sq)),
                ("]" * max(0, open_sq) + "}" * max(0, open_cur)),
            ]:
                try:
                    repaired_val = json.loads(trimmed + closer)
                    if repaired_val and isinstance(repaired_val, (dict, list)):
                        val = repaired_val
                        break
                except Exception:
                    pass

    # 5. Final attempt
    if val is None:
        try:
            val = json.loads(clean)
        except Exception:
            val = None

    candidates_arr = None
    if isinstance(val, list):
        candidates_arr = val
    elif isinstance(val, dict):
        for key in ["candidates", "Candidates", "moments", "clips", "segments", "results"]:
            if key in val and isinstance(val[key], list):
                candidates_arr = val[key]
                break
        if candidates_arr is None and "start" in val and "end" in val:
            candidates_arr = [val]

    # 6. Plain-text markdown fallback (e.g. user prompts requiring [CLIP 1], Tiempo de Inicio...)
    if not candidates_arr:
        candidates_arr = parse_markdown_clips(clean)

    if not candidates_arr:
        return []

    dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
    target_min = dur_info["min"]
    target_max = dur_info["max"]

    drafts = []
    for item in candidates_arr:
        try:
            start = float(item.get("start", 0.0))
            end = float(item.get("end", 0.0))
            score = float(item.get("score", 0.8))
            if score > 1.0 and score <= 10.0:
                score /= 10.0
            elif score > 10.0:
                score /= 100.0

            hook = str(item.get("hook", "")).strip()
            rationale = str(item.get("rationale", "")).strip()
            description = str(item.get("description", "")).strip()

            # STRICT FILTER: Discard placeholder candidates with empty or ellipsis text ("...")
            clean_hook = hook.strip(" .…_")
            if not clean_hook or clean_hook in ["...", "…", "None", "null", "undefined"]:
                continue
            if hook == "..." or rationale == "..." or description == "...":
                continue
            if start == 0.0 and end == 0.0 and len(clean_hook) < 5:
                continue

            if not description and hook:
                description = f"{hook}. ¡Mira este momento destacado! #autoshorts #viral #clips"

            # Automatically expand clips if the candidate duration is under target_min
            dur = end - start
            if dur < target_min:
                start, end = expand_short_candidate(
                    start, end, segments,
                    target_min=target_min,
                    target_max=target_max
                )
            dur = end - start
            # Enforce minimum 30s (or 25s for 30s target)
            min_floor = 25.0 if target_duration == "30s" else 30.0
            if dur < min_floor:
                end = start + max(min_floor, target_min)
                dur = end - start

            effective_min = min_floor if target_duration == "30s" else max(30.0, target_min * 0.6)
            if dur >= effective_min and hook:
                hook_title = str(item.get("hook_title") or item.get("hookTitle") or "").strip()
                virality = item.get("virality")
                if not isinstance(virality, dict):
                    score_val = max(0.0, min(1.0, score))
                    total_s = max(50, min(99, int(round(score_val * 100))))
                    hook_type = "pregunta" if "?" in hook else "reacción" if "!" in hook else "destacado"
                    virality = {
                        "hook_score": max(12, min(25, int(round((total_s / 100.0) * 25)))),
                        "engagement_score": max(12, min(25, int(round((total_s / 100.0) * 24)))),
                        "value_score": max(10, min(25, int(round((total_s / 100.0) * 22)))),
                        "shareability_score": max(12, min(25, int(round((total_s / 100.0) * 24)))),
                        "total_score": total_s,
                        "hook_type": hook_type
                    }
                drafts.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "score": max(0.0, min(1.0, score)),
                    "hook": hook,
                    "hook_title": hook_title,
                    "virality": virality,
                    "rationale": rationale,
                    "description": description
                })
        except Exception:
            continue

    return drafts


def partition_segments(
    segments: List[Dict[str, Any]],
    chunk_duration_sec: float = 600.0,
    overlap_sec: float = 45.0
) -> List[List[Dict[str, Any]]]:
    """
    Partitions transcript into windows of chunk_duration_sec (default: 10 min = 600s),
    with overlap_sec (45s) so no moments on the boundary are lost.
    """
    if not segments:
        return []

    total_duration = segments[-1]["end"]
    if total_duration <= (chunk_duration_sec + overlap_sec):
        return [segments]

    chunks = []
    step = chunk_duration_sec - overlap_sec
    window_start = 0.0

    while window_start < total_duration:
        window_end = window_start + chunk_duration_sec
        chunk_segs = [s for s in segments if s["end"] > window_start and s["start"] < window_end]
        if chunk_segs:
            chunks.append(chunk_segs)
        window_start += step

    return chunks


_THINKING_CACHE: Dict[str, bool] = {}


def detect_model_thinking_capability(model_name: str) -> bool:
    """
    Detects whether an Ollama model supports native thinking/reasoning (Chain of Thought),
    inspecting /api/show capabilities, template, details, or model family.
    Works for any model (gemma4, qwen3.5, deepseek-r1, qwq, etc.) even when 'think'
    is not in the model name.
    """
    if not model_name:
        return False
    if model_name in _THINKING_CACHE:
        return _THINKING_CACHE[model_name]

    try:
        resp = requests.post("http://127.0.0.1:11434/api/show", json={"name": model_name}, timeout=3)
        if resp.ok:
            data = resp.json()
            # 1. Official capabilities list in Ollama v0.5+
            caps = [str(c).lower() for c in data.get("capabilities", [])]
            if "thinking" in caps:
                _THINKING_CACHE[model_name] = True
                return True

            # 2. Template inspection
            template = data.get("template", "").lower()
            if "<think>" in template or "thinking" in template:
                _THINKING_CACHE[model_name] = True
                return True

            # 3. Families and details
            details = data.get("details", {})
            family = str(details.get("family", "")).lower()
            families = [str(f).lower() for f in details.get("families", [])]
            if any(f in ["deepseek2", "deepseek3", "qwen35", "gemma4"] for f in [family] + families):
                _THINKING_CACHE[model_name] = True
                return True
    except Exception as e:
        print(f"Nota al comprobar capacidades de thinking para {model_name}: {e}")

    # 4. Fallback: keywords in model name
    lower_name = model_name.lower()
    has_think = any(kw in lower_name for kw in ["r1", "qwq", "think", "reason", "cot"])
    _THINKING_CACHE[model_name] = has_think
    return has_think


def call_ollama(
    prompt: str,
    model_name: str = "qwen2.5:7b",
    content_type: str = "gaming",
    target_duration: str = "60s",
    enable_thinking: bool = False,
    custom_prompt: Optional[str] = None
) -> str:
    has_thinking = enable_thinking and detect_model_thinking_capability(model_name)
    system_prompt = build_system_prompt(content_type, target_duration, has_thinking=has_thinking, custom_prompt=custom_prompt)
    url = "http://127.0.0.1:11434/api/chat"

    num_ctx_val = 16384 if has_thinking else 8192
    num_predict_val = 4096 if has_thinking else 2048

    payload: Dict[str, Any] = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.2,
            "num_ctx": num_ctx_val,
            "num_predict": num_predict_val
        }
    }

    if not has_thinking:
        payload["think"] = False
    else:
        payload["think"] = True

    resp = requests.post(url, json=payload, timeout=300)
    if not resp.ok and "format" in payload:
        # Fallback if specific older Ollama engine doesn't allow format with thinking
        payload.pop("format", None)
        resp = requests.post(url, json=payload, timeout=300)

    if not resp.ok:
        raise RuntimeError(f"Ollama call failed ({resp.status_code}): {resp.text}")
    data = resp.json()
    msg = data.get("message", {})
    thinking = msg.get("thinking", "")
    content = msg.get("content", "")

    # Extract inline <think> tags if model formatted them in content
    if "<think>" in content:
        inline_thinks = re.findall(r"<think>(.*?)</think>", content, re.DOTALL)
        if inline_thinks and not thinking:
            thinking = "\n".join(inline_thinks).strip()
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

    # Fallback: if content is empty but thinking contains the JSON object
    if not content and thinking:
        m = re.search(r"(\{.*\"candidates\".*\})", thinking, re.DOTALL)
        if m:
            content = m.group(1)

    if thinking:
        try:
            print(f"[Thinking {model_name} ({len(thinking)} chars)]: {thinking[:150].strip()}...")
        except Exception:
            pass

    return content



def robust_cloud_post(
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    provider_name: str,
    max_retries: int = 4,
    timeout: int = 150
) -> requests.Response:
    """
    Sends request to cloud LLM provider with automatic exponential backoff
    on HTTP 429 (Rate Limit / Too Many Requests) and HTTP 502/503/504.
    """
    last_resp = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
            last_resp = resp
        except requests.exceptions.RequestException as req_err:
            if attempt == max_retries:
                raise RuntimeError(f"Error de conexión con {provider_name}: {req_err}")
            wait_time = attempt * 5.0
            print(f"⚠️ Fallo de conexión con {provider_name}. Reintentando en {wait_time}s ({attempt}/{max_retries})...")
            time.sleep(wait_time)
            continue

        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After")
            try:
                wait_sec = float(retry_after) if retry_after else (attempt * 7.0 + 3.0)
            except Exception:
                wait_sec = attempt * 7.0 + 3.0
            print(f"⚠️ [Rate Limit 429] {provider_name} alcanzó su límite de velocidad. Esperando {wait_sec:.1f}s antes de reintentar (intento {attempt}/{max_retries})...")
            time.sleep(wait_sec)
            continue

        if resp.status_code in [502, 503, 504, 529]:
            wait_sec = attempt * 5.0
            print(f"⚠️ [{resp.status_code}] Servidor {provider_name} saturado. Esperando {wait_sec:.1f}s (intento {attempt}/{max_retries})...")
            time.sleep(wait_sec)
            continue

        return resp

    return last_resp


def call_lmstudio(
    prompt: str,
    model_name: Optional[str] = None,
    content_type: str = "gaming",
    target_duration: str = "60s",
    custom_prompt: Optional[str] = None,
    base_url: Optional[str] = None,
    enable_thinking: bool = False
) -> str:
    url = (base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
    system_prompt = build_system_prompt(content_type, target_duration, custom_prompt=custom_prompt)
    model = model_name or "local-model"

    if not enable_thinking:
        thinking_instruction = "\n\n[MODO DIRECTO ULTRARRÁPIDO]: PROHIBIDO razonar o pensar en voz alta. NO uses etiquetas <think> ni explicaciones. Responde DIRECTAMENTE con el formato JSON solicitado."
    else:
        thinking_instruction = "\n\nResponde ÚNICAMENTE en formato JSON válido."

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt + thinking_instruction},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2,
        "enable_thinking": bool(enable_thinking),
        "chat_template_config": {"reasoning": "on" if enable_thinking else "off", "enable_thinking": bool(enable_thinking)}
    }
    if not enable_thinking:
        payload["reasoning_effort"] = "none"

    try:
        resp = requests.post(url, json=payload, timeout=240)
    except Exception as e:
        raise RuntimeError(f"No se pudo conectar a LM Studio en {url}. ¿Está iniciado el servidor local en LM Studio? Detalle: {e}")

    if not resp.ok:
        raise RuntimeError(f"LM Studio call failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError(f"LM Studio returned empty choices: {resp.text}")

    msg_obj = choices[0].get("message", {})
    content = msg_obj.get("content") or ""
    if not content and msg_obj.get("reasoning_content"):
        rc = msg_obj.get("reasoning_content", "")
        m = re.search(r"(\{.*\"candidates\".*\})", rc, re.DOTALL)
        content = m.group(1) if m else rc

    if "<think>" in content:
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL).strip()

    return content


def call_cloud_llm(
    provider: str,
    api_key: str,
    prompt: str,
    model_name: Optional[str] = None,
    content_type: str = "gaming",
    target_duration: str = "60s",
    custom_prompt: Optional[str] = None
) -> str:
    system_prompt = build_system_prompt(content_type, target_duration, custom_prompt=custom_prompt)
    full_prompt = f"{system_prompt}\n\n{prompt}"

    if provider == "openrouter":
        url = "https://openrouter.ai/api/v1/chat/completions"
        model = model_name or os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://autoshorts.local",
            "X-Title": "AutoShorts Desktop",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }
        resp = robust_cloud_post(url, headers, payload, provider_name="OpenRouter")
        if not resp.ok:
            # If 400 bad request (some free models don't support response_format: json_object)
            if resp.status_code == 400 and "response_format" in resp.text:
                payload.pop("response_format", None)
                resp = robust_cloud_post(url, headers, payload, provider_name="OpenRouter")
        if not resp.ok:
            raise RuntimeError(f"OpenRouter call failed ({resp.status_code}): {resp.text}")
        return resp.json()["choices"][0]["message"]["content"]

    elif provider == "deepseek":
        url = "https://api.deepseek.com/chat/completions"
        model = model_name or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": full_prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }
        resp = robust_cloud_post(url, headers, payload, provider_name="DeepSeek")
        if not resp.ok:
            raise RuntimeError(f"DeepSeek call failed ({resp.status_code}): {resp.text}")
        return resp.json()["choices"][0]["message"]["content"]

    elif provider == "gemini":
        model = model_name or os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": full_prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2}
        }
        resp = robust_cloud_post(url, headers={}, payload=payload, provider_name="Gemini")
        if not resp.ok:
            raise RuntimeError(f"Gemini call failed ({resp.status_code}): {resp.text}")
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]

    elif provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        model = model_name or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": full_prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }
        resp = robust_cloud_post(url, headers, payload, provider_name="OpenAI")
        if not resp.ok:
            raise RuntimeError(f"OpenAI call failed ({resp.status_code}): {resp.text}")
        return resp.json()["choices"][0]["message"]["content"]

    elif provider == "claude":
        url = "https://api.anthropic.com/v1/messages"
        model = model_name or os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")
        headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        payload = {
            "model": model,
            "max_tokens": 1800,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": full_prompt}]
        }
        resp = robust_cloud_post(url, headers, payload, provider_name="Claude")
        if not resp.ok:
            raise RuntimeError(f"Claude call failed ({resp.status_code}): {resp.text}")
        content = resp.json().get("content", [])
        return content[0].get("text", "") if content else ""

    elif provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
        model = model_name or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        headers = {"Authorization": f"Bearer {api_key}"}
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": full_prompt}],
            "temperature": 0.2,
            "response_format": {"type": "json_object"}
        }
        resp = robust_cloud_post(url, headers, payload, provider_name="Groq")
        if not resp.ok:
            raise RuntimeError(f"Groq call failed ({resp.status_code}): {resp.text}")
        return resp.json()["choices"][0]["message"]["content"]

    else:
        raise ValueError(f"Unsupported provider: {provider}")


def deduplicate_candidates(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate overlapping candidates across chunk boundaries."""
    if not candidates:
        return []

    # Sort by score descending
    candidates.sort(key=lambda c: c["score"], reverse=True)
    selected = []

    for cand in candidates:
        overlap = False
        for s in selected:
            inter_start = max(cand["start"], s["start"])
            inter_end = min(cand["end"], s["end"])
            if inter_end > inter_start:
                overlap_dur = inter_end - inter_start
                cand_dur = cand["end"] - cand["start"]
                if (overlap_dur / cand_dur) > 0.5:
                    overlap = True
                    break
        if not overlap:
            selected.append(cand)

    return selected


def generate_fallback_candidates(
    segments: List[Dict[str, Any]],
    target_duration: str = "60s"
) -> List[Dict[str, Any]]:
    """Generates intelligent fallback candidates if LLM found 0 moments, ensuring the pipeline never fails."""
    if not segments:
        return []

    dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
    target_len = (dur_info["min"] + dur_info["max"]) / 2.0
    total_dur = segments[-1]["end"] - segments[0]["start"]

    # If the video is short (<= target_len * 1.5), use the whole spoken part
    if total_dur <= (target_len * 1.5):
        first_text = segments[0].get("text", "").strip()
        hook = first_text[:60] if len(first_text) > 5 else "Clip destacado del video"
        return [{
            "start": round(segments[0]["start"], 2),
            "end": round(segments[-1]["end"], 2),
            "score": 0.85,
            "hook": hook,
            "rationale": "Segmento completo de audio detectado",
            "description": f"{hook}. Mira el momento completo. #viral #shorts"
        }]

    # For longer videos, create natural speech slices of target_len
    fallbacks = []
    curr_start = segments[0]["start"]
    curr_text = []

    for s in segments:
        curr_text.append(s.get("text", ""))
        dur = s["end"] - curr_start
        if dur >= target_len:
            hook = curr_text[0].strip()[:60] if curr_text else "Momento destacado"
            fallbacks.append({
                "start": round(curr_start, 2),
                "end": round(s["end"], 2),
                "score": 0.75,
                "hook": hook or "Momento destacado del video",
                "rationale": "Segmento continuo con alta densidad de voz",
                "description": f"{hook}. Momento destacado del video. #viral #shorts"
            })
            curr_start = s["end"]
            curr_text = []
            if len(fallbacks) >= 5:
                break

    return fallbacks


def calculate_chunk_salience(chunk: List[Dict[str, Any]], peaks: List[Dict[str, Any]]) -> float:
    """Calculates information density to avoid wasting GPU cycles on silent / AFK sections."""
    if not chunk:
        return 0.0
    text = " ".join([s.get("text", "") for s in chunk]).lower()
    words = text.split()
    word_count = len(words)
    dur = max(1.0, chunk[-1]["end"] - chunk[0]["start"])
    wpm = (word_count / dur) * 60.0

    hype_tokens = ["!", "?", "no way", "dios", "mira", "vamos", "clutch", "headshot", "kill", "jaja", "lol", "increible", "wow", "partida", "cuidado"]
    hype_count = sum(text.count(t) for t in hype_tokens)
    return wpm + (hype_count * 10.0) + (len(peaks) * 25.0)


def detect_candidates_pipeline(
    transcript: Dict[str, Any],
    provider: str = "local",
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    content_type: str = "gaming",
    target_duration: str = "60s",
    enable_thinking: bool = False,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
    audio_path: Optional[str] = None,
    custom_prompt: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Main detection pipeline using Chunking ("Divide y Vencerás").
    Processes streams in adaptive windows (10 min or 15 min for long clips) to avoid context explosion on 12GB VRAM.
    Integrates audio action peak detection for silent gameplay clutches / gunfights.
    Automatically unloads Ollama models upon completion or cancellation to immediately free VRAM.
    """
    segments = transcript.get("segments", [])
    if not segments:
        return []

    # Detect high-energy audio peaks (gunshots, explosions, action) if audio file is available
    action_peaks = []
    if audio_path and os.path.exists(audio_path):
        try:
            from .media import detect_audio_action_peaks
            action_peaks = detect_audio_action_peaks(audio_path)
            if action_peaks:
                print(f"Detectadas {len(action_peaks)} zonas de acción acústica intensa en el audio del juego.")
        except Exception as e:
            print(f"Nota en detección de picos de audio: {e}")

    # Partition into chunks with overlap (adapt window to 15 min for 3m/5m clips so long moments fit naturally)
    chunk_dur = 900.0 if target_duration in ["3m", "5m"] else 600.0
    overlap = 120.0 if target_duration in ["3m", "5m"] else 45.0
    chunks = partition_segments(segments, chunk_duration_sec=chunk_dur, overlap_sec=overlap)
    total_chunks = len(chunks)
    all_drafts = []

    print(f"Dividing stream into {total_chunks} chunk(s) of {int(chunk_dur//60)} min for {content_type} detection (objetivo: {target_duration} | Thinking: {enable_thinking})...")

    try:
        for idx, chunk in enumerate(chunks, start=1):
            if is_cancelled and is_cancelled():
                print("🛑 Proceso de detección cancelado por el usuario.")
                break

            chunk_start_fmt = f"{int(chunk[0]['start'] // 60):02d}:{int(chunk[0]['start'] % 60):02d}"
            chunk_end_fmt = f"{int(chunk[-1]['end'] // 60):02d}:{int(chunk[-1]['end'] % 60):02d}"
            thinking_indicator = ""
            if provider in ["local", "ollama"] and enable_thinking and detect_model_thinking_capability(model_name or "qwen2.5:7b"):
                thinking_indicator = " (Razonamiento CoT activo)"

            status_msg = f"Analizando bloque {idx}/{total_chunks} ({chunk_start_fmt} - {chunk_end_fmt}){thinking_indicator}..."
            print(status_msg)

            if on_progress:
                on_progress(status_msg, idx, total_chunks)

            # Check if this chunk contains high-action audio peaks
            chunk_start = chunk[0]["start"]
            chunk_end = chunk[-1]["end"]
            chunk_peaks = [p for p in action_peaks if p["end"] > chunk_start and p["start"] < chunk_end]

            # NASA / Google tier Salience filter: avoid stalling GPU on barren silence/loading screens
            word_count = sum(len(s.get("text", "").split()) for s in chunk)
            if word_count < 12 and not chunk_peaks:
                print(f"⏩ Omitiendo bloque {idx}/{total_chunks} ({chunk_start_fmt} - {chunk_end_fmt}): Tramo sin actividad vocal ni acción acústica.")
                continue

            peak_cues = ""
            if chunk_peaks:
                cue_lines = [
                    f"- [{int(p['start']//60):02d}:{int(p['start']%60):02d} a {int(p['end']//60):02d}:{int(p['end']%60):02d}] 💥 ACCIÓN INTENSA / DISPAROS DEL JUEGO (Streamer concentrado jugando)"
                    for p in chunk_peaks[:5]
                ]
                peak_cues = "\n\nZonas de alta acción/disparos detectadas acústicamente:\n" + "\n".join(cue_lines)

            dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
            instruction_text = (
                f"\n\nINSTRUCCIÓN:\n"
                f"Analiza la transcripción anterior y extrae exclusivamente entre 1 y 5 momentos/clips virales ({dur_info['instruction']}).\n"
                f"Debes responder en formato JSON estrictamente estructurado así:\n"
                f'{{"candidates": [{{"start": 0.0, "end": 0.0, "score": 0.95, "hook": "Título Gancho", "rationale": "Por qué es viral", "description": "Texto llamativo para redes con hashtags"}}]}}'
            )
            prompt_text = f"Transcripción del segmento [{chunk_start_fmt} a {chunk_end_fmt}]:\n{compact_segments(chunk)}{peak_cues}{instruction_text}"

            try:
                if provider in ["local", "ollama"]:
                    model = model_name or "qwen2.5:7b"
                    resp_text = call_ollama(
                        prompt_text,
                        model_name=model,
                        content_type=content_type,
                        target_duration=target_duration,
                        enable_thinking=enable_thinking,
                        custom_prompt=custom_prompt
                    )
                elif provider == "lmstudio":
                    resp_text = call_lmstudio(
                        prompt_text,
                        model_name=model_name,
                        content_type=content_type,
                        target_duration=target_duration,
                        custom_prompt=custom_prompt,
                        enable_thinking=enable_thinking
                    )
                else:
                    resp_text = call_cloud_llm(
                        provider,
                        api_key or "",
                        prompt_text,
                        model_name=model_name,
                        content_type=content_type,
                        target_duration=target_duration,
                        custom_prompt=custom_prompt
                    )

                print(f"LLM Response:\n{resp_text}")
                chunk_candidates = parse_candidate_json(
                    resp_text,
                    min_duration=5.0,
                    segments=chunk,
                    target_duration=target_duration
                )
                print(f"Parsed candidates count: {len(chunk_candidates)}")
                all_drafts.extend(chunk_candidates)

                # Prevent rate limit saturation on Cloud providers
                if provider not in ["local", "ollama"] and idx < total_chunks:
                    time.sleep(2.5)
            except Exception as e:
                print(f"Error analyzing chunk {idx}: {e}")

            if is_cancelled and is_cancelled():
                print("🛑 Proceso de detección cancelado tras procesar bloque.")
                break

        # Check for silent gameplay clutches (action peaks with minimal/no speech)
        # Only inject if target_duration is short ("30s" or "60s"); for 2m/3m/5m clips, 8s audio peaks should NEVER be injected!
        if target_duration in ["30s", "60s"]:
            for p in action_peaks:
                overlapping_speech = [s for s in segments if s["end"] > p["start"] and s["start"] < p["end"]]
                if len(overlapping_speech) <= 1:
                    peak_center = (p["start"] + p["end"]) / 2.0
                    clip_dur = 30.0 if target_duration == "30s" else 50.0
                    p_start = max(0.0, peak_center - (clip_dur / 2.0))
                    p_end = p_start + clip_dur
                    all_drafts.append({
                        "start": round(p_start, 2),
                        "end": round(p_end, 2),
                        "score": 0.85,
                        "hook": "🎮 Jugada Épica en Máxima Concentración",
                        "rationale": "Momento de acción intensa y tiroteo del juego con el streamer totalmente enfocado en jugar sin hablar.",
                        "description": "¡Mira la concentración total en esta jugada de acción intensa! 🎮🔥 #gaming #highlight #gameplay"
                    })

        # Deduplicate and sort globally
        unique_candidates = deduplicate_candidates(all_drafts)
        unique_candidates.sort(key=lambda c: c["score"], reverse=True)

        # Intelligent fallback if LLM found 0 moments and was not cancelled
        if not unique_candidates and not (is_cancelled and is_cancelled()):
            print("Aviso: LLM no devolvió candidatos directos. Generando candidatos automáticos de respaldo...")
            unique_candidates = generate_fallback_candidates(segments, target_duration=target_duration)

        return unique_candidates[:100]

    finally:
        # Free VRAM immediately in Ollama or LM Studio so other models can be used
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)
        elif provider == "lmstudio":
            unload_all_lmstudio_models()


def plan_summary_narrative(
    candidates: List[Dict[str, Any]],
    target_duration_minutes: float,
    provider: str = "local",
    model_name: Optional[str] = None,
    api_key: Optional[str] = None,
    summary_vibe: str = "balanced"
) -> Dict[str, Any]:
    """
    Asks the LLM (Ollama or Cloud) to act as a video editor and select & order the moments
    to craft an engaging narrative summary totaling approximately target_duration_minutes.
    Supports themes: 'balanced', 'tryhard', 'funny'.
    Generates thumbnail ideas.
    Returns:
      {
        "narrative_title": str,
        "storyline": str,
        "thumbnail_ideas": list of str,
        "ordered_clip_ids": list of str
      }
    """
    if not candidates:
        return {"narrative_title": "Resumen del Stream", "storyline": "Sin clips disponibles.", "thumbnail_ideas": [], "ordered_clip_ids": []}

    target_seconds = target_duration_minutes * 60.0
    min_seconds = max(30.0, target_seconds - 60.0)
    max_seconds = target_seconds + 60.0

    # Build lightweight clip summary for LLM
    clips_info = []
    for c in candidates:
        dur = round(float(c.get("endSec", 0)) - float(c.get("startSec", 0)), 1)
        clips_info.append({
            "id": c.get("id"),
            "hook": c.get("hook", "Momento destacado"),
            "description": c.get("description", ""),
            "duration_sec": dur,
            "score": c.get("score", 3.0)
        })

    avg_dur = sum(c["duration_sec"] for c in clips_info) / max(1, len(clips_info))
    approx_count = max(2, min(len(clips_info), int(round(target_seconds / max(10.0, avg_dur)))))
    min_count = max(2, approx_count - 2)
    max_count = min(len(clips_info), approx_count + 2)

    vibe_instructions = {
        "tryhard": (
            "ENFOQUE TEMÁTICO: 'TRYHARD / JUGADAS ÉPICAS'\n"
            "- Prioriza y selecciona preferentemente momentos de alta tensión, kills, clutches, jugadas maestras y victorias.\n"
            "- Descarta momentos de risas lentas o charlas secundarias."
        ),
        "funny": (
            "ENFOQUE TEMÁTICO: 'RISAS, FAILS Y HUMOR'\n"
            "- Prioriza y selecciona preferentemente momentos cómicos, risas, bromas, anécdotas, bugs graciosos, fails y trolleo.\n"
            "- Descarta momentos puramente tácticos o serios."
        ),
        "balanced": (
            "ENFOQUE TEMÁTICO: 'EQUILIBRADO / HISTORIA COMPLETA'\n"
            "- Selecciona una mezcla armónica que cuente la historia del directo: intro teaser impactante, momentos entretenidos/risas, partidas clave y desenlace."
        )
    }
    vibe_rule = vibe_instructions.get(summary_vibe, vibe_instructions["balanced"])

    prompt = f"""Actúa como un editor profesional de YouTube y TikTok para streamers de gaming y entretenimiento.
Tienes una lista de {len(clips_info)} momentos/clips extraídos de un stream, cada uno con su ID, título/hook, descripción, duración en segundos y score de viralidad:

{json.dumps(clips_info, ensure_ascii=False, indent=2)}

Tu objetivo es armar la compilación perfecta para un video resumen de aproximadamente {target_duration_minutes:.0f} minutos (duración total deseada: entre {min_seconds:.0f}s y {max_seconds:.0f}s).

{vibe_rule}

REGLAS EDITORIALES OBLIGATORIAS:
1. LÍMITE DE DURACIÓN ESTRICTO: El video NO debe sobrepasar aproximadamente {target_duration_minutes:.0f} minutos. Dado que los momentos duran en promedio {int(avg_dur)}s, debes seleccionar ÚNICAMENTE entre {min_count} y {max_count} clips (los mejores de la lista). ¡NO selecciones todos los clips!
2. El PRIMER clip ("ordered_clip_ids"[0]) DEBE ser el mejor gancho/teaser de alto impacto para retener al espectador en los primeros 10 segundos.
3. Organiza los clips elegidos para crear una progresión narrativa emocionante.
4. La suma acumulada de las duraciones de los IDs elegidos DEBE estar lo más cerca posible de {int(target_seconds)} segundos.
5. Genera 3 ideas cortas y en mayúsculas de texto para la miniatura (thumbnail) de YouTube (ej. ["1v4 IMPOSIBLE", "NO ME LO CREO", "CLUTCH FINAL"]).
6. No repitas ningún ID. Usa únicamente IDs existentes en la lista proporcionada.

Responde EXCLUSIVAMENTE con este objeto JSON:
{{
  "narrative_title": "Título sugerido para YouTube (atractivo, sin emojis en el archivo)",
  "storyline": "Explicación breve de la progresión narrativa elegida",
  "thumbnail_ideas": ["TEXTO 1", "TEXTO 2", "TEXTO 3"],
  "ordered_clip_ids": ["id_del_clip_1", "id_del_clip_2", ...]
}}"""

    raw_response = ""
    try:
        if provider in ["local", "ollama"]:
            url = "http://127.0.0.1:11434/api/chat"
            active_model = model_name or "qwen2.5:7b"
            has_thinking = detect_model_thinking_capability(active_model)
            summary_sys = "Eres un editor experto de videos para streamers de YouTube. Responde siempre en formato JSON."
            if has_thinking:
                summary_sys += " Utiliza tu proceso de pensamiento para calcular la suma de duraciones y respetar estrictamente los minutos pedidos, luego entrega el JSON."

            payload: Dict[str, Any] = {
                "model": active_model,
                "messages": [
                    {"role": "system", "content": summary_sys},
                    {"role": "user", "content": prompt}
                ],
                "stream": False,
                "options": {"temperature": 0.3}
            }
            if not has_thinking:
                payload["format"] = "json"

            resp = requests.post(url, json=payload, timeout=60)
            if resp.ok:
                msg = resp.json().get("message", {})
                content = msg.get("content", "")
                thinking = msg.get("thinking", "")
                if "<think>" in content:
                    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                if not content and thinking:
                    m = re.search(r"(\{.*\"narrative_title\".*\})", thinking, re.DOTALL)
                    if m:
                        content = m.group(1)
                raw_response = content
            else:
                print(f"Ollama narrative planning failed: {resp.text}")

        elif provider == "lmstudio":
            url = (os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
            active_model = model_name or "local-model"
            summary_sys = "Eres un editor experto de videos para streamers de YouTube. Responde siempre en formato JSON."
            payload = {
                "model": active_model,
                "messages": [
                    {"role": "system", "content": summary_sys + "\n\n[MODO DIRECTO]: PROHIBIDO razonar o usar <think>. Responde ÚNICAMENTE con el objeto JSON solicitado."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.3,
                "enable_thinking": False,
                "chat_template_config": {"enable_thinking": False}
            }
            try:
                resp = requests.post(url, json=payload, timeout=90)
                if resp.ok:
                    choices = resp.json().get("choices", [])
                    if choices:
                        content = choices[0]["message"]["content"]
                        if "<think>" in content:
                            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                            content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL).strip()
                        raw_response = content
                else:
                    print(f"LM Studio narrative planning failed: {resp.text}")
            except Exception as e:
                print(f"Fallo de conexión con LM Studio: {e}")

        elif provider in ["claude", "deepseek", "gemini", "openai", "openrouter", "groq"]:
            # Direct cloud call
            if provider == "gemini":
                model = model_name or os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3}
                }
                resp = robust_cloud_post(url, headers={}, payload=payload, provider_name="Gemini")
                if resp.ok:
                    raw_response = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            elif provider == "openrouter":
                url = "https://openrouter.ai/api/v1/chat/completions"
                model = model_name or os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"}
                }
                resp = robust_cloud_post(url, headers, payload, provider_name="OpenRouter")
                if resp.ok:
                    raw_response = resp.json()["choices"][0]["message"]["content"]
            elif provider in ["deepseek", "groq", "openai"]:
                endpoint = (
                    "https://api.deepseek.com/chat/completions" if provider == "deepseek"
                    else "https://api.groq.com/openai/v1/chat/completions" if provider == "groq"
                    else "https://api.openai.com/v1/chat/completions"
                )
                model = model_name or ("deepseek-chat" if provider == "deepseek" else "llama-3.3-70b-versatile" if provider == "groq" else "gpt-4o-mini")
                headers = {"Authorization": f"Bearer {api_key}"}
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"}
                }
                resp = robust_cloud_post(endpoint, headers, payload, provider_name=provider)
                if resp.ok:
                    raw_response = resp.json()["choices"][0]["message"]["content"]
            elif provider == "claude":
                url = "https://api.anthropic.com/v1/messages"
                model = model_name or "claude-3-5-sonnet-latest"
                headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
                payload = {
                    "model": model,
                    "max_tokens": 1500,
                    "temperature": 0.3,
                    "messages": [{"role": "user", "content": prompt}]
                }
                resp = robust_cloud_post(url, headers, payload, provider_name="Claude")
                if resp.ok:
                    content = resp.json().get("content", [])
                    raw_response = content[0].get("text", "") if content else ""

        # Parse JSON response
        if raw_response:
            clean_json = raw_response.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()

            parsed = json.loads(clean_json)
            ordered_ids = parsed.get("ordered_clip_ids", [])
            valid_ids = {c["id"] for c in candidates}
            filtered_ids = [cid for cid in ordered_ids if cid in valid_ids]
            if filtered_ids:
                return {
                    "narrative_title": parsed.get("narrative_title", "Resumen de Stream").strip(),
                    "storyline": parsed.get("storyline", "Secuencia narrativa generada por IA").strip(),
                    "thumbnail_ideas": parsed.get("thumbnail_ideas", ["¡MOMENTOS ÉPICOS!", "NO TE LO PIERDAS", "FINAL DEL STREAM"]),
                    "ordered_clip_ids": filtered_ids
                }
    except Exception as e:
        print(f"Aviso: Error en secuenciamiento con IA ({e}). Usando orden voraz inteligente...")
    finally:
        # Crucial: Unload Ollama immediately so RAM/VRAM is 100% free for FFmpeg!
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)

    # Fallback greedy selection
    candidates_by_score = sorted(candidates, key=lambda c: c.get("score", 0), reverse=True)
    chosen = []
    current_dur = 0.0

    intro = candidates_by_score[0]
    chosen.append(intro["id"])
    current_dur += (float(intro["endSec"]) - float(intro["startSec"]))

    remaining = [c for c in candidates if c["id"] != intro["id"]]
    remaining.sort(key=lambda c: float(c["startSec"]))

    for c in remaining:
        dur = float(c["endSec"]) - float(c["startSec"])
        if (current_dur + dur) <= (target_seconds + 30.0):
            chosen.append(c["id"])
            current_dur += dur
        if current_dur >= target_seconds:
            break

    return {
        "narrative_title": "Resumen del Stream",
        "storyline": "Selección inteligente basada en gancho inicial y orden cronológico.",
        "thumbnail_ideas": ["MOMENTOS ÉPICOS", "JUGADAS DEL STREAM", "RESUMEN FINAL"],
        "ordered_clip_ids": chosen
    }





def plan_autoedit_narrative(
    candidates: List[Dict[str, Any]],
    target_duration_minutes: float,
    format_mode: str = "youtube",
    include_teaser: bool = True,
    provider: str = "local",
    model_name: Optional[str] = None,
    api_key: Optional[str] = None,
    transcript_segments: Optional[List[Dict[str, Any]]] = None,
    trim_silences: bool = True,
    assembly_style: str = "balanced",
    excluded_moment_ids: Optional[List[str]] = None,
    max_source_duration: Optional[float] = None
) -> Dict[str, Any]:
    """
    Plans an intelligent rough-cut assembly for YouTube (16:9) or Shorts (9:16)
    orchestrated by a real LLM (Ollama or Cloud) acting as Director of Editing.
    Distributes duration budget with silence-trim compensation and dynamic clip filling
    so the final video strictly matches target_duration_minutes.
    Supports AI orchestration styles (balanced, action, humor, chronological, alternative, smart_shuffle).
    Gracefully falls back to heuristic sorting if LLM is unavailable.
    """
    if not candidates:
        return {"teaser_hook": None, "story_segments": []}

    import random
    cand_map = {c["id"]: c for c in candidates}
    pool = [dict(c) for c in candidates]
    excluded_set = set(excluded_moment_ids or [])

    target_seconds = float(target_duration_minutes) * 60.0
    budget_needed = target_seconds * (1.18 if trim_silences else 1.0)

    # 1. Pre-filter candidate pool to top 15 based on assembly style for fast, reliable LLM responses
    sorted_for_llm = list(candidates)
    if assembly_style == "alternative" and excluded_set:
        fresh = [c for c in sorted_for_llm if c["id"] not in excluded_set]
        reused = [c for c in sorted_for_llm if c["id"] in excluded_set]
        sorted_for_llm = fresh + reused
    elif assembly_style == "action":
        def action_score(c):
            t = f"{c.get('hook', '')} {c.get('rationale', '')} {c.get('text', '')}".lower()
            bonus = 0.40 if ("disparo" in t or "clutch" in t or "kill" in t or "combate" in t) else 0.0
            return float(c.get("score", 0)) + bonus
        sorted_for_llm.sort(key=action_score, reverse=True)
    elif assembly_style == "humor":
        def humor_score(c):
            t = f"{c.get('hook', '')} {c.get('rationale', '')} {c.get('text', '')}".lower()
            bonus = 0.40 if ("risa" in t or "gracioso" in t or "fail" in t or "bloop" in t) else 0.0
            return float(c.get("score", 0)) + bonus
        sorted_for_llm.sort(key=humor_score, reverse=True)
    elif assembly_style == "chronological":
        sorted_for_llm.sort(key=lambda c: float(c.get("startSec", c.get("start", 0))))
    else:
        sorted_for_llm.sort(key=lambda c: float(c.get("score", 0)), reverse=True)

    top_candidates = sorted_for_llm[:15]
    clips_summary = []
    for c in top_candidates:
        c_dur = float(c.get("endSec", c.get("end", 0))) - float(c.get("startSec", c.get("start", 0)))
        clips_summary.append({
            "id": c["id"],
            "hook": c.get("hook") or c.get("title") or "Sin título",
            "score": round(float(c.get("score", 5.0)), 1),
            "duration_sec": round(c_dur, 1),
            "transcript_sample": (c.get("text") or c.get("rationale") or "")[:150]
        })

    style_guide = {
        "balanced": "EQUILIBRIO ÉPICO: Estructura una narrativa con gancho inicial potente, desarrollo con tensión ascendente y clímax de alto impacto.",
        "smart_shuffle": "MEZCLA DINÁMICA: Crea una secuencia fresca y variada de momentos destacados manteniendo ritmo alto y evitando fórmulas predecibles.",
        "action": "CLUTCHES Y ACCIÓN: Prioriza jugadas de combate, bajas, disparos [DISPAROS], clutches y momentos de máxima adrenalina.",
        "humor": "RISAS Y COMEDIA: Prioriza momentos divertidos, risas, bromas, fails cómicos y reacciones exageradas del streamer.",
        "chronological": "FLUJO CRONOLÓGICO: Ordena los mejores momentos respetando el orden temporal del stream para contar la historia secuencialmente.",
        "alternative": "NUEVA VARIACIÓN: Descarta o evita momentos repetidos y enfócate en momentos secundarios o alternativos que también sean muy buenos."
    }.get(assembly_style, "Estructura narrativa atractiva y de alta retención.")

    format_guide = (
        "MODO SHORTS / TIKTOK (9:16): Ritmo ultra ágil y directo al grano, transiciones dinámicas."
        if format_mode == "shorts"
        else "MODO YOUTUBE (16:9): Ritmo por capítulos con espacio para entender el contexto, desarrollo y remate."
    )

    teaser_instruction = (
        "Elige un momento impactante para un gancho/teaser de 3-5 segundos que irá antes de comenzar el video (campo 'teaser_clip_id')."
        if include_teaser
        else "No incluyas teaser inicial ('teaser_clip_id': null)."
    )

    min_clips = max(2, int(round(target_seconds / 75.0)))
    max_clips = max(3, int(round(target_seconds / 40.0)))

    prompt = f"""Eres un Director de Montaje y Edición de Video profesional para creadores de contenido de YouTube y TikTok.
Tu tarea es orquestar la selección y secuencia ideal de momentos para armar un video de aproximadamente {target_duration_minutes:.0f} minutos ({int(target_seconds)} segundos).

ESTILO DE MONTAJE REQUERIDO:
{style_guide}

FORMATO:
{format_guide}

REGLAS DE MONTAJE:
1. {teaser_instruction}
2. Selecciona entre {min_clips} y {max_clips} momentos que juntos conformen el video perfecto.
3. Ordena los momentos elegidos en 'story_segments' con una secuencia que mantenga la atención del espectador.
4. Para cada momento seleccionado, asigna un 'chapter_title' corto y atractivo (sin emojis), y un 'target_seconds' sugerido (entre 20s y 80s).
5. Usa EXCLUSIVAMENTE los IDs existentes en la lista proporcionada. No inventes IDs.

MOMENTOS CANDIDATOS DISPONIBLES ({len(clips_summary)} clips):
{json.dumps(clips_summary, ensure_ascii=False, indent=2)}

Responde ÚNICAMENTE con este JSON válido:
{{
  "teaser_clip_id": "id_del_clip_para_el_teaser_o_null",
  "editorial_reasoning": "Breve explicación de la estrategia narrativa",
  "story_segments": [
    {{
      "clip_id": "id_del_clip",
      "chapter_title": "Título del capítulo",
      "target_seconds": 45.0
    }}
  ]
}}"""

    llm_planned_segments = None
    llm_teaser_id = None

    try:
        raw_response = ""
        if provider in ["local", "ollama"]:
            url = "http://127.0.0.1:11434/api/chat"
            active_model = model_name or "qwen2.5:7b"
            has_thinking = detect_model_thinking_capability(active_model)
            sys_msg = "Eres un director de montaje audiovisual experto. Devuelve únicamente JSON válido."
            if has_thinking:
                sys_msg += " Piensa brevemente en el orden narrativo y luego entrega el bloque JSON final."

            payload: Dict[str, Any] = {
                "model": active_model,
                "messages": [
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": prompt}
                ],
                "stream": False,
                "options": {"temperature": 0.35}
            }
            if not has_thinking:
                payload["format"] = "json"

            resp = requests.post(url, json=payload, timeout=120)
            if resp.ok:
                msg = resp.json().get("message", {})
                content = msg.get("content", "")
                thinking = msg.get("thinking", "")
                if "<think>" in content:
                    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                if not content and thinking:
                    m = re.search(r"(\{.*\"story_segments\".*\})", thinking, re.DOTALL)
                    if m:
                        content = m.group(1)
                raw_response = content
            else:
                print(f"[AutoEdit IA] Ollama no respondió al plan narrativo: {resp.text}")

        elif provider == "lmstudio":
            url = (os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
            active_model = model_name or "local-model"
            sys_msg = "Eres un director de montaje audiovisual experto. Devuelve únicamente JSON válido."
            payload = {
                "model": active_model,
                "messages": [
                    {"role": "system", "content": sys_msg + "\n\nResponde ÚNICAMENTE con el objeto JSON solicitado."},
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.35
            }
            try:
                resp = requests.post(url, json=payload, timeout=120)
                if resp.ok:
                    choices = resp.json().get("choices", [])
                    if choices:
                        content = choices[0]["message"]["content"]
                        if "<think>" in content:
                            content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                        raw_response = content
                else:
                    print(f"[AutoEdit IA] LM Studio error ({resp.status_code}): {resp.text}")
            except Exception as e:
                print(f"[AutoEdit IA] Fallo de conexión con LM Studio: {e}")

        elif provider in ["claude", "deepseek", "gemini", "openai", "openrouter", "groq"]:
            if provider == "gemini":
                model = model_name or os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.3}
                }
                resp = robust_cloud_post(url, headers={}, payload=payload, provider_name="Gemini")
                if resp.ok:
                    raw_response = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            elif provider == "openrouter":
                url = "https://openrouter.ai/api/v1/chat/completions"
                model = model_name or os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"}
                }
                resp = robust_cloud_post(url, headers, payload, provider_name="OpenRouter")
                if resp.ok:
                    raw_response = resp.json()["choices"][0]["message"]["content"]
            elif provider in ["deepseek", "groq", "openai"]:
                endpoint = (
                    "https://api.deepseek.com/chat/completions" if provider == "deepseek"
                    else "https://api.groq.com/openai/v1/chat/completions" if provider == "groq"
                    else "https://api.openai.com/v1/chat/completions"
                )
                model = model_name or ("deepseek-chat" if provider == "deepseek" else "llama-3.3-70b-versatile" if provider == "groq" else "gpt-4o-mini")
                headers = {"Authorization": f"Bearer {api_key}"}
                payload = {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.3,
                    "response_format": {"type": "json_object"}
                }
                resp = robust_cloud_post(endpoint, headers, payload, provider_name=provider)
                if resp.ok:
                    raw_response = resp.json()["choices"][0]["message"]["content"]
            elif provider == "claude":
                url = "https://api.anthropic.com/v1/messages"
                model = model_name or "claude-3-5-sonnet-latest"
                headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
                payload = {
                    "model": model,
                    "max_tokens": 1500,
                    "temperature": 0.3,
                    "messages": [{"role": "user", "content": prompt}]
                }
                resp = robust_cloud_post(url, headers, payload, provider_name="Claude")
                if resp.ok:
                    content = resp.json().get("content", [])
                    raw_response = content[0].get("text", "") if content else ""

        if raw_response:
            clean_json = raw_response.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()

            parsed = json.loads(clean_json)
            valid_segments = []
            if "story_segments" in parsed and isinstance(parsed["story_segments"], list):
                for item in parsed["story_segments"]:
                    cid = item.get("clip_id")
                    if cid in cand_map and cid not in [s["clip_id"] for s in valid_segments]:
                        valid_segments.append({
                            "clip_id": cid,
                            "candidate": cand_map[cid],
                            "chapter_title": item.get("chapter_title") or cand_map[cid].get("hook"),
                            "target_seconds": float(item.get("target_seconds", 50.0))
                        })
            elif "ordered_clip_ids" in parsed and isinstance(parsed["ordered_clip_ids"], list):
                for cid in parsed["ordered_clip_ids"]:
                    if cid in cand_map and cid not in [s["clip_id"] for s in valid_segments]:
                        valid_segments.append({
                            "clip_id": cid,
                            "candidate": cand_map[cid],
                            "chapter_title": cand_map[cid].get("hook"),
                            "target_seconds": 50.0
                        })

            if valid_segments:
                llm_planned_segments = valid_segments
                llm_teaser_id = parsed.get("teaser_clip_id")
                reasoning = parsed.get("editorial_reasoning", "Estructura narrativa orquestada con IA")
                print(f"[AutoEdit IA] Guion generado con IA ({len(valid_segments)} momentos). Estrategia: {reasoning}")

    except Exception as e:
        print(f"[AutoEdit IA] Aviso: Fallback heurístico activado ({e})")
    finally:
        # Crucial: Unload Ollama immediately so RAM/VRAM is 100% free for FFmpeg!
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)

    # 2. Teaser Hook (if enabled)
    teaser_hook = None
    teaser_cand = None
    if include_teaser and target_seconds >= 45.0:
        if llm_teaser_id and llm_teaser_id in cand_map:
            teaser_cand = cand_map[llm_teaser_id]
        elif pool:
            teaser_cand = pool[0]

    if teaser_cand:
        teaser_dur = 4.0 if format_mode == "shorts" else 5.0
        t_sub_start, _ = locate_moment_active_window(teaser_cand, teaser_dur, transcript_segments, max_source_duration)
        clean_hook = strip_emojis_from_text(str(teaser_cand.get("hook", "Gancho Inicial")))
        teaser_hook = {
            "start": t_sub_start,
            "end": round(t_sub_start + teaser_dur, 2),
            "hook": f"Teaser: {clean_hook}"
        }
        budget_needed = max(15.0, budget_needed - teaser_dur)

    story_segments = []
    budget_left = budget_needed
    seen_ids = set()
    if teaser_cand:
        seen_ids.add(teaser_cand["id"])

    # 3. Assemble story segments from LLM or Heuristics
    if llm_planned_segments:
        total_planned = len(llm_planned_segments)
        for idx, item in enumerate(llm_planned_segments):
            c = item["candidate"]
            clips_remaining = total_planned - idx
            clip_dur = item.get("target_seconds", budget_left / max(1, clips_remaining))
            max_single = 90.0 if format_mode == "shorts" else 150.0
            clip_dur = min(max_single, max(15.0, clip_dur))

            s_start, s_end = locate_moment_active_window(c, clip_dur, transcript_segments, max_source_duration)
            actual_dur = max(1.0, s_end - s_start)
            clean_hook = strip_emojis_from_text(str(item.get("chapter_title") or c.get("hook", f"Momento {idx + 1}")))

            story_segments.append({
                "start": s_start,
                "end": s_end,
                "hook": clean_hook
            })
            seen_ids.add(c["id"])
            budget_left -= actual_dur

    else:
        # Fallback heuristic pool ranking
        if assembly_style == "alternative" and excluded_set:
            fresh = [c for c in pool if c["id"] not in excluded_set]
            reused = [c for c in pool if c["id"] in excluded_set]
            pool = fresh + reused
        elif assembly_style == "action":
            def action_score(c):
                t = f"{c.get('hook', '')} {c.get('rationale', '')}".lower()
                bonus = 0.0
                if "disparo" in t or "clutch" in t or "kill" in t or "combate" in t:
                    bonus += 0.40
                if "grito" in t or "euforia" in t:
                    bonus += 0.20
                return float(c.get("score", 0)) + bonus
            pool.sort(key=action_score, reverse=True)
        elif assembly_style == "humor":
            def humor_score(c):
                t = f"{c.get('hook', '')} {c.get('rationale', '')}".lower()
                bonus = 0.0
                if "risa" in t or "gracioso" in t or "fail" in t or "bloop" in t or "grito" in t or "euforia" in t:
                    bonus += 0.40
                return float(c.get("score", 0)) + bonus
            pool.sort(key=humor_score, reverse=True)
        elif assembly_style == "chronological":
            pool.sort(key=lambda c: float(c.get("startSec", c.get("start", 0))))
        elif assembly_style == "smart_shuffle":
            top = pool[0] if pool else None
            rest = pool[1:] if len(pool) > 1 else []
            random.shuffle(rest)
            pool = ([top] if top else []) + rest
        else:
            pool.sort(key=lambda c: float(c.get("score", 0)), reverse=True)

        clip_target_len = 45.0 if format_mode == "shorts" else 65.0
        desired_clip_count = max(2, int(round(budget_needed / clip_target_len)))
        chosen_candidates = []
        for c in pool:
            if c["id"] not in seen_ids:
                chosen_candidates.append(c)
                seen_ids.add(c["id"])
            if len(chosen_candidates) >= desired_clip_count:
                break
        if not chosen_candidates and pool:
            chosen_candidates = [pool[0]]

        for idx, c in enumerate(chosen_candidates):
            clips_remaining = len(chosen_candidates) - idx
            this_clip_target = budget_left / max(1, clips_remaining)
            max_single = 90.0 if format_mode == "shorts" else 150.0
            this_clip_target = min(max_single, max(15.0, this_clip_target))
            s_start, s_end = locate_moment_active_window(c, this_clip_target, transcript_segments, max_source_duration)
            actual_dur = max(1.0, s_end - s_start)
            clean_hook = strip_emojis_from_text(str(c.get("hook", f"Momento {idx + 1}")))
            story_segments.append({
                "start": s_start,
                "end": s_end,
                "hook": clean_hook
            })
            budget_left -= actual_dur

    # 4. Dynamic fill: IF budget_left remains > 15s, keep pulling more moments from pool!
    for c in pool:
        if budget_left < 15.0:
            break
        if c["id"] in seen_ids:
            continue
        this_clip_target = min(65.0, budget_left)
        s_start, s_end = locate_moment_active_window(c, this_clip_target, transcript_segments, max_source_duration)
        actual_dur = max(1.0, s_end - s_start)
        clean_hook = strip_emojis_from_text(str(c.get("hook", f"Momento {len(story_segments) + 1}")))
        story_segments.append({
            "start": s_start,
            "end": s_end,
            "hook": clean_hook
        })
        seen_ids.add(c["id"])
        budget_left -= actual_dur

    return {
        "teaser_hook": teaser_hook,
        "story_segments": story_segments
    }


def refine_transcript_with_llm(
    segments: List[Dict[str, Any]],
    model_name: str = "qwen2.5:7b",
    provider: str = "local",
    api_key: Optional[str] = None,
    chunk_size: int = 65,
    enable_thinking: bool = False,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None
) -> List[Dict[str, Any]]:
    """
    Refines transcription spelling, grammar, punctuation, and gaming slang using an LLM (Ollama or Cloud).
    Preserves exact timestamps (start, end) for every segment without altering speech synchronization.
    Runs in direct ultra-fast mode (think=False by default) to prevent slow generation or internal reasoning monologues.
    """
    if not segments:
        return []

    refined_segments = [dict(s) for s in segments]
    total_segments = len(refined_segments)
    num_chunks = (total_segments + chunk_size - 1) // chunk_size

    has_thinking = enable_thinking and (detect_model_thinking_capability(model_name) if provider in ["local", "ollama"] else False)
    mode_label = "Razonamiento CoT activo" if has_thinking else "Modo directo ultrarrápido sin thinking"
    print(f"Perfeccionando transcripción con IA ({provider}:{model_name} | {mode_label}). Total bloques: {num_chunks}...")

    try:
        for chunk_idx in range(num_chunks):
            if is_cancelled and is_cancelled():
                print("🛑 Perfeccionamiento de transcripción cancelado por el usuario.")
                break

            start_idx = chunk_idx * chunk_size
            end_idx = min(start_idx + chunk_size, total_segments)
            batch = refined_segments[start_idx:end_idx]

            msg = f"Puliendo ortografía con IA: bloque {chunk_idx + 1}/{num_chunks}..."
            if on_progress:
                on_progress(msg, chunk_idx + 1, num_chunks)
            print(msg)

            lines = []
            for i, seg in enumerate(batch, start=1):
                clean_t = seg.get("text", "").strip()
                lines.append(f"[{i}] {clean_t}")
            batch_text = "\n".join(lines)

            system_prompt = (
                "Eres un corrector ortográfico ultrarrápido y preciso para transcripciones de streams y videojuegos en Español.\n"
                "Corrige únicamente errores fonéticos del reconocimiento de voz (ASR), tildes y términos de gaming (ej. 'ruxear' -> 'rushear', 'cluch' -> 'clutch', 'heshon' -> 'headshot', 'lú' -> 'loot', 'dropeame una arma' -> 'dropeame un arma').\n"
                "REGLAS ESTRICTAS:\n"
                "1. Responde DIRECTAMENTE con las líneas corregidas en formato: [ID] Texto corregido.\n"
                "2. PROHIBIDO pensar en voz alta, PROHIBIDO incluir explicaciones, notas, dudas, flechas (->) o comentarios en inglés.\n"
                "3. Conserva exactamente el mismo número de líneas y sus identificadores numéricos."
            )

            user_prompt = f"Corrige las siguientes {len(batch)} líneas de transcripción manteniendo el formato [ID] Texto:\n\n{batch_text}"

            raw_resp = ""
            if provider in ["local", "ollama"]:
                url = "http://127.0.0.1:11434/api/chat"
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "stream": False,
                    "think": bool(has_thinking),
                    "options": {"temperature": 0.1, "num_predict": 2048}
                }
                resp = requests.post(url, json=payload, timeout=120)
                if resp.ok:
                    data = resp.json()
                    msg_obj = data.get("message", {})
                    content = msg_obj.get("content", "")
                    thinking = msg_obj.get("thinking", "")
                    if "<think>" in content:
                        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                    if "<think>" in content:
                        content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL).strip()
                    raw_resp = content or thinking
            elif provider == "lmstudio":
                url = (os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
                payload = {
                    "model": model_name or "local-model",
                    "messages": [
                        {"role": "system", "content": system_prompt + ("\n\n[MODO DIRECTO]: PROHIBIDO usar <think> o razonar." if not has_thinking else "")},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.1,
                    "enable_thinking": bool(has_thinking),
                    "chat_template_config": {"enable_thinking": bool(has_thinking)}
                }
                try:
                    resp = requests.post(url, json=payload, timeout=120)
                    if resp.ok:
                        data = resp.json()
                        choices = data.get("choices", [])
                        if choices:
                            content = choices[0]["message"]["content"]
                            if "<think>" in content:
                                content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                                content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL).strip()
                            raw_resp = content
                    else:
                        print(f"LM Studio refine error ({resp.status_code}): {resp.text}")
                except Exception as e:
                    print(f"Fallo de conexión con LM Studio en refinamiento: {e}")
            else:
                raw_resp = call_cloud_llm(
                    provider=provider,
                    api_key=api_key or "",
                    prompt=user_prompt,
                    model_name=model_name,
                    content_type="general",
                    target_duration="60s"
                )

            # Parse lines [i] text
            corrected_dict = {}
            for line in raw_resp.splitlines():
                line_str = line.strip()
                m = re.match(r"^[\*\-\s]*\[?(\d+)\]?[\s:\-–—\.]+(.*)$", line_str)
                if m:
                    line_id = int(m.group(1))
                    text_corr = m.group(2).strip().strip("`\"'")
                    # If model outputs: "original" -> "corregido" or original => corregido
                    if "->" in text_corr:
                        text_corr = text_corr.split("->")[-1].strip().strip('`"\'')
                    elif "=>" in text_corr:
                        text_corr = text_corr.split("=>")[-1].strip().strip('`"\'')
                    # Strip trailing parenthetical monologues / thoughts like (Wait, ... or (Maybe ...
                    text_corr = re.sub(r"\s*\((?:wait|maybe|actually|let's|note|nota|context).*?\)\s*$", "", text_corr, flags=re.IGNORECASE).strip()
                    text_corr = re.sub(r"\s*\((?:wait|maybe|actually|let's|note|nota|context).*$", "", text_corr, flags=re.IGNORECASE).strip()
                    if len(text_corr) > 10 and "(" in text_corr and text_corr.endswith(")"):
                        text_corr = re.sub(r"\s*\([^)]*\)$", "", text_corr).strip()
                    if text_corr:
                        corrected_dict[line_id] = text_corr

            # Apply corrections to the batch
            for i, seg in enumerate(batch, start=1):
                if i in corrected_dict:
                    new_text = corrected_dict[i]
                    if len(new_text) >= 1:
                        seg["text"] = new_text

    except Exception as e:
        print(f"Nota en perfeccionamiento de transcripción con IA: {e}")
    finally:
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)

    return refined_segments


def generate_social_copy_with_llm(
    transcript_text: str,
    model_name: str = "qwen2.5:7b",
    provider: str = "local",
    api_key: Optional[str] = None,
    enable_thinking: bool = False,
    extra_context: Optional[str] = None,
    keep_loaded: bool = False
) -> Dict[str, Any]:
    """
    Generates high-retention viral social media copy (hooks, main post caption, CTA, hashtags)
    from a video transcript using Ollama or Cloud LLM.
    """
    has_thinking = enable_thinking and detect_model_thinking_capability(model_name)

    system_prompt = """Eres un estratega senior de contenido viral y copywriter profesional para TikTok, Instagram Reels, YouTube Shorts y X.
Tu objetivo es analizar minuciosamente la transcripción del video y redactar un paquete de copywriting irresistible, diseñado para maximizar visualizaciones, retención y comentarios.

REGLAS ESTRICTAS DE CONTENIDO:
1. BASA TODO el contenido (ganchos, descripción y hashtags) EXCLUSIVAMENTE en lo que realmente ocurre, se dice o se debate en la transcripción suministrada.
2. PROHIBIDO generar textos genéricos de 'mira este video', 'bienvenidos a mi canal' o agradecimientos vacíos si eso no es el foco del video.
3. Extrae las anécdotas, momentos de tensión, humor, frases memorables, nombres de juegos o jugadas exactas mencionadas por el hablante.

Responde estrictamente en formato JSON con la siguiente estructura:
{
  "hooks": [
    "Gancho 1: Pregunta intrigante o afirmación impactante sobre lo que ocurrió en el video",
    "Gancho 2: Curiosidad extrema o reacción a la jugada/momento específico",
    "Gancho 3: Frase directa con llamado de atención citando o aludiendo al momento clave"
  ],
  "caption": "Texto persuasivo de 2 a 4 líneas que resuma lo más interesante y divertido del momento sin hacer spoiler del final, listo para pegar en la descripción del post.",
  "cta": "Llamado a la acción invitando a opinar en comentarios o compartir con un amigo sobre la situación ocurrida.",
  "hashtags": ["#tema_especifico", "#gaming", "#clipviral", "#shorts", "#humor"],
  "full_copy": "Texto completo formateado listo para copiar y pegar en redes (incluyendo el mejor gancho, descripción, CTA y hashtags)."
}

IMPORTANTE: Escribe en Español natural, convincente, fresco y sin rodeos."""

    user_prompt = f"Transcripción del video:\n{transcript_text[:6000]}"
    if extra_context:
        user_prompt += f"\n\nContexto adicional: {extra_context}"

    content = ""
    try:
        if provider in ["local", "ollama"]:
            url = "http://127.0.0.1:11434/api/chat"
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "stream": False,
                "options": {"temperature": 0.5, "num_ctx": 8192}
            }
            if keep_loaded:
                payload["keep_alive"] = -1
            if not has_thinking:
                payload["think"] = False
                payload["format"] = "json"
            else:
                payload["think"] = True

            resp = requests.post(url, json=payload, timeout=120)
            if not resp.ok:
                raise RuntimeError(f"Ollama call failed ({resp.status_code}): {resp.text}")
            content = resp.json().get("message", {}).get("content", "")
        elif provider == "lmstudio":
            url = (os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
            direct_hint = "\n\n[MODO DIRECTO]: PROHIBIDO usar <think> o razonar." if not has_thinking else ""
            payload = {
                "model": model_name or "local-model",
                "messages": [
                    {"role": "system", "content": system_prompt + "\n\nResponde ÚNICAMENTE en JSON válido." + direct_hint},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": 0.5,
                "enable_thinking": bool(has_thinking),
                "chat_template_config": {"enable_thinking": bool(has_thinking)}
            }
            resp = requests.post(url, json=payload, timeout=120)
            if not resp.ok:
                raise RuntimeError(f"LM Studio call failed ({resp.status_code}): {resp.text}")
            choices = resp.json().get("choices", [])
            content = choices[0]["message"]["content"] if choices else ""
            if "<think>" in content:
                content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL).strip()
        else:
            content = call_cloud_llm(
                provider=provider,
                api_key=api_key or "",
                prompt=user_prompt,
                model_name=model_name
            )
    finally:
        if not keep_loaded:
            if provider in ["local", "ollama"]:
                unload_all_ollama_models(model_name)
            elif provider == "lmstudio":
                unload_all_lmstudio_models()
        else:
            print(f"Modo ráfaga activo: Modelo '{model_name}' conservado en memoria para copys instantáneos.")

    return repair_and_extract_copy_json(content)


def repair_and_extract_copy_json(raw_text: str) -> Dict[str, Any]:
    """
    Robust extractor and repairer for LLM social copy output.
    Ensures that trailing commas, broken hashtags, unescaped characters, or markdown fences
    never leak raw JSON strings into the user interface.
    """
    if not raw_text:
        return {
            "hooks": ["¡No te pierdas este momento!"],
            "caption": "¡Increíble clip recién salido del horno! Cuéntanos qué opinas.",
            "cta": "¿Qué te pareció este momento? Déjamelo en los comentarios.",
            "hashtags": ["#gaming", "#clipviral", "#shorts"],
            "full_copy": "¡Increíble clip! Cuéntanos qué opinas en los comentarios 👇 #gaming #clipviral"
        }

    text = raw_text
    # 1. Strip thinking tags
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"<think>.*$", "", text, flags=re.DOTALL).strip()

    # 2. Strip surrounding markdown fences
    clean_text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    clean_text = re.sub(r"\s*```$", "", clean_text.strip())

    # Find JSON curly block
    json_match = re.search(r"(\{.*\})", clean_text, re.DOTALL)
    candidate_json = json_match.group(1) if json_match else clean_text

    # Attempt 1: Direct JSON parse
    try:
        data = json.loads(candidate_json)
        if isinstance(data, dict):
            return _normalize_social_copy_dict(data)
    except Exception:
        pass

    # Attempt 2: Auto-repair common LLM JSON syntax errors
    repaired = candidate_json
    # Fix broken unquoted or double-hash hashtags: ,# #Word, or ,#Word, -> ,"#Word",
    repaired = re.sub(r',\s*#+\s*([A-Za-z0-9_]+)', r', "#\1"', repaired)
    repaired = re.sub(r'\[\s*#+\s*([A-Za-z0-9_]+)', r'["#\1"', repaired)
    # Fix trailing commas before } or ]
    repaired = re.sub(r',\s*([\]\}])', r'\1', repaired)

    try:
        data = json.loads(repaired)
        if isinstance(data, dict):
            return _normalize_social_copy_dict(data)
    except Exception:
        pass

    # Attempt 3: Regex field-by-field extraction
    extracted: Dict[str, Any] = {}
    
    # Extract full_copy
    fc_m = re.search(r'"(?:full_copy|fullCopy)"\s*:\s*"((?:\\.|[^"\\])*)"', candidate_json)
    if fc_m:
        try:
            extracted["full_copy"] = fc_m.group(1).encode("utf-8").decode("unicode_escape", errors="replace")
        except Exception:
            extracted["full_copy"] = fc_m.group(1).replace("\\n", "\n")

    # Extract caption
    cap_m = re.search(r'"(?:caption|description)"\s*:\s*"((?:\\.|[^"\\])*)"', candidate_json)
    if cap_m:
        try:
            extracted["caption"] = cap_m.group(1).encode("utf-8").decode("unicode_escape", errors="replace")
        except Exception:
            extracted["caption"] = cap_m.group(1).replace("\\n", "\n")

    # Extract cta
    cta_m = re.search(r'"(?:cta|call_to_action)"\s*:\s*"((?:\\.|[^"\\])*)"', candidate_json)
    if cta_m:
        try:
            extracted["cta"] = cta_m.group(1).encode("utf-8").decode("unicode_escape", errors="replace")
        except Exception:
            extracted["cta"] = cta_m.group(1).replace("\\n", "\n")

    # Extract hooks
    hooks_m = re.search(r'"(?:hooks)"\s*:\s*\[(.*?)\]', candidate_json, re.DOTALL)
    if hooks_m:
        extracted["hooks"] = [
            h.strip().strip('"\'') 
            for h in re.findall(r'"((?:\\.|[^"\\])*)"', hooks_m.group(1)) 
            if h.strip()
        ]

    # Extract hashtags
    tags = re.findall(r'#([A-Za-z0-9_]+)', candidate_json)
    if tags:
        extracted["hashtags"] = [f"#{t}" for t in dict.fromkeys(tags)]

    if extracted.get("full_copy") or extracted.get("caption"):
        return _normalize_social_copy_dict(extracted)

    # Attempt 4: Clean plain text fallback (NEVER return raw JSON fences)
    fallback_text = clean_text
    fallback_text = re.sub(r'^[{\[].*?[}\]]$', '', fallback_text, flags=re.DOTALL).strip()
    if not fallback_text:
        fallback_text = "¡Increíble clip! Cuéntanos qué opinas en los comentarios 👇 #gaming #clipviral"

    return {
        "hooks": ["¡No te pierdas este momento!"],
        "caption": fallback_text[:300],
        "cta": "¿Qué opinas de esta jugada?",
        "hashtags": [f"#{t}" for t in dict.fromkeys(tags)] if tags else ["#gaming", "#clipviral"],
        "full_copy": fallback_text
    }


def _normalize_social_copy_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    caption = str(data.get("caption") or "").strip()
    full_copy = str(data.get("full_copy") or "").strip()
    cta = str(data.get("cta") or "").strip()
    hooks = data.get("hooks", [])
    if isinstance(hooks, str):
        hooks = [hooks]
    hashtags = data.get("hashtags", [])
    if isinstance(hashtags, str):
        hashtags = [t.strip() for t in hashtags.split() if t.startswith("#")]

    if not full_copy:
        parts = []
        if hooks:
            parts.append(hooks[0])
        if caption:
            parts.append(caption)
        if cta:
            parts.append(cta)
        if hashtags:
            parts.append(" ".join(hashtags))
        full_copy = "\n\n".join(parts)

    # Clean any accidental wrapping code fences in full_copy
    full_copy = re.sub(r"^```(?:json)?\s*", "", full_copy).strip()
    full_copy = re.sub(r"\s*```$", "", full_copy).strip()

    return {
        "hooks": hooks,
        "caption": caption,
        "cta": cta,
        "hashtags": hashtags,
        "full_copy": full_copy
    }


