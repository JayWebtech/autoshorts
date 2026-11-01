# Plan 17: Auto-Carga en LM Studio para Contexto Dinámico Real y Diagnóstico/Feedback en Exportación de Video

## 1. Diagnóstico

### Problema 1: Detección de Ventana de Contexto en LM Studio cuando el modelo está descargado
- **Causa Raíz:** En `python_backend/llm.py` (`detect_candidates_pipeline`), la función `get_available_context_size` realiza una petición `GET http://localhost:1234/api/v0/models`. Si el usuario no activó previamente el botón de "Modo Ráfaga", el modelo se encuentra en estado `"state": "not-loaded"`. En ese estado, LM Studio no devuelve el campo `loaded_context_length`.
- **Efecto:** AutoShorts asume por defecto `8192` tokens. En consecuencia, el pipeline divide el stream en bloques de 5 minutos en lugar de bloques de 10-15 minutos (que es lo que permite el contexto real de 16.384 tokens configurado por el usuario). Solo cuando el usuario enciende Modo Ráfaga y el modelo se carga en VRAM/RAM, `get_available_context_size` lee `16384`. Además, si la primera petición de inferencia tarda mucho mientras LM Studio carga el modelo desde cero, se corre el riesgo de disparar el circuit breaker por timeout.
- **Solución requerida:** En `detect_candidates_pipeline`, antes de consultar `get_available_context_size`, si el proveedor es LM Studio, AutoShorts debe verificar si el modelo ya está cargado en memoria; si no lo está, debe invocar la carga (`preload_local_model`), esperar confirmación de que `"state": "loaded"`, y recién entonces leer `loaded_context_length`.

### Problema 2: Falta de Feedback Visual y Logs durante la Exportación de Clips (FFmpeg)
- **Causa Raíz:** 
  1. En `src/components/modals/CandidatePreviewModal.tsx`, al pulsar el botón "Cortar y Exportar Clip", se ejecuta `onClose()` de forma **inmediata** antes de que termine `onCutCandidate(...)`.
  2. En `python_backend/media.py` (`render_flat_clip`) y en `python_backend/api.py` (`render_flat_clip_for_candidate`), no se emitía ningún mensaje a `log_buffer.push(...)`.
  3. Los archivos livianos (`.srt`, `.ass`, `_cta.png`) se generan en milisegundos en el directorio `clips/`, mientras que la codificación FFmpeg del video 1080x1920 con filtros y libass toma entre 15 y 30 segundos.
- **Efecto:** Al desaparecer el modal instantáneamente y permanecer el modal de Terminal/Logs en absoluto silencio, el usuario ve que se crearon el `.srt`, `.ass` y `.png` pero no el `.mp4`, asumiendo que la exportación falló o no generó el video.
- **Solución requerida:** 
  1. En `CandidatePreviewModal.tsx`, mantener el modal abierto mientras se exporta, mostrar un spinner de progreso ("Exportando clip con FFmpeg...") y deshabilitar botones para evitar clics duplicados; cerrar solo tras la confirmación exitosa o mostrar error en pantalla si falla.
  2. En `python_backend/media.py` y `python_backend/api.py`, canalizar logs detallados en tiempo real a `log_buffer` (inicio de render, parámetros de codificación CRF 19 / VBV 10M, filtros aplicados, resultado final y tamaño del archivo generado o stderr detallado en caso de error).
  3. Asegurar que las rutas con caracteres especiales (acentos, signos de interrogación/exclamación) no generen conflictos con el filtro `ass` de libass en Windows.

---

## 2. Alcance

### Archivos a Modificar:
1. `python_backend/llm.py`:
   - Enriquecer `preload_local_model` y `get_available_context_size` para soportar espera/polling activo de carga en LM Studio.
   - En `detect_candidates_pipeline`, asegurar que el modelo esté cargado en LM Studio antes de calcular el tamaño de los chunks adaptativos.
2. `python_backend/media.py`:
   - Añadir logs a `log_buffer` en cada etapa de `render_flat_clip` (inicio, comando, tiempo estimado, finalización con peso del archivo y tasa de bits, o reporte detallado de errores en `res.stderr`).
3. `python_backend/api.py`:
   - Añadir logs informativos en `render_flat_clip_for_candidate`.
   - Sanitizar nombres de archivo para evitar fallos de escape en libass cuando contengan caracteres como `¡` o `¿`.
4. `src/components/modals/CandidatePreviewModal.tsx`:
   - Añadir estado local `isExporting` y mensaje de feedback con spinner de carga durante el proceso de exportación del clip.
   - Bloquear el botón "Cortar y Exportar Clip" y el botón "Descartar" mientras `isExporting === true`.
   - Cerrar el modal automáticamente al terminar exitosamente o mostrar el mensaje de error si ocurre una excepción.

### Archivos de Test a Crear:
1. `scratch/test_lmstudio_auto_preload_unit.py`: Test unitario que valida que `detect_candidates_pipeline` precarga el modelo en LM Studio y obtiene el contexto de 16k antes de fragmentar en chunks.
2. `scratch/test_video_export_logging_integration.py`: Test de integración que valida que `render_flat_clip` y `render_flat_clip_for_candidate` envían eventos de log a `log_buffer` y generan el archivo `.mp4` correctamente.
3. `scratch/test_export_pipeline_e2e.py`: Test End-to-End del flujo completo de exportación con subtítulos ASS y badge CTA animado sobre archivo de video real.

---

## 3. Paso a Paso Técnico

### Paso 1: LM Studio Auto-Preload en el Pipeline de Detección (`python_backend/llm.py`)
- En `python_backend/llm.py`:
  - Implementar en `ensure_model_loaded(provider, model_name, lmstudio_base_url)`:
    - Consulta `GET /api/v0/models`. Si el modelo ya tiene `"state": "loaded"`, retorna inmediatamente.
    - Si no está cargado, emite log `log_buffer.push(f"[LM Studio] Cargando modelo '{model_name}' en memoria...")` e inicia la carga mediante POST a `/chat/completions` con `max_tokens: 1`.
    - Realiza polling (hasta 30 segundos) verificando que el modelo pase a `"state": "loaded"`.
  - En `detect_candidates_pipeline`:
    - Antes de llamar a `get_available_context_size`, invocar `ensure_model_loaded(provider=provider, model_name=model_name)`.
    - Consultar `get_available_context_size`, registrando en `log_buffer`: `[LM Studio] Modelo en memoria listo. Contexto detectado: {available_ctx} tokens.`
    - Calcular el tamaño de los chunks con la ventana de contexto real de 16k.

### Paso 2: Instrumentación de Logs en la Exportación (`python_backend/media.py` y `api.py`)
- En `python_backend/media.py` (`render_flat_clip`):
  - Al iniciar: `log_buffer.push(f"[FFmpeg] Iniciando renderizado de clip: '{output_path.name}' ({dur_sec:.1f}s)...")`.
  - En la selección de códec: `log_buffer.push(f"[FFmpeg] Configuración de salida: libx264, CRF 19, VBV maxrate 10M, AAC 192k (TikTok Ready)...")`.
  - Al concluir `subprocess.run`:
    - Si `returncode == 0`: calcular tamaño en MB y emitir `log_buffer.push(f"[FFmpeg] Clip renderizado exitosamente: {output_path.name} ({size_mb:.2f} MB).")`.
    - Si `returncode != 0`: emitir `log_buffer.push(f"[FFmpeg ERROR] Error en renderizado: {res.stderr.strip()[:400]}")`.
- En `python_backend/api.py`:
  - En `render_flat_clip_for_candidate`: emitir logs sobre la generación de subtítulos ASS y badge CTA animado.

### Paso 3: Feedback Visual y Manejo de Estado en `CandidatePreviewModal.tsx`
- En `src/components/modals/CandidatePreviewModal.tsx`:
  - Definir `const [isExporting, setIsExporting] = useState(false);` y `const [exportError, setExportError] = useState<string | null>(null);`.
  - En el botón "Cortar y Exportar Clip":
    - Establecer `setIsExporting(true); setExportError(null);`.
    - Ejecutar `await onCutCandidate(...)`.
    - Al resolver exitosamente: llamar `onClose()`.
    - En caso de error: capturar la excepción, guardarla en `exportError` y restaurar `setIsExporting(false)` para que el usuario pueda reintentar.
  - Mostrar en el footer un estado de renderizado activo:
    - `<Loader2 className="spin" size={16} /> Exportando video con FFmpeg...`
    - Deshabilitar el botón "Descartar" y el botón de exportación durante el proceso.

### Paso 4: Ejecución de Batería de Pruebas Automatizadas
- Ejecutar tests unitarios, de integración y E2E.
- Verificar 100% en verde.
- Ejecutar `npm run build` para asegurar la integridad de TypeScript del frontend.

### Paso 5: Compilación del Portable y Empaquetado `.tar.gz`
- Compilar el frontend y los binarios portables con `build_portable.py`.
- Generar el paquete `AutoShorts-v2.6.0-windows-x64-portable.tar.gz`.
- Sincronizar en `C:\Users\JEFF\Desktop\AutoShorts - Portable`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Timeout durante la precarga en LM Studio si el modelo es pesado | Podría demorar el inicio del análisis de momentos | Se implementa polling con feedback en pantalla en `log_buffer` y un timeout seguro de 45 segundos |
| Fallo en libass si el nombre del archivo contiene caracteres especiales | Subtítulos no se queman o FFmpeg aborta | Sanitizar el nombre del archivo eliminando caracteres conflictivos (`¡`, `¿`, comillas, caracteres no alfanuméricos) en el nombre del `.ass` y en el argumento del filtro FFmpeg |
| Congelamiento de UI durante el renderizado si PyWebView bloquea el thread | Interfaz deja de responder | La llamada a FFmpeg se realiza de forma asíncrona en el backend y el modal muestra spinner activo sin bloquear eventos de ventana |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- **Herramienta:** Python `unittest`
- **Archivo:** `scratch/test_lmstudio_auto_preload_unit.py`
- **Casos:**
  - Modelo en estado `"not-loaded"` en LM Studio: verificar que `ensure_model_loaded` realiza la llamada de precarga y espera hasta `"state": "loaded"`.
  - Verificación de que `get_available_context_size` devuelve `16384` una vez cargado el modelo y `detect_candidates_pipeline` calcula chunks de 10-15 min.

### Nivel 2: Tests de Integración
- **Herramienta:** Python `unittest` + SQLite + Mock de FFmpeg
- **Archivo:** `scratch/test_video_export_logging_integration.py`
- **Casos:**
  - Llamada a `render_flat_clip_for_candidate`: comprobar que los mensajes se inyectan en `log_buffer` (inicio, configuración de bitrate, éxito con tamaño en MB).
  - Simulación de error de FFmpeg: verificar que el error se registra en `log_buffer` y que el fallback opera correctamente.

### Nivel 3: Tests E2E (End-to-End)
- **Herramienta:** Python `unittest` + FFmpeg real sobre fragmento de video
- **Archivo:** `scratch/test_export_pipeline_e2e.py`
- **Casos:**
  - Exportación real de un clip de 38 segundos con subtítulos ASS y badge CTA animado en 1080x1920.
  - Verificación de existencia del archivo `.mp4`, tasa de bits entre 4 y 10 Mbps (sin inflar), y `log_buffer` con la traza completa.
  - Validación de TypeScript del frontend con `npm run build`.

---

## 6. Skills del Workspace Aplicadas

- **`senior-code-craft`**: 
  - **Sección 2.2 (Análisis de Causa Raíz):** Se identificó con precisión por qué el modal desaparecía instantáneamente y por qué el log no mostraba nada (cierre síncrono previo a la promesa y ausencia de llamadas a `log_buffer` en `render_flat_clip`).
  - **Sección 1.1 y 1.2 (Clean Code & Guard Clauses):** Desacoplar la verificación de estado de LM Studio en una función clara y modular con manejo de excepciones resiliente.
  - **Sección 4.3 (Estrategia Integral de Testing):** Cobertura rigurosa en los tres niveles (Unitario, Integración y E2E) con validación al 100%.
- **`antislop-code`**: 
  - Se respetan estrictamente las directrices de comentarios limpios: sin separadores decorativos, sin narración redundante de control de flujo y preservando el código sin comentarios artificiales innecesarios.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan requiere tu autorización formal antes de ejecutar cualquier cambio.
> Para proceder, responde exactamente: **`PLAN APROBADO`**.

