# Plan 30: Fix Definitivo de Terminal en Ejecutable Portable e Integración Profesional de OpenRouter (Free / Paid)

## 1. Diagnóstico

### A. Diagnóstico de la Terminal al Abrir el Portable (`AutoShorts.exe`)
1. **Causa Raíz en la Cabecera PE (Portable Executable):**
   - En Windows, cada ejecutable `.exe` tiene en su cabecera `IMAGE_OPTIONAL_HEADER` el campo `Subsystem`.
   - `Subsystem: 2` corresponde a `IMAGE_SUBSYSTEM_WINDOWS_GUI` (aplicación de ventana pura; el kernel de Windows **no** abre ventana de consola).
   - `Subsystem: 3` corresponde a `IMAGE_SUBSYSTEM_WINDOWS_CUI` (aplicación de consola de comandos; el kernel de Windows abre automáticamente una ventana CMD obligatoria al iniciar el proceso).
2. **Origen de la Desviación en el Plan 29:**
   - Durante la resolución de la compilación portable en el Plan 29, el archivo `runw.exe` en `PyInstaller/bootloader/Windows-64bit-intel` no estaba presente (eliminado comúnmente por Windows Defender como falso positivo).
   - Para desbloquear la compilación, se copió `run.exe` como `runw.exe`.
   - Dado que `run.exe` es un bootloader de consola (`Subsystem: 3`), PyInstaller empaquetó `AutoShorts.exe` con `Subsystem: 3`, a pesar de tener `console=False` en `AutoShorts.spec`.
   - Verificación directa con `pefile`: `dist/AutoShorts/AutoShorts.exe Subsystem: 3`.
3. **Solución Técnica Definitiva:**
   - Restaurar el bootloader GUI de PyInstaller (`runw.exe` con `Subsystem: 2`, derivado de `runw_d.exe` o parcheado en su encabezado PE).
   - Incorporar en `build_portable.py` una rutina de post-procesamiento (`ensure_gui_subsystem`) ejecutada estrictamente en el **Paso 2.5** (inmediatamente después de `pyinstaller` y **antes** de comprimir el paquete `.tar.gz` o generar `portable.mode`).
   - Evitar bloqueos de archivo en Windows (`[WinError 32]`) cerrando el objeto `pefile` antes de reemplazar o modificando in-place los 2 bytes del subsistema en offset exacto (`r+b`) y recalculando el checksum opcional.

---

### B. Diagnóstico y Arquitectura para la Integración de OpenRouter
1. **Requerimiento del Usuario:**
   - Disponer de un tercer motor de IA ("OpenRouter") además de Ollama y LM Studio.
   - Poder configurar en la UI (`SettingsPanel.tsx`) la API Key (`sk-or-v1-...`) y el modelo deseado (ej. `openrouter/free` u otros modelos).
   - Opción explícita para conmutar entre **Modelo Free** (gratuito, limitado por OpenRouter a 50 peticiones/día y sujeto a rate limits por minuto y mayor latencia de respuesta) y **Modelo de Pago** (sin dichas restricciones de cuota).
   - Búsqueda de momentos inteligente sin saturar la cuota diaria del modelo Free.
   - Elección óptima de ventana de contexto: **16k tokens** (vs 8k).
2. **Estrategia Anti-Saturación de Cuota (Macro-Chunks para Modelos Free):**
   - Si se enviaran fragmentos pequeños de 1 a 2 minutos a la API, un video de 30 a 45 minutos requeriría entre 20 y 35 llamadas consecutivas, consumiendo el 70% de la cuota diaria de 50 peticiones en una sola sesión.
   - **Solución con 16k tokens:** Utilizar la arquitectura de macro-compactación (`macro_compact_segments`). Al alimentar bloques temporales de 15 a 20 minutos de grabación por llamada (`chunk_dur = 900.0s`), un video completo de 30-40 minutos consume **únicamente de 2 a 3 llamadas a la API en total**.
   - Con esta optimización, el usuario puede procesar hasta 15-20 grabaciones completas al día dentro de su cuota gratuita de 50 peticiones.
   - En `_analyze_chunk_adaptively`, cuando `provider == "openrouter"` e `is_free=True`, forzar `macro_compact_segments(chunk, block_sec=30.0, max_words_per_block=25)` para que cada macro-bloque ocupe entre 600 y 900 tokens, eliminando cualquier riesgo de bisección o desborde de contexto.
3. **Gestión de Latencia, Rate Limits y Circuit Breaker en `call_openrouter`:**
   - **Endpoint y Headers:** `https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer <key>`, `HTTP-Referer: https://autoshorts.local`, `X-Title: AutoShorts`.
   - **Timeout:** 120 segundos para tolerar colas de espera en modelos gratuitos.
   - **Delay entre bloques:** En modo Free, pausar 2.5s a 3.0s entre chunks analizados para respetar el rate limit de ráfaga por minuto.
   - **Tratamiento Diferenciado de Errores:**
     - `401 Unauthorized`: Lanzar `ModelFatalError("API Key de OpenRouter inválida o no configurada")` para activar el Circuit Breaker de inmediato y no reintentar en bucle.
     - `402 Payment Required`: Lanzar `ModelFatalError("Créditos insuficientes en tu cuenta de OpenRouter")`.
     - `429 Rate Limit Transitorio`: Reintentar hasta 2 veces con backoff exponencial (3s, 6s).
     - `429 Cuota Diaria Agotada ("daily limit" / "free model limit" / "quota")`: **PROHIBIDO reintentar**. Lanzar `ModelFatalError("Límite diario de 50 peticiones de OpenRouter Free alcanzado. Prueba mañana o utiliza Ollama/LM Studio local.")`.
     - `Sin conexión (ConnectionError, Timeout)`: Lanzar `ModelFatalError("Sin conexión a internet: No se pudo conectar a OpenRouter. Verifica tu conexión o utiliza un motor local.")`.
   - **Compatibilidad con Modelos de Razonamiento (CoT / Thinking en OpenRouter):** Saneamiento de `<think>...</think>` y extracción de texto desde `message["content"]` o `message["reasoning"]` / `reasoning_content` (para modelos como DeepSeek-R1 o QwQ en OpenRouter).
4. **Soporte Completo en Social Copy y Perfeccionar Transcripción:**
   - `generate_social_copy_with_llm`, `regenerate_social_copy`, `generate_quick_copy` y `refine_transcript_with_llm` deben admitir `provider == "openrouter"`, propagando `api_key` y el modelo configurado.
5. **Cumplimiento de Skills del Workspace:**
   - `senior-code-craft`: Desacoplamiento limpio, propagación estricta de parámetros en React y Python, tipado riguroso, pruebas automatizadas con mocks para no gastar cuota real.
   - `antislop` y `antislop-ui`: Selector de 3 motores (`repeat(3, 1fr)`) en `SettingsPanel.tsx`, input de API Key con toggle de visibilidad (icono `Eye` / `EyeOff` de `lucide-react`), sin emojis decorativos y con feedback claro.

---

## 2. Alcance de Modificaciones

### Backend (Python):
1. `build_portable.py`:
   - Restaurar bootloader `runw.exe` a Subsystem 2 en el entorno de PyInstaller.
   - Incorporar función `ensure_gui_subsystem(exe_path)` en el **Paso 2.5** (antes de comprimir en `.tar.gz`) que garantice `Subsystem = 2` y recalcule el checksum PE con manejo seguro contra `WinError 32`.
2. `python_backend/llm.py`:
   - Implementar `call_openrouter(...)` con headers obligatorios, circuit breaker para errores 401/402/429-cuota, reintentos con backoff para 429-ráfaga, y soporte de reasoning/thinking.
   - Extender la firma de `_analyze_chunk_adaptively` para recibir `api_key: Optional[str] = None, is_free: bool = True` y propagarlos en ambas llamadas recursivas de bisección.
   - Actualizar `get_available_context_size` para retornar `context_size or 16384` cuando `provider == "openrouter"`.
   - Actualizar `detect_candidates_pipeline` para recibir `is_free: bool = False, context_size: Optional[int] = None`. En OpenRouter Free, fijar `chunk_dur = 900.0` (15m), overlap = 60s, delay de 2.5s entre bloques y forzar `macro_compact_segments`.
   - Añadir la rama `elif provider == "openrouter":` en `generate_social_copy_with_llm` y `refine_transcript_with_llm`.
3. `python_backend/api.py`:
   - En `generate_candidates`: extraer `isFree = bool(args.get("isFree", True))` y `contextSize = int(args.get("contextSize", 16384))` y propagarlos a `detect_candidates_pipeline`.
   - En `generate_copy`, `generate_quick_copy` y `regenerate_candidate_copy`: permitir `provider == "openrouter"` y propagar `api_key`.

### Frontend (React / TypeScript):
4. `src/types.ts`:
   - Actualizar `export type LlmEngine = "local" | "ollama" | "lmstudio" | "openrouter";`.
5. `src/hooks/useAppSettings.ts`:
   - Estados persistidos en `localStorage`:
     - `openRouterKey` (`autoshorts_openrouter_key`)
     - `openRouterModel` (`autoshorts_openrouter_model`, default: `"openrouter/free"`)
     - `openRouterIsFree` (`autoshorts_openrouter_is_free`, default: `true`)
     - `openRouterContextSize` (`autoshorts_openrouter_context_size`, default: `16384`)
   - Corregir `canUseActiveLlm`:
     ```ts
     const canUseActiveLlm =
       llmEngine === "local"
         ? Boolean(environment?.hasOllama)
         : llmEngine === "lmstudio"
         ? canUseLmStudio
         : llmEngine === "openrouter"
         ? Boolean(openRouterKey && openRouterKey.trim().length > 0)
         : false;
     ```
   - Exponer getters, setters y retorno en el hook.
6. `src/hooks/useMediaPipeline.ts`:
   - Extender la interfaz `UseMediaPipelineOptions` para aceptar `openRouterKey`, `openRouterModel`, `openRouterIsFree`, `openRouterContextSize`.
   - Actualizar `getActiveLlmConfig()`: si `llmEngine === "openrouter"`, devolver `{ activeLlmKey: openRouterKey, activeLlmModel: openRouterModel }`.
   - En `autoDetectMoments`: si `llmEngine === "openrouter"`, validar que exista `openRouterKey` (si no, emitir error en UI). Pasar `isFree: openRouterIsFree` y `contextSize: openRouterContextSize` al invocar `generate_candidates`.
7. `src/App.tsx`:
   - Extraer los 4 valores de OpenRouter desde `useAppSettings` y pasarlos a `useMediaPipeline` y `ModalContainer`.
8. `src/components/modals/ModalContainer.tsx`:
   - Extender `ModalContainerProps` para propagar los valores de OpenRouter a `SettingsPanel`, `StyleModal` y `QuickCopyModal`.
9. `src/components/modals/SettingsPanel.tsx`:
   - Grid del selector de motores en `repeat(3, 1fr)`: Ollama, LM Studio, OpenRouter.
   - Panel de OpenRouter:
     - Input de API Key con toggle de visibilidad (icono `Eye`/`EyeOff`).
     - Input de Modelo con presets (`openrouter/free`, `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`, `deepseek/deepseek-chat`).
     - Selector de Plan: Free (límite 50 req/día con macro-chunks) vs Pago (sin restricciones).
     - Selector de Context Window: 16k (Recomendado) vs 8k.
     - Badge de estado: "Configurado" o "Falta API Key".
10. `src/components/modals/StyleModal.tsx`:
    - Dropdown de Motor de IA con opción "OpenRouter (Cloud API)".
    - Muestra del modelo activo y badge informativo (Free/Pago).
11. `src/components/modals/QuickCopyModal.tsx`:
    - Propagar `openRouterKey` y `openRouterModel` al generar copy rápido con OpenRouter.

### Tests:
12. `scratch/test_plan30_unit.py`:
    - Tests unitarios completos con `unittest.mock.patch("requests.post")` para no gastar cuota real.
    - Test de verificación de cabecera PE `Subsystem == 2`.
    - Test de macro-compactación de 15m ($\le 3$ chunks para 30m de stream).
    - Test de circuit breaker ante 401, 402, 429-cuota, y reintentos ante 429-ráfaga.

---

## 3. Paso a Paso Técnico

### Paso 1: Fix del Bootloader y Post-Procesamiento PE en `build_portable.py`
- En el directorio de PyInstaller, asegurar que `runw.exe` tenga `Subsystem: 2`.
- En `build_portable.py`, agregar la función `ensure_gui_subsystem(exe_path)` e invocarla estrictamente en el **Paso 2.5** (antes de crear `portable.mode` y el `.tar.gz`):
  ```python
  def ensure_gui_subsystem(exe_path: Path):
      import pefile
      print(f"[*] Verificando cabecera PE en {exe_path.name}...")
      pe = pefile.PE(str(exe_path))
      if pe.OPTIONAL_HEADER.Subsystem != 2:
          print(f"[*] Ajustando Subsystem PE de {pe.OPTIONAL_HEADER.Subsystem} a 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)...")
          pe.OPTIONAL_HEADER.Subsystem = 2
          pe.OPTIONAL_HEADER.CheckSum = pe.generate_checksum()
          pe.close()
          # Escribir de forma segura sin bloqueo WinError 32
          with open(exe_path, "r+b") as f:
              # Offset exacto del campo Subsystem en la cabecera opcional
              pe_offset = pe.DOS_HEADER.e_lfanew
              opt_offset = pe_offset + 4 + 20  # Signature (4) + FileHeader (20)
              subsystem_offset = opt_offset + 68  # Offset de Subsystem en PE32+ (64-bit)
              f.seek(subsystem_offset)
              f.write((2).to_bytes(2, byteorder="little"))
      else:
          pe.close()
          print("    Cabecera PE ya es Subsystem 2 (GUI pura).")
  ```

### Paso 2: Backend — Implementación de OpenRouter en `python_backend/llm.py`
- Implementar `call_openrouter`:
  - Validar `api_key`.
  - Construir headers (`Authorization: Bearer <key>`, `HTTP-Referer: https://autoshorts.local`, `X-Title: AutoShorts`).
  - Timeout 120s.
  - Saneamiento de tags `<think>` y soporte para `choice["message"]["reasoning"]`.
  - Circuit Breaker ante 401, 402, 429 de cuota agotada; reintentos con backoff ante 429 de ráfaga; captura de offline a `ModelFatalError`.
- Extender `_analyze_chunk_adaptively(..., api_key=None, is_free=True)` y propagar a las llamadas recursivas.
- En `detect_candidates_pipeline`:
  - Recibir `is_free=False, context_size=None`.
  - Si `provider == "openrouter"` e `is_free=True`: `chunk_dur = 900.0`, pausa de 2.5s entre chunks y forzar `macro_compact_segments`.
- En `generate_social_copy_with_llm` y `refine_transcript_with_llm`:
  - Añadir rama `elif provider == "openrouter":` con la llamada a OpenRouter.

### Paso 3: Backend — Propagación en `python_backend/api.py`
- En `generate_candidates`: extraer `isFree` y `contextSize` de `args` y enviarlos a `detect_candidates_pipeline`.
- En `generate_copy`, `generate_quick_copy` y `regenerate_candidate_copy`: permitir `provider == "openrouter"` y propagar `api_key`.

### Paso 4: Frontend — Tipos, useAppSettings y useMediaPipeline
- En `src/types.ts`: actualizar `LlmEngine`.
- En `src/hooks/useAppSettings.ts`:
  - Declarar `openRouterKey`, `openRouterModel`, `openRouterIsFree`, `openRouterContextSize` con persistencia `localStorage`.
  - Corregir `canUseActiveLlm` para admitir `openrouter` cuando haya API Key.
- En `src/hooks/useMediaPipeline.ts`:
  - Aceptar los 4 props de OpenRouter en `UseMediaPipelineOptions`.
  - En `getActiveLlmConfig()`: mapear `openrouter` a `{ activeLlmKey: openRouterKey, activeLlmModel: openRouterModel }`.
  - En `autoDetectMoments`: validar presencia de API Key antes de invocar `generate_candidates` y pasar `isFree` y `contextSize`.
- En `src/App.tsx`: propagar props de OpenRouter hacia `useMediaPipeline` y `ModalContainer`.
- En `src/components/modals/ModalContainer.tsx`: actualizar props hacia `SettingsPanel`, `StyleModal` y `QuickCopyModal`.

### Paso 5: Frontend — Componentes UI (`SettingsPanel`, `StyleModal`, `QuickCopyModal`)
- En `SettingsPanel.tsx`:
  - Selector de 3 motores (`repeat(3, 1fr)`).
  - Tarjeta de OpenRouter con input de clave con toggle de visibilidad (icono `Eye`/`EyeOff`), selector de modelo con presets, toggle Free vs Pago, y selector de contexto (16k vs 8k).
- En `StyleModal.tsx`:
  - Opción OpenRouter en el dropdown de Motor de IA.
- En `QuickCopyModal.tsx`:
  - Soportar OpenRouter pasando la clave configurada.

### Paso 6: Tests Automatizados y Compilación
- Crear y ejecutar `scratch/test_plan30_unit.py`.
- Correr la suite completa `scratch/run_all_tests.py` y verificar que los 37 tests existentes + los nuevos tests pasen al 100%.
- Ejecutar `python build_portable.py` y confirmar con `pefile` que `dist/AutoShorts/AutoShorts.exe` tiene `Subsystem: 2`.
- Registrar formalmente la decisión `D-031` en `DECISIONS.md`.

---

## 4. Riesgos y Mitigaciones Auditadas por los Goldfish

1. **Riesgo de Bloqueo del Botón "Buscar Momentos" en OpenRouter:**
   - *Mitigación:* Se audita y corrige `canUseActiveLlm` en `useAppSettings.ts` para que dependa exclusivamente de la presencia de `openRouterKey` cuando `llmEngine === "openrouter"`, eliminando el bloqueo indebido por LM Studio.
2. **Riesgo de Pérdida de Clave o Parámetros en Hooks:**
   - *Mitigación:* Se audita la propagación completa a través de `UseMediaPipelineOptions`, `App.tsx` y `ModalContainer.tsx`, garantizando que `getActiveLlmConfig` retorne la clave real configurada.
3. **Riesgo de Saturación de Cuota en OpenRouter Free (50 peticiones/día):**
   - *Mitigación:* `chunk_dur = 900.0s` (15 min) y `macro_compact_segments` forzado garantizan que un stream de 30-45 minutos se resuelva en únicamente 2 a 3 peticiones en total.
4. **Riesgo de WinError 32 en Windows al Parchear el Ejecutable:**
   - *Mitigación:* Escritura de 2 bytes in-place cerrando previamente el descriptor de `pefile`.
5. **Riesgo de Reintentos Infinitos ante Límite Diario Agotado:**
   - *Mitigación:* Detección de error de cuota diaria en el cuerpo de la respuesta HTTP 429 para abortar de inmediato con `ModelFatalError` sin gastar tiempo en reintentos.

---

## 5. Estrategia de Testing

1. **Tests Unitarios (`scratch/test_plan30_unit.py`):**
   - Test 1: Petición a OpenRouter con headers requeridos (`HTTP-Referer`, `X-Title`, `Authorization: Bearer`) usando mock.
   - Test 2: Circuit Breaker ante 401 Unauthorized y 402 Payment Required -> `ModelFatalError`.
   - Test 3: Circuit Breaker ante 429 Quota Diaria ("daily limit") sin reintentos.
   - Test 4: Reintento con backoff exponencial ante 429 de ráfaga y éxito en reintento.
   - Test 5: Saneamiento de `<think>...</think>` y extracción de reasoning en respuestas.
   - Test 6: Verificación matemática de macro-compactación ($\le 3$ chunks para 30 minutos de transcripción en modo Free).
   - Test 7: Verificación de cabecera PE `Subsystem == 2` en el binario generado.
2. **Tests de Integración:**
   - Generación de Social Copy con OpenRouter (mockeado).
   - Pipeline de candidatos con OpenRouter (mockeado).
3. **Ejecución de Suite Completa:**
   - Correr `scratch/run_all_tests.py` para asegurar que las 37 pruebas existentes continúen 100% en verde.
