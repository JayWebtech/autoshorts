# Plan 24: Enfoque Híbrido Gaming (Subgéneros + Contexto Personalizado), Duraciones Extendidas (10m y 15m) y Compatibilidad Nativa Horizontal y Resoluciones Arbitrarias

## 1. Diagnóstico

El usuario utiliza AutoShorts primordialmente para contenido de videojuegos (gaming) y plantea tres necesidades fundamentales de evolución del producto:

1. **Especialización del Enfoque Gaming (Enfoque 3 Híbrido):**
   - Actualmente, al seleccionar "Gaming" en la importación, el sistema aplica un prompt genérico orientado a kills, clutches y clips rápidos.
   - Si el creador juega una campaña narrativa (ej. *Metro Exodus*, *Hollow Knight*), un Souls-like de alta dificultad (ej. *Dark Souls*, *Elden Ring*), un juego de precisión/rítmico (ej. *Geometry Dash*), o una aventura cinematográfica (ej. *Ghost of Tsushima*), el LLM no sabe qué buscar (busca clutches en lugar de revelaciones de historia, muertes repetidas con superación de jefes, o picos de concentración milimétrica).
   - El creador necesita un sistema híbrido: **píldoras rápidas de subgéneros a 1 clic** (Competitivo, Campaña/Historia, Souls-like/Desafío, Rítmico/Precisión, Terror/Sustos, Sandbox/Rol) **más un campo de texto libre opcional de contexto o juego** (ej. *"Campaña de Hollow Knight"*, *"Capítulo 5 de Metro"* o *"Reto solo pistolas"*) que se inyecta directamente en el prompt del LLM.

2. **Extensión de Duraciones Objetivo (10 min y 15 min):**
   - Las duraciones actuales tienen un tope máximo de 5 minutos (`["30s", "60s", "2m", "3m", "5m"]`).
   - Para series de YouTube, episodios completos, resúmenes de misiones o gameplay estructurado, se requieren duraciones de **10 minutos** (~540s a 660s) y **15 minutos** (~810s a 990s).
   - En el backend (`python_backend/llm.py`), el tamaño de los chunks de análisis LLM (`chunk_dur`) actualmente está fijado a un máximo de 900s (15 min) para bloques de 3m/5m y a 600s para el resto. Si se solicita un clip de 10m o 15m, el chunk actual es demasiado corto para abarcar el rango continuo solicitado, por lo que la partición adaptativa debe ampliarse para duraciones largas.

3. **Compatibilidad Nativa con Formato Horizontal y Resoluciones Arbitrarias:**
   - Hasta ahora AutoShorts ha estado optimizado principalmente para formato vertical 9:16 (Shorts/TikTok/Reels).
   - Si el usuario graba en horizontal (16:9 tradicional como 1080p, 1440p, 4K) o en formatos ultrawide/resoluciones no estándar (ej. 21:9 o capturas arbitrarias de ventana), el software debe detectar automáticamente el ancho y alto del video fuente (`probe_media`).
   - Actualmente:
     - `render_flat_clip` en `python_backend/media.py` forzaba recorte a 9:16 si el target era 9:16 o aplicaba `scale=1080:1920`. Si el usuario desea mantener el formato nativo u horizontal, debe evitarse el filtro de recorte vertical.
     - Los subtítulos ASS (`generate_ass_subtitles`) definen `res_x` y `res_y` como `1080x1920` o `1920x1080`. Deben calibrarse dinámicamente con la resolución nativa de destino para que los estilos, márgenes y etiquetas no se deformen en 1440p o 4K.
     - En el frontend, `.clip-phone-stage` en `modals.css` tenía `aspect-ratio: 9 / 16;` estático forzado, provocando bandas negras y desaprovechamiento de espacio cuando el video es horizontal. El reproductor y la previsualización deben adaptar su relación de aspecto al formato del video.
     - Debe existir un selector de Formato / Aspect Ratio (`📱 Vertical 9:16`, `🖥️ Horizontal 16:9`, `🎞️ Nativo / Original`) tanto en la importación (`StyleModal.tsx`) como en el estudio de edición (`CandidatePreviewModal.tsx`), asegurando que las coordenadas X/Y y el escalado de CTA y subtítulos respondan al lienzo correspondiente.

---

## 2. Alcance

### Backend Python:
- `python_backend/llm_prompts.py`:
  - Extender `DURATION_SPECS` con `"10m"` (`min: 540.0`, `max: 660.0`) y `"15m"` (`min: 810.0`, `max: 990.0`).
  - Actualizar `build_system_prompt` para aceptar `gaming_subgenre: Optional[str]` y `game_context: Optional[str]`, inyectando instrucciones especializadas por subgénero (competitivo, campaña, souls_rage, rítmico, terror, sandbox) y la directriz personalizada del juego.
- `python_backend/llm.py`:
  - Adaptar `partition_segments` y `detect_candidates_pipeline`: para duraciones de 10m y 15m, dimensionar los chunks a 1200s (20m) y 1800s (30m) respectivamente (con overlap proporcional), respetando el límite seguro de tokens.
  - Propagar `gaming_subgenre` y `game_context` a través de `_analyze_chunk_adaptively`, `call_ollama` y `call_lmstudio`.
- `python_backend/api.py`:
  - Aceptar `gamingSubgenre`, `gameContext` y `aspectRatio` en `create_project_from_path`, `generate_candidates`, `auto_pipeline` y `export_clip` / `render_clip`.
  - Asegurar que `probe_project` y `get_project_detail` expongan `width`, `height` y `aspectRatio` al frontend.
- `python_backend/media.py`:
  - En `render_flat_clip`: soportar `aspect_ratio="original"`, `aspect_ratio="16:9"` y `aspect_ratio="9:16"`.
  - En videos con dimensiones arbitrarias (ej. números impares de píxeles), aplicar normalización `trunc(iw/2)*2:trunc(ih/2)*2` para evitar fallos de codec libx264.
  - En `generate_ass_subtitles`: sincronizar `PlayResX` y `PlayResY` con las dimensiones reales del video cuando se renderiza en horizontal u original.

### Frontend React (TypeScript):
- `src/types.ts`:
  - Extender `TargetDuration`: `"30s" | "60s" | "2m" | "3m" | "5m" | "10m" | "15m"`.
  - Definir tipos `GamingSubgenre` y `AspectRatioOption`.
  - Agregar campos `gamingSubgenre?: string`, `gameContext?: string` y `aspectRatio?: string` en `Project`.
- `src/components/modals/StyleModal.tsx`:
  - Añadir botones de 10 min y 15 min en la cuadrícula de duración.
  - Añadir sección dinámica de Subgéneros Gaming con píldoras interactivas cuando `selectedContentType === "gaming"`.
  - Añadir campo de texto libre para `gameContext` ("Contexto o juego específico, ej: Campaña de Metro, Hollow Knight...").
  - Añadir selector de Formato de Salida (`Vertical 9:16`, `Horizontal 16:9`, `Original / Nativo`).
- `src/components/modals/CandidatePreviewModal.tsx`:
  - Integrar selector de relación de aspecto en la barra de herramientas del estudio.
  - Adaptar dinámicamente `.clip-phone-stage` para que use `aspect-ratio: 16 / 9` o la relación del video nativo cuando no sea vertical.
  - Ajustar la proyección de coordenadas de subtítulos y CTA según el lienzo activo (1080x1920 vs 1920x1080 / nativo).
- `src/hooks/useMediaPipeline.ts` y `src/hooks/useProjectActions.ts`:
  - Propagar los nuevos parámetros (`gamingSubgenre`, `gameContext`, `aspectRatio`) en el estado y en las llamadas IPC con persistencia en `localStorage`.

---

## 3. Skills del Workspace Utilizadas

- **`senior-code-craft`**:
  - `refactor:escalable`: Desacoplamiento limpio entre la detección de características del video (ffprobe) y la parametrización del renderizador.
  - `debug:edge-cases`: Blindaje ante resoluciones no convencionales (anchos impares que rompen `libx264`, ultrawide 21:9, videos 4K a 60fps) y desbordamiento de contexto en LLM ante clips de 10 y 15 minutos.
  - `test:estrategia`: Diseño de suite en 3 niveles (Unit, Integration, E2E) cubriendo prompts, cálculo de chunks y render horizontal.
- **`ui-ux-pro-max`**:
  - Diseño de píldoras de subgénero accesibles con contraste WCAG AAA, estados hover/active perceptibles y transiciones suaves.
  - Contenedor de previsualización responsivo que conmuta entre estética smartphone 9:16 y reproductor cinematográfico horizontal 16:9.
- **`antislop-copywriting`**:
  - Textos descriptivos claros y directos en la interfaz sin redundancias ni florituras vacías.

---

## 4. Paso a Paso Técnico

### Fase 1: Backend de IA y Prompts (`python_backend/llm_prompts.py` y `python_backend/llm.py`)
1. En `python_backend/llm_prompts.py`:
   - Incorporar `"10m"` y `"15m"` a `DURATION_SPECS` con rangos de tolerancia holgados para contenido largo (10m: 540-660s; 15m: 810-990s).
   - Crear un catálogo de directrices por subgénero dentro de `build_system_prompt`:
     - `competitive`: Énfasis en clutches, rankeds, tensión táctica, kills, aces y comunicación de equipo.
     - `campaign`: Énfasis en cinemáticas, diálogos con lore, giros de trama, avance narrativo y decisiones.
     - `souls_rage`: Énfasis en batallas contra jefes, muertes consecutivas, tensión extrema, desahogo (rage) y victoria épica.
     - `rhythmic`: Énfasis en concentración máxima, sincronización musical, fallos agónicos al 99% y superación de niveles difíciles.
     - `horror`: Énfasis en jumpscares, tensión psicológica, suspenso silencioso y reacciones de susto genuinas.
     - `sandbox`: Énfasis en descubrimientos inesperados, experimentos caóticos, rol cómico y creatividad.
   - Si `game_context` está presente, inyectar el bloque:
     `CONTEXTO ESPECÍFICO DEL JUEGO / SERIE:`
     `El creador indica que la grabación corresponde a: "{game_context}". Prioriza momentos, hooks y títulos que capturen el hilo conductor de este juego o temática.`
2. En `python_backend/llm.py`:
   - Actualizar el dimensionamiento de chunks en `detect_candidates_pipeline`:
     - Si `target_duration in ["10m", "15m"]`, fijar `chunk_dur = 1200.0` (o `1800.0` para 15m) con `overlap = 180.0` (o `240.0`).
     - Asegurar que `_analyze_chunk_adaptively` admita duraciones largas sin descartar bloques válidos.

### Fase 2: Soporte Horizontal y Resoluciones Arbitrarias (`python_backend/media.py` y `python_backend/api.py`)
1. En `python_backend/media.py`:
   - En `render_flat_clip`:
     - Evaluar la variable `aspect_ratio`:
       - Si `aspect_ratio == "16:9"`:
         - Si el video fuente es vertical (`vid_h > vid_w`), aplicar recorte/enmarcado horizontal con barras o crop central.
         - Si el video fuente es horizontal nativo, **no aplicar crop 9:16**, preservar resolución nativa escalada o directa (ej. 1920x1080).
       - Si `aspect_ratio == "original"`:
         - Preservar exactamente las dimensiones nativas `vid_w` y `vid_h`, aplicando filtro par `scale=trunc(iw/2)*2:trunc(ih/2)*2` para seguridad de encoder.
       - Si `aspect_ratio == "9:16"`:
         - Mantener la lógica existente de crop central y escala a 1080x1920.
     - En `generate_ass_subtitles`:
       - Si `is_vertical` es `False`, fijar `PlayResX = 1920`, `PlayResY = 1080` (o dimensiones nativas).
       - Calibrar márgenes verticales y fuentes para lienzo horizontal (márgenes más compactos de 90px en lugar de 180px, font size base equilibrado).
2. En `python_backend/api.py`:
   - Exponer y sincronizar `aspect_ratio` del proyecto y del clip en los flujos de exportación.

### Fase 3: Frontend y Controles de Usuario
1. En `src/types.ts`:
   - Actualizar unión de `TargetDuration` para incluir `"10m" | "15m"`.
   - Definir `type GamingSubgenre = "competitive" | "campaign" | "souls_rage" | "rhythmic" | "horror" | "sandbox" | "general_gaming"`.
   - Definir `type AspectRatioOption = "original" | "16:9" | "9:16"`.
2. En `src/components/modals/StyleModal.tsx`:
   - Renderizar los botones `10 min` y `15 min` en la sección de duraciones.
   - Cuando `selectedContentType === "gaming"`, desplegar la cuadrícula de píldoras de subgéneros con iconos e indicadores de foco.
   - Añadir el campo de texto libre "Contexto o Juego Específico" con persistencia en `localStorage`.
   - Añadir el selector de relación de aspecto objetivo (`📱 Vertical 9:16`, `🖥️ Horizontal 16:9`, `🎞️ Nativo / Original`).
3. En `src/components/modals/CandidatePreviewModal.tsx`:
   - Permitir conmutar la previsualización y exportación entre `9:16`, `16:9` y `Original`.
   - Ajustar el contenedor `.clip-phone-stage` con clases dinámicas para aspecto panorámico (16:9) cuando el video o el modo seleccionado sea horizontal, evitando barras negras artificiales.
   - Sincronizar las coordenadas absolutas de subtítulos y CTA (0-1920 / 0-1080) cuando el modo sea horizontal.
4. En `src/hooks/useMediaPipeline.ts`:
   - Conectar las opciones en las llamadas IPC a `generate_candidates` y `export_clip`.

---

## 5. Riesgos e Implicaciones

| Riesgo | Implicación | Mitigación Técnica |
|---|---|---|
| Chunks de 10m y 15m con alto número de tokens en transcripción | Modelos con ventanas de contexto pequeñas (4k) podrían desbordarse en diálogos muy densos. | `_analyze_chunk_adaptively` ya cuenta con bisección adaptativa recursiva y estimación de tokens con techo de seguridad al 65% del contexto. Si un bloque excede los tokens seguros, se subdivide automáticamente. |
| Videos con resolución impar (ej. 1919x1079 o capturas de ventana libre) | FFmpeg falla con error fatal `width not divisible by 2` al usar el encoder `libx264`. | En `render_flat_clip` se inyecta siempre `scale=trunc(iw/2)*2:trunc(ih/2)*2` en la cadena de pre-procesamiento para garantizar paridad estricta. |
| Subtítulos ASS proyectados fuera de pantalla en horizontal | Coordenadas Y calculadas para 1920px verticales (ej. Y=1680) se saldrían de un lienzo horizontal de 1080px. | En modo horizontal, los presets y cálculos de posición relativa re-escalan a escala de 1080px (`pos_y * (1080/1920)` o cálculo nativo). |
| Persistencia entre recargas de la app | El usuario tendría que re-tipear el contexto del juego cada vez que abre la app. | Se guarda en `localStorage` bajo `autoshorts_game_context`, `autoshorts_gaming_subgenre` y `autoshorts_clip_aspect_ratio`. |

---

## 6. Estrategia de Testing (Gate de Cierre Obligatorio — Cobertura 100%)

Siguiendo el protocolo mandatorio y la skill `senior-code-craft`, la entrega requerirá validación en los tres niveles:

### Nivel 1: Tests Unitarios
1. `scratch/test_gaming_subgenre_prompts_unit.py`:
   - Validar que `build_system_prompt` genere las instrucciones correctas para cada uno de los subgéneros (`campaign`, `souls_rage`, `rhythmic`, `horror`, etc.).
   - Validar que `game_context` (ej. "Campaña de Hollow Knight") se inserte exactamente en el prompt sin corromper la estructura JSON requerida.
   - Validar que las especificaciones de duración para `"10m"` y `"15m"` en `DURATION_SPECS` contengan instrucciones y rangos de segundos válidos.
2. `scratch/test_aspect_ratio_geometry_unit.py`:
   - Validar que `render_flat_clip` construya la cadena de filtros adecuada según la combinación de aspecto fuente y solicitado (`16:9`, `9:16`, `original`).
   - Validar la regla de paridad de píxeles (`trunc(iw/2)*2`).

### Nivel 2: Tests de Integración
1. `scratch/test_horizontal_video_render_integration.py`:
   - Renderizar un clip de prueba sintético horizontal (1920x1080) con subtítulos ASS y badge CTA.
   - Verificar mediante `ffprobe` que el video resultante conserve resolución 1920x1080 exacta, audio sincronizado y subtítulos posicionados dentro del área visible sin cortes.

### Nivel 3: Tests E2E y Suite Completa
1. Ejecutar la suite completa acumulada del proyecto (más de 30 tests automatizados).
2. Verificar 100% en verde sin regresiones.
3. Compilar frontend con `pnpm run build` para asegurar cero errores de TypeScript y empaquetar portable con `python build_portable.py`.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan define la arquitectura y el paso a paso exacto para implementar los subgéneros de gaming, el contexto personalizado, las duraciones de 10m y 15m, y la compatibilidad horizontal nativa.
> Para autorizar el inicio de la ejecución técnica, responde con la frase exacta:
> **`PLAN APROBADO`**

