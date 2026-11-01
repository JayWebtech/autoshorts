import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
import requests

from .logger import log_buffer
from python_backend.llm_prompts import (
    DURATION_SPECS,
    parse_time_to_seconds,
    parse_markdown_clips,
    DEFAULT_MOMENTS_PROMPT,
    build_system_prompt,
    strip_emojis_from_text,
    locate_moment_active_window,
)


class ContextExceededError(RuntimeError):
    def __init__(self, message: str, prompt_tokens: Optional[int] = None, max_ctx: Optional[int] = None):
        super().__init__(message)
        self.prompt_tokens = prompt_tokens
        self.max_ctx = max_ctx


class ModelFatalError(RuntimeError):
    pass


def estimate_prompt_tokens(text: str) -> int:
    """
    Fast and robust prompt token estimation for multilingual/Spanish text and JSON.
    """
    words = len(text.split())
    chars = len(text)
    return int(max(words * 1.35, chars / 3.6))


def get_available_context_size(
    provider: str = "local",
    lmstudio_base_url: Optional[str] = None,
    model_name: Optional[str] = None
) -> int:
    """
    Detects the active context window limit from LM Studio or Ollama.
    Returns 8192 by default if not discoverable.
    """
    if provider == "lmstudio":
        try:
            raw_url = (lmstudio_base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
            root_url = raw_url[:-3] if raw_url.endswith("/v1") else raw_url

            # 1. Primary check: LM Studio native API v0 (GET /api/v0/models)
            r0 = requests.get(f"{root_url}/api/v0/models", timeout=1.5)
            if r0.ok:
                data0 = r0.json().get("data", [])
                loaded_models = [m for m in data0 if m.get("state") == "loaded"]
                if loaded_models:
                    if model_name:
                        matched = next((m for m in loaded_models if model_name.lower() in m.get("id", "").lower()), None)
                        if matched and matched.get("loaded_context_length"):
                            return int(matched["loaded_context_length"])
                    first_loaded = loaded_models[0]
                    if first_loaded.get("loaded_context_length"):
                        return int(first_loaded["loaded_context_length"])

            # 2. Secondary check: LM Studio API v1 (GET /api/v1/models)
            r1 = requests.get(f"{root_url}/api/v1/models", timeout=1.5)
            if r1.ok:
                data1 = r1.json()
                models_list = data1.get("models", [])
                for m in models_list:
                    instances = m.get("loaded_instances", [])
                    if instances:
                        inst = instances[0]
                        cfg = inst.get("config", {}) if isinstance(inst.get("config"), dict) else {}
                        ctx = cfg.get("context_length") or inst.get("context_length") or inst.get("n_ctx")
                        if ctx and isinstance(ctx, int) and ctx > 0:
                            return ctx
        except Exception:
            pass
    return 8192


def unload_all_ollama_models(specific_model: Optional[str] = None):

    """
    Unloads Ollama models from VRAM immediately so RAM/VRAM is freed for other tasks or models.
    Fails silently if Ollama server is not running.
    """
    try:
        resp = requests.get("http://127.0.0.1:11434/api/ps", timeout=1.0)
        if resp.ok:
            data = resp.json()
            models = data.get("models", [])
            for m in models:
                m_name = m.get("name") or m.get("model")
                if m_name:
                    requests.post("http://127.0.0.1:11434/api/generate", json={"model": m_name, "keep_alive": 0}, timeout=2)
            if specific_model and not any((m.get("name") or m.get("model")) == specific_model for m in models):
                requests.post("http://127.0.0.1:11434/api/generate", json={"model": specific_model, "keep_alive": 0}, timeout=2)
            if models or specific_model:
                print("VRAM liberada: Modelos de Ollama descargados de memoria.")
    except Exception:
        pass


def unload_all_lmstudio_models(base_url: Optional[str] = None):
    """
    Unloads all LM Studio models/instances from VRAM immediately and aborts active generations.
    Fails silently if LM Studio server is not running.
    """
    try:
        raw_url = (base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
        root_url = raw_url[:-3] if raw_url.endswith("/v1") else raw_url
        resp = requests.get(f"{root_url}/api/v1/models", timeout=1.0)
        if resp.ok:
            data = resp.json()
            unloaded = False
            for m in data.get("models", []):
                for inst in m.get("loaded_instances", []):
                    inst_id = inst.get("id")
                    if inst_id:
                        requests.post(f"{root_url}/api/v1/models/unload", json={"instance_id": inst_id}, timeout=2)
                        print(f"VRAM liberada: Modelo de LM Studio '{inst_id}' descargado de memoria.")
                        unloaded = True
    except Exception:
        pass


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

            ctx_len = None
            try:
                r0 = requests.get(f"{root_url}/api/v0/models", timeout=1.2)
                if r0.ok:
                    data0 = r0.json().get("data", [])
                    loaded0 = next((m for m in data0 if m.get("state") == "loaded"), None)
                    if loaded0:
                        ctx_len = loaded0.get("loaded_context_length")
            except Exception:
                pass

            resp = requests.get(f"{root_url}/api/v1/models", timeout=1.5)
            if resp.ok:
                data = resp.json()
                for m in data.get("models", []):
                    instances = m.get("loaded_instances", [])
                    if instances:
                        result["isLoaded"] = True
                        result["loadedModel"] = m.get("display_name") or m.get("key") or m.get("id")
                        result["provider"] = "lmstudio"
                        result["contextLength"] = ctx_len
                        size_b = m.get("size_bytes", 0)
                        result["sizeMb"] = round(size_b / (1024 * 1024)) if size_b else None
                        result["details"] = [{"name": m.get("key") or m.get("id"), "sizeMb": result["sizeMb"], "contextLength": ctx_len}]
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


def ensure_model_loaded(
    provider: str,
    model_name: Optional[str] = None,
    lmstudio_base_url: Optional[str] = None
) -> None:
    """
    Ensures that the LLM model is fully loaded in memory/VRAM before querying context
    size or launching generation chunks, preventing circuit breaker timeouts or default 8k fallbacks.
    """
    if provider == "lmstudio":
        try:
            raw_url = (lmstudio_base_url or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/")
            root_url = raw_url[:-3] if raw_url.endswith("/v1") else raw_url

            r = requests.get(f"{root_url}/api/v0/models", timeout=2.0)
            if r.ok:
                data = r.json().get("data", [])
                loaded_models = [m for m in data if m.get("state") == "loaded"]
                if loaded_models:
                    if model_name:
                        matched = next((m for m in loaded_models if model_name.lower() in m.get("id", "").lower()), None)
                        if matched:
                            return
                    else:
                        return

            display_name = model_name or "local"
            log_buffer.push(f"[LM Studio] Inicializando y cargando modelo '{display_name}' en memoria...")
            preload_res = preload_local_model(model_name=model_name or "", provider="lmstudio", lmstudio_base_url=lmstudio_base_url)
            if preload_res.get("success"):
                log_buffer.push(f"[LM Studio] Modelo '{display_name}' cargado con éxito en memoria.")
            else:
                log_buffer.push(f"[LM Studio] Aviso en precarga: {preload_res.get('error')}")
        except Exception as e:
            log_buffer.push(f"[LM Studio] Nota durante verificación de modelo: {e}")


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

    start_idx = 0
    for i, s in enumerate(segments):
        if s["start"] <= start <= s["end"] or abs(s["start"] - start) < 2.0:
            start_idx = i
            break

    new_end = end
    for s in segments[start_idx:]:
        new_end = max(new_end, s["end"])
        if (new_end - start) >= target_ideal:
            break

    if (new_end - start) < target_min:
        new_end = start + target_min

    return start, min(new_end, start + target_max)


def _coerce_candidate_timestamp(val: Any) -> float:
    """Safely converts float, int or string timestamps (e.g. '00:01:23.450' or '83.45') to seconds float."""
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        v = val.strip()
        try:
            return float(v)
        except ValueError:
            return parse_time_to_seconds(v)
    return 0.0


def parse_candidate_json(
    text: str,
    min_duration: float = 5.0,
    segments: Optional[List[Dict[str, Any]]] = None,
    target_duration: str = "60s"
) -> List[Dict[str, Any]]:
    clean = text.strip()
    clean = re.sub(r"<think>.*?</think>", "", clean, flags=re.DOTALL).strip()
    clean = re.sub(r"^```json\s*", "", clean)
    clean = re.sub(r"^```\s*", "", clean)

    val = None
    start_brace = clean.find('{')
    if start_brace != -1:
        try:
            val, _ = json.JSONDecoder().raw_decode(clean[start_brace:])
        except Exception:
            pass

    if val is None:
        start_bracket = clean.find('[')
        if start_bracket != -1:
            try:
                val, _ = json.JSONDecoder().raw_decode(clean[start_bracket:])
            except Exception:
                pass

    if val is None:
        match = re.search(r"(\{.*\})", clean, re.DOTALL)
        if match:
            try:
                val = json.loads(match.group(1))
            except Exception:
                pass

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
            start = _coerce_candidate_timestamp(item.get("start", 0.0))
            end = _coerce_candidate_timestamp(item.get("end", 0.0))
            score = float(item.get("score", 0.8))
            if score > 1.0 and score <= 10.0:
                score /= 10.0
            elif score > 10.0:
                score /= 100.0

            hook = str(item.get("hook") or item.get("viral_hook_text") or item.get("title") or "").strip()
            rationale = str(item.get("rationale") or item.get("reasoning") or item.get("reason") or "").strip()
            description = str(item.get("description", "")).strip()

            clean_hook = hook.strip(" .…_")
            if not clean_hook or clean_hook in ["...", "…", "None", "null", "undefined"]:
                continue
            if hook == "..." or rationale == "..." or description == "...":
                continue
            if start == 0.0 and end == 0.0 and len(clean_hook) < 5:
                continue

            if not description and hook:
                description = f"{hook}. ¿Qué opinas? Déjalo en comentarios. #shorts #viral #gaming"

            dur = end - start
            if dur < target_min:
                start, end = expand_short_candidate(
                    start, end, segments,
                    target_min=target_min,
                    target_max=target_max
                )
            dur = end - start
            min_floor = 25.0 if target_duration == "30s" else 30.0
            if dur < min_floor:
                end = start + max(min_floor, target_min)
                dur = end - start

            effective_min = min_floor if target_duration == "30s" else max(30.0, target_min * 0.6)
            if dur >= effective_min and hook:
                hook_title = str(item.get("hook_title") or item.get("hookTitle") or item.get("viral_hook_text") or hook).strip()
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
    if not model_name:
        return False
    if model_name in _THINKING_CACHE:
        return _THINKING_CACHE[model_name]

    try:
        resp = requests.post("http://127.0.0.1:11434/api/show", json={"name": model_name}, timeout=3)
        if resp.ok:
            data = resp.json()
            caps = [str(c).lower() for c in data.get("capabilities", [])]
            if "thinking" in caps:
                _THINKING_CACHE[model_name] = True
                return True

            template = data.get("template", "").lower()
            if "<think>" in template or "thinking" in template:
                _THINKING_CACHE[model_name] = True
                return True

            details = data.get("details", {})
            family = str(details.get("family", "")).lower()
            families = [str(f).lower() for f in details.get("families", [])]
            if any(f in ["deepseek2", "deepseek3", "qwen35", "gemma4"] for f in [family] + families):
                _THINKING_CACHE[model_name] = True
                return True
    except Exception:
        pass

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
        payload.pop("format", None)
        resp = requests.post(url, json=payload, timeout=300)

    if not resp.ok:
        raise RuntimeError(f"Ollama call failed ({resp.status_code}): {resp.text}")
    data = resp.json()
    msg = data.get("message", {})
    thinking = msg.get("thinking", "")
    content = msg.get("content", "")

    if "<think>" in content:
        inline_thinks = re.findall(r"<think>(.*?)</think>", content, re.DOTALL)
        if inline_thinks and not thinking:
            thinking = "\n".join(inline_thinks).strip()
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

    if not content and thinking:
        m = re.search(r"(\{.*\"candidates\".*\})", thinking, re.DOTALL)
        if m:
            content = m.group(1)

    return content


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
    except requests.exceptions.ConnectionError as e:
        raise ModelFatalError(f"No se pudo conectar a LM Studio en {url}. ¿Está iniciado el servidor local en LM Studio?")
    except Exception as e:
        raise RuntimeError(f"Error al enviar petición a LM Studio: {e}")

    if not resp.ok:
        err_text = resp.text
        if "exceed_context_size_error" in err_text or "exceeds the available context size" in err_text or "n_ctx" in err_text:
            m_ctx = re.search(r'"n_ctx":\s*(\d+)', err_text)
            m_tokens = re.search(r'"n_prompt_tokens":\s*(\d+)', err_text)
            max_ctx = int(m_ctx.group(1)) if m_ctx else 8192
            prompt_tokens = int(m_tokens.group(1)) if m_tokens else None
            raise ContextExceededError(err_text, prompt_tokens=prompt_tokens, max_ctx=max_ctx)

        if "Model unloaded" in err_text or "unloaded by user" in err_text:
            raise ModelFatalError("El modelo fue descargado en LM Studio o la petición fue anulada por el servidor.")

        raise RuntimeError(f"LM Studio call failed ({resp.status_code}): {err_text}")

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



def deduplicate_candidates(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not candidates:
        return []

    sorted_cands = sorted(candidates, key=lambda x: x["start"])
    unique = []

    for c in sorted_cands:
        is_dup = False
        for u in unique:
            overlap_start = max(c["start"], u["start"])
            overlap_end = min(c["end"], u["end"])
            if overlap_end > overlap_start:
                overlap_dur = overlap_end - overlap_start
                min_dur = min(c["end"] - c["start"], u["end"] - u["start"])
                if min_dur > 0 and (overlap_dur / min_dur) > 0.5:
                    is_dup = True
                    if c["score"] > u["score"]:
                        u["start"] = c["start"]
                        u["end"] = c["end"]
                        u["score"] = c["score"]
                        u["hook"] = c["hook"]
                        u["rationale"] = c["rationale"]
                        u["description"] = c.get("description", u.get("description", ""))
                    break
        if not is_dup:
            unique.append(c)

    return sorted(unique, key=lambda x: x["score"], reverse=True)


def generate_fallback_candidates(
    transcript: Dict[str, Any],
    target_duration: str = "60s"
) -> List[Dict[str, Any]]:
    segments = transcript.get("segments", [])
    if not segments:
        return []

    dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
    target_len = (dur_info["min"] + dur_info["max"]) / 2.0
    total_dur = segments[-1]["end"]

    fallback = []
    curr = 0.0
    step = max(target_len * 2, total_dur / 6.0)

    while curr < total_dur:
        end_time = min(total_dur, curr + target_len)
        if (end_time - curr) >= dur_info["min"]:
            sub_segs = [s for s in segments if s["end"] > curr and s["start"] < end_time]
            first_words = " ".join([s.get("text", "") for s in sub_segs[:2]]).strip()
            hook_text = first_words[:60] + "..." if len(first_words) > 60 else (first_words or "Momento Destacado")
            fallback.append({
                "start": round(curr, 2),
                "end": round(end_time, 2),
                "score": 0.85,
                "hook": hook_text,
                "rationale": "Momento seleccionado por alta densidad de actividad.",
                "description": f"{hook_text}. ¿Qué opinas? #gaming #viral #shorts"
            })
        curr += step

    return fallback


def _analyze_chunk_adaptively(
    chunk: List[Dict[str, Any]],
    provider: str,
    model_name: Optional[str],
    content_type: str,
    target_duration: str,
    custom_prompt: Optional[str],
    enable_thinking: bool,
    action_peaks: List[Dict[str, Any]],
    context_limit: int,
    depth: int = 0
) -> List[Dict[str, Any]]:
    if not chunk:
        return []

    chunk_start = chunk[0]["start"]
    chunk_end = chunk[-1]["end"]
    chunk_start_fmt = f"{int(chunk_start // 60):02d}:{int(chunk_start % 60):02d}"
    chunk_end_fmt = f"{int(chunk_end // 60):02d}:{int(chunk_end % 60):02d}"

    chunk_peaks = [p for p in action_peaks if p["end"] > chunk_start and p["start"] < chunk_end]
    word_count = sum(len(s.get("text", "").split()) for s in chunk)
    if word_count < 12 and not chunk_peaks:
        return []

    peak_cues = ""
    if chunk_peaks:
        cue_lines = [
            f"- [{int(p['start']//60):02d}:{int(p['start']%60):02d} a {int(p['end']//60):02d}:{int(p['end']%60):02d}] 💥 ACCIÓN INTENSA / DISPAROS DEL JUEGO"
            for p in chunk_peaks[:5]
        ]
        peak_cues = "\n\nZonas de alta acción/disparos detectadas acústicamente:\n" + "\n".join(cue_lines)

    dur_info = DURATION_SPECS.get(target_duration, DURATION_SPECS["60s"])
    instruction_text = (
        f"\n\nINSTRUCCIÓN:\n"
        f"Analiza la transcripción anterior y extrae entre 1 y 5 momentos virales ({dur_info['instruction']}).\n"
        f"Responde estrictamente en formato JSON así:\n"
        f'{{"candidates": [{{"start": 0.0, "end": 0.0, "score": 0.95, "hook": "Título Gancho", "rationale": "Por qué es viral", "description": "Texto llamativo para redes con hashtags"}}]}}'
    )
    prompt_text = f"Transcripción del segmento [{chunk_start_fmt} a {chunk_end_fmt}]:\n{compact_segments(chunk)}{peak_cues}{instruction_text}"

    est_tokens = estimate_prompt_tokens(prompt_text)
    safe_token_ceiling = max(1800, int(context_limit * 0.65))

    if est_tokens > safe_token_ceiling and len(chunk) > 3 and depth < 3:
        print(f"[ADAPTIVE] Bloque [{chunk_start_fmt} - {chunk_end_fmt}] tiene ~{est_tokens} tokens (limite seguro {safe_token_ceiling}). Subdividiendo preventivamente...")
        mid = len(chunk) // 2
        left_chunk = chunk[:mid + 1]
        right_chunk = chunk[max(0, mid - 1):]
        res_left = _analyze_chunk_adaptively(left_chunk, provider, model_name, content_type, target_duration, custom_prompt, enable_thinking, action_peaks, context_limit, depth + 1)
        res_right = _analyze_chunk_adaptively(right_chunk, provider, model_name, content_type, target_duration, custom_prompt, enable_thinking, action_peaks, context_limit, depth + 1)
        return res_left + res_right

    try:
        if provider == "lmstudio":
            resp_text = call_lmstudio(
                prompt_text,
                model_name=model_name,
                content_type=content_type,
                target_duration=target_duration,
                custom_prompt=custom_prompt,
                enable_thinking=enable_thinking
            )
        else:
            model = model_name or "qwen2.5:7b"
            resp_text = call_ollama(
                prompt_text,
                model_name=model,
                content_type=content_type,
                target_duration=target_duration,
                enable_thinking=enable_thinking,
                custom_prompt=custom_prompt
            )

        return parse_candidate_json(
            resp_text,
            min_duration=5.0,
            segments=chunk,
            target_duration=target_duration
        )

    except ContextExceededError as e:
        new_ctx = e.max_ctx or context_limit
        if len(chunk) > 3 and depth < 3:
            print(f"[ALERTA] Contexto excedido en bloque [{chunk_start_fmt} - {chunk_end_fmt}] ({e.prompt_tokens or est_tokens} > {new_ctx} tokens). Subdividiendo dinamicamente a la mitad...")
            mid = len(chunk) // 2
            left_chunk = chunk[:mid + 1]
            right_chunk = chunk[max(0, mid - 1):]
            res_left = _analyze_chunk_adaptively(left_chunk, provider, model_name, content_type, target_duration, custom_prompt, enable_thinking, action_peaks, new_ctx, depth + 1)
            res_right = _analyze_chunk_adaptively(right_chunk, provider, model_name, content_type, target_duration, custom_prompt, enable_thinking, action_peaks, new_ctx, depth + 1)
            return res_left + res_right
        else:
            print(f"[ALERTA] Bloque [{chunk_start_fmt} - {chunk_end_fmt}] excede el contexto ({new_ctx} tokens) y no puede dividirse mas. Omitiendo.")
            return []

    except ModelFatalError:
        raise

    except Exception as e:
        print(f"Error analizando bloque [{chunk_start_fmt} - {chunk_end_fmt}]: {e}")
        return []


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
    Main detection pipeline using Adaptive Dynamic Chunking ("Divide y Vencerás").
    Runs 100% locally with Ollama or LM Studio.
    """
    segments = transcript.get("segments", [])
    if not segments:
        return []

    action_peaks = []
    if audio_path and os.path.exists(audio_path):
        try:
            from .media import detect_audio_action_peaks
            action_peaks = detect_audio_action_peaks(audio_path)
            if action_peaks:
                print(f"Detectadas {len(action_peaks)} zonas de acción acústica intensa en el audio del juego.")
        except Exception as e:
            print(f"Nota en detección de picos de audio: {e}")

    # Ensure model is active in LM Studio before querying context length
    if provider == "lmstudio":
        ensure_model_loaded(provider=provider, model_name=model_name)

    # Detect active context size from LM Studio / Ollama
    available_ctx = get_available_context_size(provider=provider, model_name=model_name)
    log_buffer.push(f"[Contexto IA] Contexto detectado: {available_ctx} tokens.")
    if available_ctx <= 4096:
        chunk_dur = 180.0
        overlap = 30.0
    elif available_ctx <= 8192:
        chunk_dur = 300.0  # 5 minutes: ideal for 8k context without overflowing
        overlap = 45.0
    else:
        chunk_dur = 900.0 if target_duration in ["3m", "5m"] else 600.0
        overlap = 120.0 if target_duration in ["3m", "5m"] else 45.0

    chunks = partition_segments(segments, chunk_duration_sec=chunk_dur, overlap_sec=overlap)
    total_chunks = len(chunks)
    all_drafts = []

    print(f"Dividing stream into {total_chunks} chunk(s) of {int(chunk_dur//60)} min for {content_type} detection (Context: {available_ctx} tokens)...")

    try:
        for idx, chunk in enumerate(chunks, start=1):
            if is_cancelled and is_cancelled():
                print("[CANCELADO] Proceso de detección cancelado por el usuario.")
                break

            chunk_start_fmt = f"{int(chunk[0]['start'] // 60):02d}:{int(chunk[0]['start'] % 60):02d}"
            chunk_end_fmt = f"{int(chunk[-1]['end'] // 60):02d}:{int(chunk[-1]['end'] % 60):02d}"

            status_msg = f"Analizando bloque {idx}/{total_chunks} ({chunk_start_fmt} - {chunk_end_fmt})..."
            if on_progress:
                on_progress(status_msg, idx, total_chunks)

            try:
                chunk_candidates = _analyze_chunk_adaptively(
                    chunk=chunk,
                    provider=provider,
                    model_name=model_name,
                    content_type=content_type,
                    target_duration=target_duration,
                    custom_prompt=custom_prompt,
                    enable_thinking=enable_thinking,
                    action_peaks=action_peaks,
                    context_limit=available_ctx
                )
                all_drafts.extend(chunk_candidates)
            except ModelFatalError as e:
                print(f"[CIRCUIT BREAKER] Error crítico en motor LLM: {e}. Deteniendo búsqueda de momentos para evitar saturación.")
                if on_progress:
                    on_progress(f"Proceso detenido: {e}", idx, total_chunks)
                break

            if is_cancelled and is_cancelled():
                break



        if target_duration in ["30s", "60s"]:
            for p in action_peaks:
                overlapping_speech = [s for s in segments if s["end"] > p["start"] and s["start"] < p["end"]]
                if len(overlapping_speech) <= 1:
                    peak_dur = p["end"] - p["start"]
                    pad = max(10.0, (45.0 - peak_dur) / 2.0)
                    clutch_start = max(0.0, p["start"] - pad)
                    clutch_end = min(segments[-1]["end"], p["end"] + pad)
                    all_drafts.append({
                        "start": round(clutch_start, 2),
                        "end": round(clutch_end, 2),
                        "score": 0.92,
                        "hook": "💥 Jugada Clutch y Acción Intensa",
                        "hook_title": "Jugada Épica",
                        "rationale": "Pico acústico intenso con concentración del streamer.",
                        "description": "¡Momento de máxima tensión y jugada épica! #gaming #clutch #shorts"
                    })

    finally:
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)
        elif provider == "lmstudio":
            unload_all_lmstudio_models()

    deduped = deduplicate_candidates(all_drafts)
    if not deduped:
        print("Sin candidatos tras análisis LLM. Generando momentos destacados por actividad.")
        return generate_fallback_candidates(transcript, target_duration=target_duration)

    return deduped


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
    Performs spelling, punctuation, and grammar corrections on transcript segments using Ollama or LM Studio.
    """
    if not segments:
        return []

    refined_segments = [dict(s) for s in segments]
    total_segments = len(refined_segments)
    batches = [refined_segments[i:i + chunk_size] for i in range(0, total_segments, chunk_size)]
    total_batches = len(batches)

    system_instruction = (
        "Eres un editor profesional de transcripciones en español para streams y podcasts de videojuegos. "
        "Tu única tarea es corregir errores ortográficos, nombres de juegos, jerga gamer (clutch, headshot, respawn, buff, nerfeo, etc.) y puntuación. "
        "PROHIBIDO resumir o cambiar el significado. Devuelve exactamente el mismo número de líneas con el formato: [1] Texto corregido"
    )

    try:
        for b_idx, batch in enumerate(batches, start=1):
            if is_cancelled and is_cancelled():
                break

            msg = f"Perfeccionando transcripción: bloque {b_idx} de {total_batches}..."
            if on_progress:
                on_progress(msg, b_idx, total_batches)

            formatted_lines = [f"[{i}] {seg.get('text', '').strip()}" for i, seg in enumerate(batch, start=1)]
            user_prompt = f"Corrige las siguientes líneas:\n" + "\n".join(formatted_lines)

            raw_resp = ""
            if provider == "lmstudio":
                url = (os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")).rstrip("/") + "/chat/completions"
                payload = {
                    "model": model_name or "local-model",
                    "messages": [
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.1
                }
                try:
                    resp = requests.post(url, json=payload, timeout=120)
                    if resp.ok:
                        choices = resp.json().get("choices", [])
                        if choices:
                            raw_resp = choices[0]["message"]["content"]
                except Exception as e:
                    print(f"LM Studio refine error: {e}")
            else:
                url = "http://127.0.0.1:11434/api/chat"
                payload = {
                    "model": model_name or "qwen2.5:7b",
                    "messages": [
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": user_prompt}
                    ],
                    "stream": False,
                    "options": {"temperature": 0.1}
                }
                try:
                    resp = requests.post(url, json=payload, timeout=120)
                    if resp.ok:
                        raw_resp = resp.json().get("message", {}).get("content", "")
                except Exception as e:
                    print(f"Ollama refine error: {e}")

            corrected_dict = {}
            for line in raw_resp.splitlines():
                line_str = line.strip()
                m = re.match(r"^[\*\-\s]*\[?(\d+)\]?[\s:\-–—\.]+(.*)$", line_str)
                if m:
                    line_id = int(m.group(1))
                    text_corr = m.group(2).strip().strip("`\"'")
                    if "->" in text_corr:
                        text_corr = text_corr.split("->")[-1].strip().strip('`"\'')
                    if text_corr:
                        corrected_dict[line_id] = text_corr

            for i, seg in enumerate(batch, start=1):
                if i in corrected_dict and len(corrected_dict[i]) >= 1:
                    seg["text"] = corrected_dict[i]

    finally:
        if provider in ["local", "ollama"]:
            unload_all_ollama_models(model_name)
        elif provider == "lmstudio":
            unload_all_lmstudio_models()

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
    using local Ollama or LM Studio.
    """
    has_thinking = enable_thinking and detect_model_thinking_capability(model_name)

    system_prompt = """Eres un estratega senior de contenido viral y copywriter profesional para TikTok, Instagram Reels y YouTube Shorts.
Tu objetivo es analizar minuciosamente la transcripción del clip y redactar un copy de alta retención, ultra-conciso y listo para publicar.

REGLAS ESTRICTAS DE CONTENIDO:
1. BASA TODO el texto EXCLUSIVAMENTE en lo que realmente ocurre o se dice en la transcripción. Cero invenciones o datos falsos.
2. CERO RELLENO O FRASES CLICHÉ: Prohibido usar vocabulario genérico inflado ("sumérgete", "un viaje", "eleva tu nivel"). Habla en tono directo, conversacional y humano.
3. CONCISIÓN OBLIGATORIA (MÁXIMO 2-3 LÍNEAS): En TikTok y Reels el texto largo tapa el video y molesta al espectador. La descripción debe ser breve y directa al grano.
4. LÍMITE ESTRICTO DE HASHTAGS: Exactamente entre 3 y 5 hashtags relevantes (específicos del juego o tema + 1 de formato). Prohibido hacer listas largas de hashtags.

Responde estrictamente en formato JSON con la siguiente estructura:
{
  "hooks": [
    "Gancho 1: Pregunta o frase intrigante sobre lo que ocurrió (máx. 10 palabras)",
    "Gancho 2: Reacción a la jugada o momento clave",
    "Gancho 3: Frase directa con llamado de atención"
  ],
  "caption": "1 o 2 oraciones breves de contexto o intriga sin spoiler.",
  "cta": "¿Qué habrías hecho tú? Déjalo en comentarios.",
  "hashtags": ["#tema_especifico", "#gaming", "#shorts", "#viral"],
  "full_copy": "Gancho punchy\\n1 o 2 oraciones breves de contexto.\\n¿Qué opinas? Déjalo en comentarios.\\n#tema #shorts #viral"
}

Escribe en Español natural, directo y sin guiones largos (em dashes)."""

    user_prompt = f"Transcripción del video:\n{transcript_text[:6000]}"
    if extra_context:
        user_prompt += f"\n\nContexto adicional: {extra_context}"

    content = ""
    try:
        if provider == "lmstudio":
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
            url = "http://127.0.0.1:11434/api/chat"
            payload = {
                "model": model_name or "qwen2.5:7b",
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

    finally:
        if not keep_loaded:
            if provider == "lmstudio":
                unload_all_lmstudio_models()
            else:
                unload_all_ollama_models(model_name)

    return repair_and_extract_copy_json(content)


def repair_and_extract_copy_json(raw_text: str) -> Dict[str, Any]:
    text = raw_text.strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    start_pos = text.find("{")
    if start_pos != -1:
        text = text[start_pos:]
    end_pos = text.rfind("}")
    if end_pos != -1:
        text = text[:end_pos + 1]

    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return _normalize_social_copy_dict(data)
    except Exception:
        pass

    hooks = re.findall(r"(?:Gancho|Hook)\s*\d*[:\s\-]+([^\n]+)", text, re.IGNORECASE)
    caption_m = re.search(r"(?:Descripción|Caption|Cuerpo)[:\s\-]+([^\n]+(?:\n[^\n]+){1,3})", text, re.IGNORECASE)
    cta_m = re.search(r"(?:CTA|Llamado)[:\s\-]+([^\n]+)", text, re.IGNORECASE)
    hashtags = re.findall(r"(#[a-zA-Z0-9_]+)", text)

    fallback_data = {
        "hooks": hooks[:3] if hooks else ["¡Mira este momento increíble!"],
        "caption": caption_m.group(1).strip() if caption_m else "Un momento destacado del stream.",
        "cta": cta_m.group(1).strip() if cta_m else "¿Qué opinas de esta jugada? Comenta abajo.",
        "hashtags": hashtags[:5] if hashtags else ["#shorts", "#viral", "#gaming"]
    }
    return _normalize_social_copy_dict(fallback_data)


def _normalize_social_copy_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    hooks = data.get("hooks", [])
    if isinstance(hooks, str):
        hooks = [hooks]
    elif not isinstance(hooks, list):
        hooks = []

    cleaned_hooks = []
    for h in hooks:
        h_str = str(h).strip().replace("—", "-")
        h_str = re.sub(r"^(?:Gancho|Hook)\s*\d*[:\s\-]+", "", h_str, flags=re.IGNORECASE).strip()
        if h_str:
            cleaned_hooks.append(h_str)

    caption = str(data.get("caption") or data.get("description") or "").strip().replace("—", "-")
    cta = str(data.get("cta") or "").strip().replace("—", "-")

    # Clean hashtags: ensure # prefix, strip non-alphanumeric, deduplicate
    raw_hashtags = data.get("hashtags", [])
    extracted = []
    if isinstance(raw_hashtags, str):
        extracted = [h.strip() for h in raw_hashtags.split() if h.startswith("#")]
    elif isinstance(raw_hashtags, list):
        for h in raw_hashtags:
            clean_tag = re.sub(r"[^\w]", "", str(h).strip())
            if clean_tag:
                extracted.append(f"#{clean_tag}")

    seen = set()
    hashtags = []
    for tag in extracted:
        lower = tag.lower()
        if lower not in seen:
            seen.add(lower)
            hashtags.append(tag)

    # Strictly enforce 3 to 5 hashtags
    if len(hashtags) > 5:
        hashtags = hashtags[:5]
    elif len(hashtags) < 3:
        for fallback_tag in ["#shorts", "#viral", "#gaming", "#clip"]:
            if fallback_tag.lower() not in seen and len(hashtags) < 3:
                seen.add(fallback_tag.lower())
                hashtags.append(fallback_tag)

    full_copy = str(data.get("full_copy") or "").strip().replace("—", "-")
    if not full_copy:
        primary_hook = cleaned_hooks[0] if cleaned_hooks else "¡Momento destacado!"
        parts = [primary_hook]
        if caption:
            parts.append(caption)
        if cta:
            parts.append(cta)
        if hashtags:
            parts.append(" ".join(hashtags))
        full_copy = "\n".join(parts)
    else:
        # If full_copy was provided, ensure it includes clean hashtags if none were present
        if not any(h in full_copy for h in hashtags) and hashtags:
            full_copy += f"\n{' '.join(hashtags)}"

    return {
        "hooks": cleaned_hooks if cleaned_hooks else ["¡Mira este momento increíble!"],
        "caption": caption,
        "cta": cta,
        "hashtags": hashtags,
        "full_copy": full_copy.strip()
    }
