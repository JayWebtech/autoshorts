# Plan 28 — Auditoría Senior: Optimización y Calidad Production-Ready

> **Skills activas:** antislop (after mode) · antislop-code · senior-code-craft (todos los 5 pilares)
> **Siguiente acción requerida del usuario:** `PLAN APROBADO` para ejecutar.
> **Número de tareas:** 12 optimizaciones ordenadas por ROI

---

## 1. Diagnóstico

### Contexto del codebase actual

| Área | Archivo | Líneas | Situación |
|---|---|---|---|
| Backend LLM | `llm.py` | 1489 | Monolítico, lógica de duración duplicada |
| Backend API | `api.py` | 1353 | God class sin separación de capas |
| Backend Media | `media.py` | 1433 | Multiresponsabilidad (render, ASS, acústica, thumbnails) |
| Backend DB | `db.py` | 662 | Patrón `get_conn()` → nueva conexión en cada query |
| Frontend Pipeline | `useMediaPipeline.ts` | 721 | Hook monolítico, 4 responsabilidades mezcladas |
| Frontend UI | `CandidatePreviewModal.tsx` | 2530 | Componente más grande de toda la app |
| Frontend UI | `CandidatePanel.tsx` | 1283 | Prop-drilling profundo de `enableThinking` |
| Frontend Settings | `SettingsPanel.tsx` | 663 | Prop-chain `enableThinking` aún activa pero inútil |

### Hallazgos críticos identificados

**[CRÍTICO-01] Nueva conexión SQLite por cada operación**
`db.py` llama a `sqlite3.connect()` en `get_conn()` cada vez que se ejecuta una query. Con proyectos grandes que tienen candidatos, clips y copias, esto genera cientos de conexiones abiertas y cerradas en un mismo flujo (ej. `get_project_detail` → join de candidates → join de clips → join de clip_copy = 4+ conexiones). Riesgo: file lock en Windows bajo concurrencia baja.

**[CRÍTICO-02] `enableThinking` prop chain de 7 capas sin valor real**
`App.tsx` → `SettingsPanel` → `ModalContainer` → `StyleModal` + `ImportModal` + `CandidatePanel` + `useMediaPipeline` → `api.py` → `llm.py`. El valor ya es efectivamente `false` permanente desde el plan 27 (el checkbox fue eliminado de la UI). Sin embargo, el parámetro sigue fluyendo por toda la cadena, causando re-renders innecesarios cuando cambia cualquier setting. Confirmado por subagente: **dead props** en `CandidatePanel`, `SettingsPanel` y `StyleModal` — se reciben pero no hay UI asociada.

**[CRÍTICO-03] Sin retry/backoff en llamadas HTTP a LLM**
`call_ollama()` y `call_lmstudio()` tienen un único `timeout=300/240`. Si el modelo responde lento en una petición de bisección larga, la operación entera falla sin reintentos. Riesgo real: en PCs con 4 GB VRAM, la carga del modelo puede tardar 30-60s extras.

**[CRÍTICO-04] `SettingsPanel` duplicado en árbol de render**
`settingsNode` en `App.tsx` construye `<SettingsPanel>` **fuera del JSX principal**, y `<ModalContainer>` vuelve a instanciar su propio `<SettingsPanel>` — dos instancias posibles del mismo componente con los mismos ~25 props pasados dos veces. Duplicación masiva.

**[ALTO-01] Duplicación `expand_short_candidate` + `clamp_candidate_duration`**
Ambas funciones iteran sobre `segments` con lógica de boundary-finding casi idéntica. Se pueden unir en `normalize_candidate_duration(start, end, segments, min, max)` que hace expand + clamp en una sola pasada lineal O(n).

**[ALTO-02] Sin caché de `probe_media` / ffprobe**
`probe_media()` se llama en `get_project_detail()`, `create_project_from_path()` y otros puntos. No hay caché de resultados de ffprobe. Cada llamada lanza un subproceso ffprobe. Con 10+ proyectos, esto ocurre decenas de veces en el arranque.

**[ALTO-03] `classify_hook_type` duplicado en `llm.py` y `db.py`**
La misma función con distinta signatura existe en dos lugares. `db._infer_hook_type()` y `llm.classify_hook_type()` divergen en keywords (ej. "aim", "episodio/capitulo" solo en llm.py).

**[ALTO-04] `parse_candidate_json` tiene 5 intentos de reparación JSON sin logging**
Los 5 intentos de `raw_decode` → regex → bracket-closing son silenciosos. Ausencia de telemetría de calidad LLM.

**[ALTO-05] `selectedCount`, filtros de candidatos sin `useMemo`**
En `useMediaPipeline.ts`: `selectedCount`, `selectedCutCount`, `selectedCaptionsCount` son derivados de `.filter()` sin memoizar — se recalculan en cada render. En `CandidatePanel.tsx`: `dismissedCandidates`, `exportedCandidates`, `pendingCandidates`, `activeCandidates`, y el sort final `displayedCandidates` tampoco están memoizados. Con 50+ candidatos y re-renders frecuentes durante búsqueda de momentos, el costo es O(n) innecesario por render.

**[ALTO-06] `window.confirm` bloqueante en 3 puntos**
`useMediaPipeline` (×2: líneas ~302 y ~418) y `SettingsPanel` (×1: reset de config). `window.confirm` bloquea el event loop y en WebView2/pywebview puede no renderizarse correctamente o colgarse.

**[ALTO-07] `setTimeout` sin `clearTimeout` en cancelaciones**
`cancelTranscription` y `cancelMoments` crean `setTimeout(() => { setBusy("idle"); }, 400/500)` sin guardar el ID de timer. Si el componente se desmonta antes del timeout, el setter se llama sobre estado ya liberado → memory leak + React warning.

**[MEDIO-01] Inyección JS en `refine_project_transcript`**
Línea 598 de `api.py` construye JS con un f-string que interpolita `msg` directamente, sin escape. Si `msg` contiene comillas simples o saltos de línea, el JS es inválido y puede crashear el WebView2 silenciosamente. Debería usar `self.emit()`.

**[MEDIO-02] Migración de DB por `ALTER TABLE` con try/except sin versionado**
`db.py::migrate()` usa 7 bloques `try: ALTER TABLE ... except: pass`. No hay versión de esquema. Si una migración falla silenciosamente por razón distinta a "column already exists", la DB queda en estado corrupto sin que el usuario lo sepa.

**[MEDIO-03] `open_folder` sin validación de path traversal**
`api.py::open_folder()` llama a `os.startfile(path)` con el path recibido desde el frontend sin verificar que esté dentro del proyecto raíz. Un path `../../Windows/System32` pasaría sin objeción.

**[MEDIO-04] `as any` en 5 puntos de la UI**
`useMediaPipeline.ts` (líneas 88, 663), `CandidatePanel.tsx` (línea 140), `StyleModal.tsx` (línea 432). Patrón de casteo permisivo generalizado que rompe type safety.

**[MEDIO-05] Props muertas en `WorkspaceHeader`**
`selectedCount`, `selectedCutCount`, `selectedCaptionsCount` y `setShowSettings` se reciben desde `App` pero no se usan en el JSX del componente — contribuyen innecesariamente a re-renders.

**[BAJO-01] `hookTypeOptions` declarado como array literal dentro del render**
En `CandidatePanel.tsx` línea ~182: array literal que se recrea en cada render. Debe ser constante fuera del componente.

**[BAJO-02] Defaults de Whisper/LLM duplicados en frontend y backend**
Los defaults (`large-v3-turbo`, `local`, etc.) están hardcodeados en `useAppSettings.ts` y en `api.py::environment_status()`. Si cambian en un lado, el otro queda desincronizado.

---

## 2. Alcance

### Archivos que se modificarán

**Backend:**
- `python_backend/db.py` — pool de conexión con `threading.local()`, WAL mode, versionado de migraciones, deduplicar `_infer_hook_type`
- `python_backend/llm.py` — unificar `expand_short_candidate` + `clamp_candidate_duration` en `normalize_candidate_duration`, retry/backoff, logging de JSON repair
- `python_backend/api.py` — fix `evaluate_js` injection → usar `self.emit()`, validación path traversal, llamar a `probe_media_cached`
- `python_backend/media.py` — exponer `probe_media_cached` (wrapper lru_cache)

**Frontend:**
- `src/hooks/useAppSettings.ts` — eliminar `enableThinking` del estado, `setEnableThinking` y su persistencia
- `src/hooks/useMediaPipeline.ts` — eliminar param `enableThinking`, añadir `useMemo` a contadores derivados, limpiar `setTimeout` con refs, `useCallback` en handlers críticos
- `src/App.tsx` — eliminar prop `enableThinking` del árbol, simplificar `settingsNode` si es posible
- `src/components/modals/SettingsPanel.tsx` — eliminar props `enableThinking`/`setEnableThinking` de interfaz, `window.confirm` → estado local
- `src/components/modals/StyleModal.tsx` — eliminar props `enableThinking`/`setEnableThinking` de interfaz
- `src/components/panels/CandidatePanel.tsx` — eliminar props `enableThinking`/`setEnableThinking`, memoizar filtros y sort, `hookTypeOptions` como constante, limpiar timers
- `src/components/panels/WorkspaceHeader.tsx` — eliminar props muertas `selectedCount`/`selectedCutCount`/`selectedCaptionsCount`/`setShowSettings`

**Nuevos archivos:**
- `scratch/test_plan28_unit.py` — tests unitarios del plan 28

---

## 3. Paso a paso técnico

### COMPROMISO PREVIO (antes de cualquier cambio)

```
git add -A
git commit -m "feat: plan 27 - antislop UI, clamp duracion, fix copy sin titular duplicado y limpieza thinking"
```

---

### Fase A — Backend (en orden)

#### A1. `db.py` — Pool de conexión SQLite + WAL mode

Reemplazar `get_conn()` para reutilizar la conexión por hilo usando `threading.local()`. Añadir `PRAGMA journal_mode = WAL` para evitar write lock en lecturas concurrentes (transcripción + UI leyendo candidatos simultáneamente).

```python
import threading

class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._local = threading.local()
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.migrate()

    def get_conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, 'conn', None)
        if conn is None:
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.execute("PRAGMA journal_mode = WAL;")
            self._local.conn = conn
        return conn
```

Compatibilidad: el patrón `with self.get_conn() as conn:` sigue funcionando — SQLite connection como context manager llama a `commit()` al salir o `rollback()` si hay excepción.

#### A2. `db.py` — Versionado de migraciones con tabla `schema_version`

Reemplazar los 7 bloques `try: ALTER TABLE ... except: pass` por una tabla `schema_version` y un array `MIGRATIONS` numerado. Solo se ejecutan las migraciones pendientes.

```python
MIGRATIONS = [
    (1, "ALTER TABLE candidates ADD COLUMN description TEXT;"),
    (2, "ALTER TABLE candidates ADD COLUMN hook_title TEXT;"),
    (3, "ALTER TABLE candidates ADD COLUMN virality_json TEXT;"),
    (4, "ALTER TABLE candidates ADD COLUMN dismissed INTEGER DEFAULT 0;"),
    (5, "ALTER TABLE projects ADD COLUMN project_dir TEXT;"),
    (6, "ALTER TABLE projects ADD COLUMN workflow_goal TEXT DEFAULT 'clips';"),
    (7, "UPDATE projects SET name = CASE WHEN (name IS NULL OR name = '') THEN source_path ELSE name END WHERE name IS NULL OR name = '';"),
]

def migrate(self):
    with self.get_conn() as conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        """)
        # ... crear tablas base ...
        current = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()[0] or 0
        for ver, sql in MIGRATIONS:
            if ver > current:
                try:
                    conn.execute(sql)
                    conn.execute("INSERT INTO schema_version VALUES (?, ?)", (ver, utc_now_iso()))
                    conn.commit()
                except Exception as e:
                    print(f"[DB] Migración v{ver} omitida: {e}")
```

#### A3. `db.py` — Eliminar `_infer_hook_type`, unificar en `llm_prompts.py`

Mover `classify_hook_type` a `python_backend/llm_prompts.py` (módulo sin imports de llm.py para evitar circular). Importarla desde `db.py` y `llm.py`. Eliminar `_infer_hook_type` de `db.py`.

#### A4. `llm.py` — `normalize_candidate_duration` (unifica expand + clamp)

```python
def normalize_candidate_duration(
    start: float,
    end: float,
    segments: Optional[List[Dict[str, Any]]],
    target_min: float,
    target_max: float
) -> Tuple[float, float]:
    """
    Single-pass normalization: expands short clips to target_min,
    then clamps overlong clips to target_max using speech boundaries.
    Replaces the sequential expand_short_candidate + clamp_candidate_duration calls.
    """
    dur = end - start
    if dur >= target_min and dur <= target_max * 1.10:
        return start, end  # already in range

    if not segments:
        new_end = start + max(target_min, min(dur, target_max))
        return start, round(new_end, 2)

    # Single pass over segments: track best expansion AND best clamp boundary
    target_ideal = (target_min + target_max) / 2.0
    best_expand_end = end
    best_clamp_end = start + target_max

    start_idx = next(
        (i for i, s in enumerate(segments)
         if s["start"] <= start <= s["end"] or abs(s["start"] - start) < 2.0),
        0
    )

    for s in segments[start_idx:]:
        s_end = float(s.get("end", 0.0))
        if s_end <= start:
            continue
        seg_dur = s_end - start
        if seg_dur >= target_min and seg_dur <= target_max:
            best_clamp_end = s_end  # última válida dentro del rango
        if seg_dur >= target_ideal and dur < target_min:
            best_expand_end = s_end
            break
        if seg_dur > target_max:
            break

    if dur < target_min:
        new_end = max(best_expand_end, start + target_min)
        return start, round(min(new_end, start + target_max), 2)

    # dur > target_max * 1.10
    return start, round(best_clamp_end, 2)
```

Mantener `expand_short_candidate` y `clamp_candidate_duration` como wrappers de `normalize_candidate_duration` por retrocompatibilidad, deprecándolas con un comentario. Actualizar `parse_candidate_json` para usar `normalize_candidate_duration` directamente.

#### A5. `llm.py` — Retry con backoff exponencial

```python
def _call_with_retry(fn, max_retries: int = 2, base_delay: float = 5.0):
    """Retry LLM HTTP calls with exponential backoff on transient errors."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            if attempt >= max_retries:
                raise
            delay = base_delay * (2 ** attempt)
            log_buffer.push(
                f"[LLM] Timeout/conexión (intento {attempt + 1}/{max_retries + 1}). "
                f"Reintentando en {delay:.0f}s..."
            )
            time.sleep(delay)
```

Envolver `requests.post(url, ...)` en `call_ollama` y `call_lmstudio` con esta función.

#### A6. `llm.py` — Logging de calidad en `parse_candidate_json`

Registrar en `log_buffer` cuando el primer intento falla y cuál intento tuvo éxito:

```python
# Dentro de parse_candidate_json, antes del bloque de 5 intentos:
_parse_attempt = 0

# Al final, antes del return:
if _parse_attempt > 0:
    log_buffer.push(f"[LLM] JSON recuperado en intento {_parse_attempt + 1}/5. Revisa la calidad del modelo.")
```

#### A7. `api.py` — Fix inyección JS en `refine_project_transcript`

```python
# ANTES (vulnerable):
self._window.evaluate_js(
    f"window.__emitEvent && window.__emitEvent('candidate-progress', "
    f"{{ message: '{msg}', current: {cur}, total: {tot} }})"
)

# DESPUÉS (seguro):
self.emit("candidate-progress", {"message": msg, "current": cur, "total": tot})
```

#### A8. `api.py` — Validación de path traversal

```python
def _validate_safe_path(self, requested_path: str) -> Path:
    """Verifica que el path esté dentro del directorio de datos o del home del usuario."""
    p = Path(requested_path).resolve()
    allowed_roots = [self.data_dir.resolve(), Path.home().resolve()]
    if not any(str(p).startswith(str(root)) for root in allowed_roots):
        raise PermissionError(f"Acceso denegado: la ruta está fuera del área de trabajo permitida.")
    return p
```

Aplicar en `open_folder` y en la parte de destino de `move_project_folder_action`.

#### A9. `media.py` — `probe_media_cached`

```python
from functools import lru_cache

@lru_cache(maxsize=64)
def probe_media_cached(path: str) -> dict:
    """Cached wrapper for probe_media — avoids repeated ffprobe subprocess per session."""
    return probe_media(path)
```

Actualizar los 3+ puntos de `api.py` que llaman a `probe_media()` directamente para usar `probe_media_cached()`.

---

### Fase B — Frontend: eliminar enableThinking del árbol (B1–B5)

#### B1. `src/hooks/useAppSettings.ts`

Eliminar:
- El estado `const [enableThinking, setEnableThinking] = useState(...)` y su key de localStorage
- Su inclusión en `syncConfig` y en el objeto de retorno del hook

#### B2. `src/App.tsx`

Eliminar:
- Prop `enableThinking={settings.enableThinking}` pasada a `useMediaPipeline`
- Props `enableThinking={settings.enableThinking}` y `setEnableThinking={settings.setEnableThinking}` pasadas a `SettingsPanel` / `ModalContainer`

#### B3. `src/hooks/useMediaPipeline.ts`

Eliminar:
- El parámetro `enableThinking` del tipo de input del hook
- Todas las referencias donde se pasa `enableThinking` a `invoke()`
- Añadir `useMemo` en `selectedCount`, `selectedCutCount`, `selectedCaptionsCount`
- Limpiar `setTimeout` usando `useRef<ReturnType<typeof setTimeout> | null>`
- Reemplazar `catch (err: any)` por `catch (err: unknown)`

```typescript
const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// En cancelTranscription:
if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current);
cancelTimerRef.current = setTimeout(() => {
  setBusy("idle");
  // ...
}, 400);
```

#### B4. `src/components/panels/CandidatePanel.tsx`

Eliminar:
- Props `enableThinking` y `setEnableThinking` de la interfaz y de la desestructuración
- Mover `hookTypeOptions` como constante `const HOOK_TYPE_OPTIONS = [...]` fuera del componente
- Añadir `useMemo` a `dismissedCandidates`, `exportedCandidates`, `pendingCandidates`, `activeCandidates`, `displayedCandidates`
- Limpiar timers de `handleCopyPath` / `handleCopyHook` con `useRef`

#### B5. `src/components/modals/StyleModal.tsx` y `SettingsPanel.tsx`

Eliminar de ambos:
- Props `enableThinking` y `setEnableThinking` de la interfaz TypeScript
- Su desestructuración
- El `window.confirm` de `SettingsPanel` → reemplazar por un estado local `showResetConfirm` que renderice un pequeño bloque de confirmación inline

#### B6. `src/components/panels/WorkspaceHeader.tsx`

Eliminar de la interfaz y del JSX:
- Props `selectedCount`, `selectedCutCount`, `selectedCaptionsCount` (no se usan en este componente)
- Prop `setShowSettings` (no se usa en este componente)

---

## 4. Riesgos e implicaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Cambio en `get_conn()` rompe transacciones existentes | Baja | `threading.local` es compatible con `with self.get_conn() as conn:` — SQLite connection como context manager sigue funcionando igual |
| `normalize_candidate_duration` cambia comportamiento de duración | Baja | Tests unitarios comparan entrada/salida contra las 2 funciones originales con los mismos fixtures |
| Eliminar `enableThinking` del árbol rompe TypeScript | Media | TypeScript detecta props no existentes en compile time — el build fallará limpiamente si falta algún sitio |
| `probe_media_cached` con `lru_cache` retorna dict mutable compartido | Baja | El caller no debería mutar el resultado. Documentar en docstring |
| Retry backoff añade latencia en errores genuinos | Baja | Solo se activa en Timeout/ConnectionError, no en 4xx/5xx del LLM |
| `useMemo` en `CandidatePanel` puede perder referencia si las deps son inestables | Baja | Las deps son `detail.candidates` y `sortBy` / `typeFilter` — estables entre renders normales |

---

## 5. Estrategia de testing

### 5.1 Tests unitarios — `scratch/test_plan28_unit.py`

```
test_01_normalize_candidate_expand()         — clip corto se expande al target_min
test_02_normalize_candidate_clamp()          — clip largo se recorta al target_max
test_03_normalize_candidate_passthrough()    — clip en rango no se toca
test_04_normalize_vs_original_expand()       — resultado igual que expand_short_candidate original
test_05_normalize_vs_original_clamp()        — resultado igual que clamp_candidate_duration original
test_06_db_migration_version_table_created() — migrate() crea tabla schema_version
test_07_db_migration_idempotent()            — migrate() dos veces no duplica columnas
test_08_db_migration_versions_recorded()     — todas las 7 migraciones quedan en schema_version
test_09_probe_cache_returns_same_obj()        — cache retorna mismo resultado para mismo path
test_10_classify_hook_type_canonical()        — 7 tipos, 7 keywords, 7 resultados correctos
test_11_path_traversal_blocked()              — _validate_safe_path rechaza path fuera del home
test_12_retry_backoff_calls_fn_twice()        — _call_with_retry reintenta ante requests.Timeout
```

### 5.2 Tests de integración — `tests/`

- `test_db_connection_pool.py` — crea 3 hilos que escriben simultáneamente, verifica no-deadlock con WAL mode
- `test_llm_pipeline_clamp.py` — pipeline completo con transcript sintético, verifica que ningún candidato supera `target_max * 1.1`

### 5.3 Test E2E (manual)

1. Importar video real → transcribir → buscar momentos → verificar que todos los clips tienen duración dentro del rango esperado
2. Con Ollama/LM Studio apagado → importar → buscar momentos → verificar que el retry muestra logs de reintento, no crash silencioso
3. Importar mismo video dos veces → verificar que `probe_media_cached` solo lanza ffprobe 1 vez (observable por count de logs de ffprobe)
4. `pnpm run build` → 0 errores TypeScript (el build es el E2E del árbol de tipos)

### 5.4 Gate de cierre

- `python scratch/run_all_tests.py` → ≥35 PASSED, 0 FAILED
- `pnpm run build` → 0 errores TS
- `python build_portable.py` → build exitoso
- Sync a `C:\Users\JEFF\Desktop\AutoShorts - Portable`

---

## 6. Compromisos previos a ejecutar

Antes de cualquier edición del plan 28, se debe commitear el plan 27:

```
git add -A
git commit -m "feat: plan 27 - antislop UI, clamp duracion, fix copy sin titular duplicado y limpieza thinking"
```

---

## 7. Decisión a registrar en DECISIONS.md

**D-029:** SQLite usa `threading.local()` para reutilizar conexiones por hilo + WAL mode. Las migraciones pasan a versionado explícito con tabla `schema_version`. `enableThinking` eliminado del árbol completo frontend/backend. `normalize_candidate_duration` reemplaza `expand_short_candidate + clamp_candidate_duration`. Retry/backoff en LLM calls (max 2 reintentos, backoff 5s/10s). `probe_media_cached` evita subprocesos ffprobe repetidos. Fix inyección JS en WebView2. Validación de path traversal en `open_folder`.

