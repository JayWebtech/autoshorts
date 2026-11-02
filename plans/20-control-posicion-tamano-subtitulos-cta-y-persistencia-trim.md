# Plan 20: Control Total de Coordenadas X/Y Estilo Premiere para Subtítulos y CTA, Fix de Persistencia de Trim y Acción Descartar

## 1. Diagnóstico

A partir del feedback del usuario y las capturas reales adjuntas, se identifican 4 puntos críticos a resolver en el estudio de edición:

### 1. Desincronización y ubicación de "Guardar Ajuste" / "Restablecer" en Trim
- **Causa Raíz:** Al usar los botones `+5s/-5s` en "Punto de Inicio" o "Fin", `trimStart` y `trimEnd` se actualizan en el estado local. Sin embargo, los `segments` de cortes internos no se ajustaban a esos límites. Al pulsar *"Guardar Ajuste"*, el código tomaba `activeSubRanges[0].start` y pisaba `trimStart` con el valor previo del segmento, ignorando el ajuste fino del usuario.
- **Ubicación:** Los botones de "Restablecer Original" y "Guardar Ajuste" están colocados a mitad de pantalla (debajo del ajuste fino pero arriba de los cortes internos), generando confusión sobre a qué aplican.
- **Solución:** Sincronizar bidireccionalmente los límites exteriores de los segmentos con `trimStart` y `trimEnd`. Mover los botones al fondo de la pestaña "1. Recorte (Trim)" para que gobiernen de forma unificada tanto el recorte fino de tiempos como los cortes internos.

### 2. Control Total de Coordenadas X e Y para Subtítulos (Estilo Premiere Pro)
- **Causa Raíz:** En `python_backend/media.py`, la posición de los subtítulos ASS está fijada estáticamente (`margin_v = 180`, `font_size = 62`). En streams con overlays inferiores (como el banner de redes `[K] jeffdgames [FOLLOW]` de la captura 4), el texto cae directamente encima del banner.
- **Solución — Control Total de Coordenadas X / Y:**
  - Incorporar un panel de transformación estilo Premiere Pro / CapCut:
    - **Coordenada X (Horizontal):** Control numérico + slider (0 a 1080 px en lienzo nativo 9:16). Botón rápido para *"Centrar X"* (540 px).
    - **Coordenada Y (Vertical):** Control numérico + slider (0 a 1920 px en lienzo nativo 9:16). Presets rápidos: *"Arriba"* (Y=280), *"Centro"* (Y=960), *"Streamer Elevado"* (Y=1420), *"Abajo Estándar"* (Y=1680).
    - **Tamaño de Fuente:** Control numérico + slider (36px a 88px, default 62px).
    - **Alineación de Texto:** Izquierda, Centro, Derecha.
  - En el backend (`python_backend/media.py`), inyectar el tag ASS `\pos(X, Y)` y `\an5` (o anclaje según alineación) por cada línea de diálogo, logrando un posicionamiento subpixel exactamente idéntico al preview.

### 3. Control Total de Coordenadas X e Y y Corrección Visual en Insignia CTA
- **Causa Raíz:** En `python_backend/media.py` (`generate_cta_badge_image`), cuando el texto comienza con emoji (ej. `❤️`), el glyph de Segoe UI Emoji tiene un bearing inicial negativo (`bbox_e[0] < 0`). Al dibujarse en `pad_x`, el corazón toca o sobresale del borde curvo de la pastilla. Además, la posición de la insignia estaba fijada a valores estáticos (`130`, `(H-h)/2`, etc.).
- **Solución — Control Total de Coordenadas X / Y y Escala:**
  - Corregir el offset de dibujo del emoji en PIL asegurando padding perimetral estricto (`cur_x = pad_x - min(0, bbox_e[0]) + 6`).
  - Panel de transformación para CTA:
    - **Coordenada X:** Control numérico + slider (0 a 1080 px). Botón *"Centrar X"* (540 px).
    - **Coordenada Y:** Control numérico + slider (0 a 1920 px). Presets rápidos: *"Arriba"* (Y=180), *"Medio"* (Y=960), *"Abajo"* (Y=1550).
    - **Escala de Insignia:** Control numérico + slider (70% a 140%).
  - En FFmpeg overlay, aplicar las coordenadas exactas `x='{X}-w/2':y='{Y}-h/2'`.

### 4. Botón "Descartar" en el Footer del Modal
- **Causa Raíz:** El botón inferior izquierdo decía "Descartar" pero únicamente ejecutaba `onClose()`. Afuera, en la tarjeta del panel, "Descartar" marca el candidato como descartado (`toggleCandidateDismissed`).
- **Solución:**
  - Renombrar el botón neutro a "Cerrar" (cierra la ventana sin modificar el estado del clip).
  - Añadir una acción explícita "Descartar momento" con icono de papelera que invoque `toggleCandidateDismissed(candidate.id, true)` y cierre el modal, permitiendo descartar clips directamente desde el estudio.

---

## 2. Alcance

### Archivos Frontend:
- `src/components/modals/CandidatePreviewModal.tsx`:
  - Sincronización de `trimStart`/`trimEnd` con los segmentos externos.
  - Reubicación de los botones de guardar/restablecer al fondo de la pestaña Trim.
  - Panel de coordenadas para Subtítulos: inputs numéricos y sliders para X (0-1080), Y (0-1920), tamaño de fuente (36-88px), alineación horizontal y botones de centrado/presets.
  - Panel de coordenadas para CTA: inputs numéricos y sliders para X (0-1080), Y (0-1920), escala (70-140%) y botones de centrado/presets.
  - Renderizado en vivo 1:1 en el smartphone usando porcentajes exactos derivados de `(X/1080)*100%` y `(Y/1920)*100%`.
  - Botón "Cerrar" y botón "Descartar Momento".
- `src/components/modals/ModalContainer.tsx`:
  - Pasar `toggleCandidateDismissed` como prop a `CandidatePreviewModal`.
- `src/types.ts` & `src/hooks/useMediaPipeline.ts`:
  - Extender `CutClipOptions` con `captionX`, `captionY`, `captionFontSize`, `captionAlignH`, `ctaX`, `ctaY`, `ctaScale`.

### Archivos Backend:
- `python_backend/media.py`:
  - En `generate_ass_subtitles`: soportar coordenadas explícitas `pos_x`, `pos_y`, `font_size` y `align_h` usando `\an5\pos(X, Y)`.
  - En `generate_cta_badge_image`: corregir márgenes del emoji de corazón para evitar recortes en la pastilla y soportar factor de escala.
  - En `render_flat_clip`: soportar `cta_x`, `cta_y` y `cta_scale` en el filtergraph FFmpeg.
- `python_backend/api.py`:
  - Canalizar los nuevos parámetros de coordenadas desde la invocación RPC hacia `render_flat_clip`.

---

## 3. Paso a Paso Técnico

### Paso 1: Backend (`python_backend/media.py` y `api.py`)
1. En `generate_ass_subtitles`:
   - Añadir argumentos: `pos_x: Optional[int] = None`, `pos_y: Optional[int] = None`, `font_size: Optional[int] = None`, `align_h: str = "center"`.
   - Si `pos_x` y `pos_y` se suministran: inyectar el tag `{\\an5\\pos({pos_x},{pos_y})}` en cada línea de diálogo, fijando el anclaje subpixel exacto.
   - Si no se suministran, mantener el cálculo tradicional con `position` y `margin_v` para total retrocompatibilidad.
2. En `generate_cta_badge_image`:
   - Añadir parámetro `scale_factor: float = 1.0`.
   - Corregir el offset del emoji: compensar `min(0, bbox_e[0])` y añadir 6px adicionales de padding perimetral para que el corazón nunca roce el contorno.
3. En `render_flat_clip`:
   - Aceptar `cta_x: Optional[int] = None`, `cta_y: Optional[int] = None` y `cta_scale: Optional[float] = None`.
   - En las cadenas de overlay FFmpeg:
     - Si `cta_x` y `cta_y` están definidos: `overlay=x='{cta_x}-w/2':y='{cta_y}-h/2'`.
     - Si no, usar las posiciones por defecto ("top", "center", "bottom").
4. En `python_backend/api.py`:
   - Extraer `captionX`, `captionY`, `captionFontSize`, `captionAlignH`, `ctaX`, `ctaY`, `ctaScale` en `render_flat_clip_for_candidate` y propagarlos.

### Paso 2: Frontend (`CandidatePreviewModal.tsx`, `ModalContainer.tsx`, `useMediaPipeline.ts`)
1. **Unificación de Ajustes de Trim:**
   - Sincronizar: al cambiar `trimStart` o `trimEnd` mediante los botones `+5s/-5s`, actualizar el primer segmento (`start`) y el último segmento (`end`).
   - Mover el bloque "Restablecer Original" y "Guardar Ajuste" al fondo de la pestaña Trim.
   - Al pulsar "Guardar Ajuste", guardar en base de datos (`onSaveTrim`) y en `localStorage` los segmentos y rangos actualizados.
2. **Panel de Transformación para Subtítulos (Pestaña 2):**
   - Mini-toolbar de presets: "Arriba", "Centro", "Streamer Elevado", "Abajo".
   - Controles numéricos y sliders:
     - **Posición X:** `540 px` (slider 0 a 1080) + botón centrar.
     - **Posición Y:** `1680 px` (slider 0 a 1920).
     - **Tamaño:** `62 px` (slider 36 a 88).
     - **Alineación:** Izq / Centro / Der.
3. **Panel de Transformación para CTA (Pestaña 3):**
   - Mini-toolbar de presets: "Arriba" (180), "Medio" (960), "Abajo" (1550).
   - Controles numéricos y sliders:
     - **Posición X:** `540 px` (slider 0 a 1080) + botón centrar.
     - **Posición Y:** `280 px` (slider 0 a 1920).
     - **Escala:** `100%` (slider 70% a 140%).
4. **Previsualización 1:1 en Smartphone:**
   - El lienzo muestra los subtítulos en `left: (captionX / 1080) * 100%`, `top: (captionY / 1920) * 100%`, `transform: translate(-50%, -50%)`, con el tamaño escalado proporcionalmente al canvas de preview.
   - El CTA se muestra en `left: (ctaX / 1080) * 100%`, `top: (ctaY / 1920) * 100%`, `transform: translate(-50%, -50%) scale(...)`.
   - Lo que el usuario ve en pantalla es 100% idéntico al renderizado de FFmpeg.
5. **Botones de Footer:**
   - Cambiar "Descartar" por "Cerrar".
   - Añadir botón "Descartar momento" con confirmación rápida y llamada a `onToggleDismissed`.

### Paso 3: Testing y Verificación Integral
- Crear tests unitarios en `scratch/test_subtitle_custom_position_unit.py` y `scratch/test_cta_badge_fix_unit.py`.
- Ejecutar la suite completa de tests de AutoShorts (100% verde).
- Compilar frontend con `pnpm run build`.
- Reconstruir distribución portable con `python build_portable.py` y sincronizar en el escritorio.

---

## 4. Riesgos e Implicaciones

| Riesgo | Mitigación |
|---|---|
| Coordenadas X/Y fuera de pantalla si el usuario ingresa valores extremos | Se limitan los rangos (clamps) en UI (X: 50 a 1030, Y: 50 a 1870) para mantener siempre el contenido visible |
| Compatibilidad con clips previamente guardados sin coordenadas explícitas | Si `captionX` o `captionY` no existen, se usan los valores por defecto exactos (retrocompatibilidad 100%) |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- **Archivos:** `scratch/test_subtitle_custom_position_unit.py` y `scratch/test_cta_badge_fix_unit.py`.
- **Casos:**
  - Verificación del tag `\pos(X, Y)` y anclaje en el script ASS generado.
  - Verificación de padding perimetral del emoji en la pastilla PNG sin cortes de píxeles.
  - Sincronización matemática de `trimStart`/`trimEnd` con los límites de los segmentos.

### Nivel 2: Tests de Integración
- **Archivo:** `scratch/test_custom_overlay_render_integration.py`.
- **Casos:**
  - Renderizado real de video con FFmpeg usando coordenadas personalizadas $(X=540, Y=1420)$ para subtítulos y $(X=540, Y=300)$ para CTA.
  - Verificación de que FFmpeg genera el archivo `.mp4` con código de retorno 0.

### Nivel 3: Tests E2E y Suite Completa
- Ejecución de la suite completa de tests (26+ tests).
- Verificación del 100% de tests aprobados.
- Compilación de producción con `pnpm run build`.

---

## 6. Skills del Workspace Aplicadas

- **`senior-code-craft`**: Arquitectura limpia para posicionamiento absoluto con tags de libass y overlays de FFmpeg.
- **`ui-ux-pro-max` & `antislop-ui`**: Diseño de paneles de control NLE (estilo Premiere Pro / OBS) con coordenadas X/Y en tiempo real, sliders táctiles y feedback instantáneo.
- **`antislop-code`**: Código limpio y tipado robusto sin slop.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan requiere tu autorización formal antes de ejecutar cambios de código o compilación.
> Para proceder, responde exactamente: **`PLAN APROBADO`**.
