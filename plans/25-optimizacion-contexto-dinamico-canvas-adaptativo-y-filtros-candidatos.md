# Plan de Acción 25: Optimización de Contexto Dinámico (4GB/8GB+ VRAM), Canvas y Coordenadas Adaptativas NLE, Filtros/Orden de Momentos y Fix de Auto-Transcripción

## 1. Diagnóstico del Problema

Tras investigar en profundidad el backend de Python, el frontend en React 19 y los componentes visuales a partir de las capturas compartidas por el usuario, se han identificado cinco áreas críticas:

1. **Gestión de Contexto IA ante Duraciones Largas (10m / 15m) en hardware variado (4GB vs 8GB+ VRAM):**
   - **Problema real:** En `python_backend/llm.py`, al solicitar `target_duration == "10m"` o `"15m"`, el tamaño de bloque se fijó en 1200s (20m) y 1800s (30m). Si un usuario o su amigo dispone de una GPU modesta (ej. 4GB VRAM) o un modelo local configurado con ventana de contexto de 4k tokens (4096), volcar 20 o 30 minutos de segmentos Whisper con timestamps detallados (`compact_segments`) produce más de 4,500 - 5,500 tokens. Esto excede el límite de tokens (`safe_token_ceiling`), obligando al sistema a subdividir el bloque a la mitad (15 min y luego 7.5 min). Al subdividirse a 7.5 minutos, resulta matemáticamente imposible que el LLM identifique un clip objetivo de 10 o 15 minutos dentro de ese bloque.
   - **Solución técnica:**
     - Implementar **Compensación y Macro-Agrupación de Transcripción para Formato Largo**: Cuando el objetivo es `10m` o `15m`, o cuando el contexto detectado sea `<= 4096` tokens, no se envían cientos de marcas de tiempo de 2 segundos. Se agrupan los segmentos en bloques cronológicos de 30 a 60 segundos por párrafo (`[MM:SS] Párrafo continuo...`), reduciendo el consumo de tokens en un 70% (~1,000 a 1,400 tokens para 30 minutos).
     - Calibrar la bisección adaptativa para que nunca divida un bloque por debajo de la duración mínima del objetivo solicitado (`DURATION_SPECS[target_duration]["min"]`), garantizando que equipos con 4GB de VRAM puedan analizar episodios completos sin desbordamiento ni fallos de contexto.

2. **Lienzo y Coordenadas Hardcodeadas en Vertical dentro del Estudio de Edición (`CandidatePreviewModal.tsx`):**
   - **Problema real:** Al abrir un video horizontal (1920x1080) o cambiar a 16:9, los valores de coordenadas `captionY` y `ctaY` cargaban por defecto o desde `localStorage` valores como `1680px` y `1550px` (diseñados para lienzo vertical 1080x1920). Como el alto del lienzo horizontal es 1080px, una posición Y de 1680px queda un 55% fuera de la pantalla (invisible tanto en la previsualización como en el video renderizado con FFmpeg). Además, los botones de preset ("Abajo", "Centro", "Arriba", "Streamer Elevado") y los sliders estaban rígidamente fijados a las métricas del lienzo vertical.
   - **Solución técnica:**
     - Separar o normalizar los presets y coordenadas según la orientación del lienzo:
       - **Lienzo Horizontal (1920x1080):** Centro X: 960px. Presets Y: Arriba: 100px, Centro: 540px, Abajo: 920px, Streamer Elevado: 780px (dejando 300px libres para HUD/webcam gamer).
       - **Lienzo Vertical (1080x1920):** Centro X: 540px. Presets Y: Arriba: 280px, Centro: 960px, Abajo: 1680px, Streamer Elevado: 1420px.
     - Auto-detección y escalado proporcional al alternar orientación: Si al cambiar a horizontal `captionY > canvasHeight` o `ctaY > canvasHeight`, reajustar y reescalar matemáticamente (`captionY = Math.round((captionY / prevHeight) * canvasHeight)`).
     - Ajustar los contenedores CSS del reproductor (`.clip-phone-stage.stage-horizontal`) para que el video panorámico se aproveche con amplitud sin franjas negras excesivas.

3. **Selector de Duración Incompleto en `CandidatePanel.tsx`:**
   - **Problema real:** En la barra superior de `CandidatePanel.tsx`, la lista de duraciones estaba fijada en `["30s", "60s", "2m", "3m", "5m"]`, omitiendo las opciones `"10m"` y `"15m"` incorporadas en la release anterior.
   - **Solución técnica:** Añadir `"10m"` y `"15m"` al array de duraciones en `CandidatePanel.tsx` con sus etiquetas legibles para permitir buscar y filtrar clips largos directamente desde el panel principal.

4. **Orden Cronológico y Filtros por Tipo de Momento (`CandidatePanel.tsx`):**
   - **Problema real:** Los momentos se muestran únicamente en el orden devuelto por la base de datos (por ranking de virilidad). Los creadores que graban partidas o series necesitan ver los clips ordenados cronológicamente según la línea de tiempo del juego (de inicio a fin del stream) o filtrar según la naturaleza del clip (reacciones, clutches, anécdotas, etc.).
   - **Solución técnica:**
     - Incorporar en la cabecera de `CandidatePanel.tsx` un control de ordenamiento: **Por Match / Virilidad** (defecto) vs **Cronología (Línea de tiempo)** vs **Duración**.
     - Incorporar una barra de pastillas/filtro por tipo de momento: **Todos**, **Reacción**, **Destacado / Épico**, **Clutch / Jugada**, **Anécdota**, **Fail / Rage**, **Tutorial / Tip**.
     - Enriquecer en el backend (`llm_prompts.py`, `llm.py`, `db.py`) la clasificación y detección automática de estos tipos de momentos en el análisis del LLM y en los algoritmos heurísticos de respaldo.

5. **Fallo en "Transcribir audio automáticamente al importar" (`StyleModal.tsx` / `useProjectActions.ts`):**
   - **Problema real:**
     - En `useMediaPipeline.ts`, `runAutoPipeline` verificaba la disponibilidad de Ollama / LM Studio **antes** de ejecutar la transcripción. Si el usuario importaba un video para transcribir y no tenía el servidor LLM activo (o si `autoDetectMoments` estaba desmarcado, como se observa en la captura), el pipeline abortaba de inmediato sin transcribir el audio con Whisper.
     - En `useProjectActions.ts`, si un proyecto previamente importado o restaurado desde disco contenía un objeto de transcripción residual vacío, la bandera `alreadyHasTranscript` se evaluaba como verdadera, omitiendo la transcripción.
     - La opción `autoTranscribeOnImport` no persistía en `localStorage`, lo que provocaba inconsistencias entre sesiones.
   - **Solución técnica:**
     - Desacoplar por completo la transcripción con Whisper del chequeo de LLM: Whisper corre 100% independiente con CTranslate2. El LLM solo se consulta si `autoDetectMoments` está activo y una vez que la transcripción ha finalizado.
     - Persistir `autoTranscribeOnImport` en `localStorage` (por defecto `true`).
     - Validar que `alreadyHasTranscript` sea verdadera únicamente si el proyecto tiene segmentos de palabras reales (`words.length > 0`), permitiendo transcribir de forma limpia.

---

## 2. Alcance de Modificaciones

### Archivos a Modificar:
1. **`python_backend/llm.py`**:
   - Función `macro_compact_segments` para condensar transcripciones en bloques de 30s-60s cuando se analizan duraciones largas (10m/15m) o contextos reducidos (<= 4k tokens).
   - Calibración de `_analyze_chunk_adaptively` para respetar la duración mínima del objetivo en la bisección.
   - Detección y clasificación enriquecida de `hook_type` (`"reacción"`, `"destacado"`, `"clutch"`, `"anécdota"`, `"fail"`, `"tutorial"`, `"pregunta"`).
2. **`python_backend/llm_prompts.py`**:
   - Actualización de especificaciones de `virality.hook_type` en el prompt JSON del sistema para reconocer clutches, fails/rage, jugadas épicas y tutoriales.
3. **`python_backend/db.py`**:
   - Clasificación heurística de `hook_type` en `get_candidates` y normalización ante valores nulos.
4. **`src/hooks/useAppSettings.ts`**:
   - Persistencia reactiva en `localStorage` de `autoTranscribeOnImport` (`autoshorts_auto_transcribe_on_import`, default `true`).
5. **`src/hooks/useProjectActions.ts`**:
   - Corrección de la condición `alreadyHasTranscript` verificando `words && words.length > 0`.
   - Vinculación de `autoTranscribeOnImport` con persistencia.
6. **`src/hooks/useMediaPipeline.ts`**:
   - Desacoplamiento de la verificación de Whisper y LLM: permitir que la transcripción siempre se ejecute aunque el LLM no esté activo cuando `autoDetectMoments` sea falso.
7. **`src/components/modals/CandidatePreviewModal.tsx`**:
   - Presets dinámicos de posición (X e Y) calibrados según si el lienzo es horizontal (1920x1080) o vertical (1080x1920).
   - Reescalado automático y defensivo de coordenadas `captionY` y `ctaY` al cambiar la relación de aspecto para evitar que queden fuera del lienzo visible (> 1080px).
   - Sliders e inputs sincronizados dinámicamente con los límites reales del lienzo activo.
8. **`src/components/panels/CandidatePanel.tsx`**:
   - Incorporación de `"10m"` y `"15m"` a los botones de duración.
   - Selector de ordenamiento: Por Match (defecto) vs Cronología (orden por `start_sec`) vs Duración.
   - Barra de filtros interactivos por `hook_type` (Todos, Reacción, Destacado, Clutch, Anécdota, Fail, Tutorial).
9. **`src/styles/modals.css` y `src/styles/panels.css`**:
   - Estilos limpios de alto contraste para el selector de orden y pastillas de filtro según las directrices de `antislop-ui` y `senior-code-craft`.

---

## 3. Paso a Paso Técnico

1. **Gestión de Contexto Adaptativo para PCs de 4GB VRAM y Clips Largos:**
   - Crear `macro_compact_segments(segments, block_sec=30.0)` en `python_backend/llm.py` que condense segmentos por bloques temporales para reducir drásticamente el consumo de tokens en clips de 10m y 15m.
   - En `_analyze_chunk_adaptively`, seleccionar `macro_compact_segments` cuando `target_duration in ["10m", "15m"]` o cuando `context_limit <= 4096`.
   - Ajustar el límite de bisección para que el bloque resultante nunca sea menor que la duración mínima del clip solicitado.

2. **Adaptación Dinámica del Lienzo y Coordenadas en `CandidatePreviewModal.tsx`:**
   - Definir mapas de presets específicos para horizontal (`{ top: 100, center: 540, bottom: 920, streamer: 780 }`, centro X `960`) y vertical (`{ top: 280, center: 960, bottom: 1680, streamer: 1420 }`, centro X `540`).
   - Añadir efecto `useEffect` sensible a `exportAspectRatio`: al conmutar entre formatos, si `captionY > canvasHeight`, reajustar `captionY = Math.round((captionY / prevHeight) * canvasHeight)`. Aplicar la misma lógica a `ctaY`.
   - Actualizar los botones de presets rápidos para que invoquen los valores correspondientes al lienzo activo.

3. **Selector de Duración Completo en `CandidatePanel.tsx`:**
   - Ampliar la lista a `["30s", "60s", "2m", "3m", "5m", "10m", "15m"]`.
   - Asegurar que al hacer clic se persista en `localStorage.setItem("autoshorts_target_duration", dur)`.

4. **Orden Cronológico y Filtro por Tipo de Momento:**
   - En `CandidatePanel.tsx`, añadir estados `sortBy: "match" | "chrono" | "duration"` y `filterType: string | null`.
   - Implementar ordenamiento en `displayedCandidates`:
     - `"match"`: orden por `c.score` descendente (o `rank` ascendente).
     - `"chrono"`: orden por `c.start` ascendente.
     - `"duration"`: orden por `(c.end - c.start)` descendente.
   - Enriquecer la lista de tipos de gancho en `llm_prompts.py` y en la heurística de `db.py`.

5. **Corrección de Transcripción Automática al Importar:**
   - En `useMediaPipeline.ts`, trasladar la verificación de Ollama/LM Studio para que ocurra exclusivamente dentro del bloque de `autoDetectMoments`. La transcripción con Whisper se ejecuta sin depender de la conectividad del LLM.
   - En `useProjectActions.ts`, refinar la condición `alreadyHasTranscript = Boolean(projectDetail?.transcript?.words && projectDetail.transcript.words.length > 0)`.
   - Persistir `autoTranscribeOnImport` en `useAppSettings.ts`.

---

## 4. Riesgos e Implicaciones

- **Riesgo:** Que al cambiar de horizontal a vertical las coordenadas X/Y sufran desviaciones acumuladas tras múltiples cambios.
  - *Mitigación:* Guardar las coordenadas separadas por formato en `localStorage` (`autoshorts_caption_coords_horizontal` vs `autoshorts_caption_coords_vertical`), asegurando que cada modo recuerde exactamente la posición que el usuario configuró sin pérdida de precisión.
- **Riesgo:** Que en videos largos sin hablar constante (gaming silencioso) la macro-agrupación genere bloques vacíos.
  - *Mitigación:* Mantener la inyección de picos de acción acústica (`action_peaks`) para que el LLM reciba los momentos de disparos o tensión sonora incluso sin palabras habladas.

---

## 5. Estrategia de Testing (Obligatorio — Gate de Cierre)

Se ejecutarán y crearán tests en los tres niveles para certificar el 100% en verde:

1. **Tests Unitarios:**
   - `scratch/test_macro_segments_context_unit.py`: Verifica que `macro_compact_segments` comprima transcripts de 30 minutos a menos de 1,500 tokens, que la partición para 10m/15m respete la ventana de 4k tokens y que la clasificación heurística de `hook_type` categorice correctamente clutches, fails, anécdotas y reacciones.
   - `scratch/test_canvas_coordinates_geometry_unit.py`: Verifica que los presets horizontales y verticales devuelvan coordenadas estrictamente dentro del rango `[0, canvasWidth]` y `[0, canvasHeight]`, sin valores excedidos como 1680px en lienzos de 1080px.
2. **Tests de Integración:**
   - `scratch/test_auto_pipeline_decoupled_integration.py`: Simula la importación con `autoTranscribeOnImport = true` con el servidor LLM apagado y verifica que la transcripción se complete exitosamente sin abortar.
   - `scratch/test_candidate_sorting_and_filtering_integration.py`: Verifica que la ordenación cronológica (`chrono`), por match (`match`) y el filtrado por `hook_type` operen de manera pura sobre listas de candidatos reales.
3. **Tests E2E:**
   - Ejecución de la suite completa automatizada (`python scratch/run_all_tests.py`) confirmando el 100% de tests en verde (30+ tests pasando).
   - Verificación de compilación de TypeScript y empaquetado (`cmd /c pnpm run build`).

