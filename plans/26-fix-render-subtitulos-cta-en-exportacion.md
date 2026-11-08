# Plan 26: Reparación Definitiva de Renderizado de Subtítulos y CTA en Exportación de Clips (Hardware Real)

## 1. Diagnóstico y Causa Raíz

Tras una inspección exhaustiva de código, base de datos local y renderizado con FFmpeg sobre los archivos reales del usuario (`Roblox El nuevo vicio.mp4`), se identificaron **tres fallas críticas encadenadas** que causaban que los subtítulos y el CTA no aparecieran en los clips exportados:

### Causa Raíz 1: Desfase de Sistemas de Coordenadas entre Frontend y Backend en Subtítulos ASS
- **Problema:** En `CandidatePreviewModal.tsx`, el lienzo de previsualización usa un sistema de coordenadas canónico fijo de **1920x1080** (para horizontal/nativo) o **1080x1920** (para vertical). Los controles de posición envían valores absolutos basados en ese lienzo (por ejemplo, subtítulo en $Y = 920$ o $Y = 1680$).
- **Falla en Backend (`python_backend/media.py` - `generate_ass_subtitles`):** Cuando el formato era `"original"`, el backend configuraba el encabezado ASS con la resolución nativa del archivo (`PlayResX: 1280`, `PlayResY: 720` para videos 720p). Al incrustar la etiqueta de posición absoluta `\pos(960, 920)` o `\pos(540, 1680)` sobre un lienzo ASS de altura 720, **el subtítulo se renderizaba fuera de la pantalla (off-screen)**, exactamente $200\text{px}$ a $960\text{px}$ por debajo del borde inferior del video. Ningún píxel era visible para el usuario.
- **Solución:** En el estándar ASS/SSA, `PlayResX` y `PlayResY` definen el espacio de coordenadas virtual del script, y `libass` escala automáticamente todo el texto, fuentes y márgenes a la resolución real del video. El backend debe fijar siempre `PlayResX: 1920` y `PlayResY: 1080` (en horizontal) y `1080x1920` (en vertical), garantizando que las coordenadas del frontend coincidan 1:1 y se proyecten con precisión milimétrica sin importar si el video es 720p, 1080p o 4K.

### Causa Raíz 2: Falta de Escalamiento Proporcional en Posicionamiento del Badge CTA
- **Problema:** `cta_x` y `cta_y` se enviaban desde el frontend basados en el lienzo de 1920 ($X = 960$ para centrado). Al aplicarse directamente en el filtro `overlay` de FFmpeg sobre un video 1280x720, el centro real ($640\text{px}$) era ignorado y el badge se desplazaba a $X = 773\text{px}$ (esquina derecha, parcialmente recortado). Además, su duración por defecto era de apenas 2 segundos ($t = 3.0$ a $5.0\text{s}$), por lo que al reproducir el clip en cualquier punto posterior no se veía nada.
- **Solución:** Normalizar y escalar $cta_x$ y $cta_y$ en `render_flat_clip` según la relación $\frac{\text{vid\_w}}{\text{ref\_w}}$ y $\frac{\text{vid\_h}}{\text{ref\_h}}$. Asimismo, ampliar la ventana de visibilidad del badge a 5 segundos completos ($t = 1.0$ a $6.0\text{s}$) al inicio, y $4.5\text{s}$ al cierre, permitiendo apreciar nítidamente la animación ("bounce-land", "pulse-glow", etc.).

### Causa Raíz 3: Desbordamiento de Estado y Persistencia en `CandidatePreviewModal.tsx` y `useMediaPipeline.ts`
- **Problema:** En el modal de previsualización, si el usuario abría un clip tras haber usado vertical previamente, el valor de $Y = 1680$ quedaba persistido y no se truncaba a la altura del lienzo horizontal ($1080\text{px}$), mostrando en la UI la anomalía `Posición Y (0-1080): 1680px`. Además, al exportar directamente desde las tarjetas de `CandidatePanel.tsx` ("Cortar" individual o "Cortar Seleccionados"), `options` llegaba como `undefined` y no se propagaban las coordenadas ni el estado personalizado guardado en `localStorage`.
- **Solución:** Clampear defensivamente todos los valores de coordenadas ($X, Y$) a los límites del lienzo activo (`canvasWidth`, `canvasHeight`) en React. En `useMediaPipeline.ts`, leer como respaldo seguro de `localStorage` las opciones personalizadas de subtítulos y CTA cuando no se pasen explícitamente.

### Causa Raíz 4: Fallback Silencioso en `render_flat_clip`
- **Problema:** En `python_backend/media.py` (líneas 1409-1428), si FFmpeg fallaba al procesar algún filtro, el código reintentaba silenciosamente el renderizado eliminando por completo los subtítulos y el CTA, devolviendo un video limpio sin alertar al usuario.
- **Solución:** Eliminar el stripping silencioso. Si FFmpeg encuentra un error, debe registrar en los logs el error detallado y lanzar una excepción explícita con el `stderr` para garantizar transparencia total.

---

## 2. Alcance

### Archivos a modificar:
1. `python_backend/media.py`:
   - En `generate_ass_subtitles`: Fijar `res_x` y `res_y` al sistema canónico del lienzo (1080x1920 para vertical, 1920x1080 para horizontal) para que `\pos(x,y)` sea siempre visible y `libass` escale automáticamente a cualquier resolución nativa del video (720p, 1080p, etc.).
   - En `render_flat_clip`: Escalar proporcionalmente `cta_x` y `cta_y` al tamaño real del video (`vid_w`, `vid_h`) respecto al lienzo de referencia. Extender la visibilidad del CTA animado ($t = 1.0$ a $6.0\text{s}$). Eliminar el fallback que eliminaba silenciosamente los filtros.
2. `python_backend/api.py`:
   - Asegurar que `render_flat_clip_for_candidate` mantenga la sincronización de resolución y pase los parámetros escalados de forma robusta.
3. `src/components/modals/CandidatePreviewModal.tsx`:
   - Clampear defensivamente `captionX`, `captionY`, `ctaX`, `ctaY` para que nunca superen `canvasWidth` ni `canvasHeight`.
   - Ajustar los valores por defecto al alternar entre modos vertical y horizontal.
4. `src/hooks/useMediaPipeline.ts`:
   - Propagar `captionX`, `captionY`, `captionFontSize`, `captionAlignH`, `ctaX`, `ctaY`, `ctaScale` desde `localStorage` cuando se ejecute el corte masivo o directo desde la tarjeta.
5. Tests:
   - Crear `tests/test_render_subtitles_and_cta_hardware_e2e.py` para verificar con FFmpeg real sobre disco que los subtítulos y el badge CTA se renderizan e incrustan con píxeles comprobables.

---

## 3. Paso a Paso Técnico (Aplicando `senior-code-craft`)

### Paso 1: Refactorización y Blindaje en `python_backend/media.py`
- En `generate_ass_subtitles`:
  ```python
  if aspect_ratio == "9:16" or is_vertical:
      res_x = 1080
      res_y = 1920
  else:
      res_x = 1920
      res_y = 1080
  ```
  Esto garantiza que `PlayResX` y `PlayResY` coincidan con el lienzo NLE y `libass` proyecte las coordenadas de manera matemáticamente exacta sobre cualquier video (1280x720, 1920x1080, etc.).
- En `render_flat_clip`:
  ```python
  ref_w = 1080 if is_vertical else 1920
  ref_h = 1920 if is_vertical else 1080
  actual_cta_x = (int(cta_x) * vid_w) / ref_w if cta_x is not None else None
  actual_cta_y = (int(cta_y) * vid_h) / ref_h if cta_y is not None else None
  ```
  Ajustar la ventana de tiempo del CTA a $t1_{start} = 1.0\text{s}$, $t1_{end} = 6.0\text{s}$.
  Eliminar el reintento que borraba subtítulos y CTA ante fallos.

### Paso 2: Corrección de Estado y Persistencia en `CandidatePreviewModal.tsx`
- Validar y clampear en los `useEffect` y conmutadores de aspecto:
  ```ts
  const safeCapY = Math.min(canvasHeight, Math.max(0, captionY > canvasHeight ? (isEffectiveVertical ? 1680 : 920) : captionY));
  const safeCapX = Math.min(canvasWidth, Math.max(0, captionX > canvasWidth ? (isEffectiveVertical ? 540 : 960) : captionX));
  ```
- Impedir que `autoshorts_caption_y_h` persista valores superiores a 1080.

### Paso 3: Propagación de Ajustes en `useMediaPipeline.ts`
- Recuperar los valores guardados de `localStorage` para corte desde tarjetas en lote o individual:
  `captionX`, `captionY`, `ctaX`, `ctaY`, `ctaScale`, `captionFontSize`, `captionAlignH`.

### Paso 4: Pruebas Exhaustivas con Hardware y FFmpeg Real
- Ejecutar test unitario de generación de subtítulos ASS y cálculo de coordenadas.
- Ejecutar test de integración de API para verificar el flujo de corte con parámetros.
- Ejecutar test E2E con FFmpeg real sobre disco, extrayendo fotogramas y validando mediante análisis de píxeles (Pillow / NumPy) la existencia de los subtítulos coloreados y la insignia CTA.

### Paso 5: Recompilación del Release Portable
- Compilar la versión final con `npm run build` y PyInstaller para regenerar el binario portable en `dist/AutoShorts`.
- Copiar el ejecutable actualizado al Escritorio si aplica.

---

## 4. Riesgos e Implicaciones
- **Riesgo:** Videos con relaciones de aspecto no estándar (ej. 4:3 o ultra-wide 21:9).
  - *Mitigación:* Al usar `PlayResX: 1920` y `PlayResY: 1080`, `libass` preserva la relación de aspecto y ajusta los subtítulos sin distorsión. El centrado de CTA con `actual_cta_x` usa la proporción de escala directa.
- **Riesgo:** Incompatibilidad con settings antiguos en `localStorage` del navegador.
  - *Mitigación:* Se implementa un saneamiento automático en el arranque del modal que corrige cualquier valor fuera de rango ($Y > 1080$ en horizontal).

---

## 5. Estrategia de Testing (Gate de Cierre 100% Verde)

1. **Unit Tests:**
   - `tests/test_ass_subtitle_generation.py`: Verifica que `generate_ass_subtitles` produce un script ASS con `PlayResX: 1920` y `PlayResY: 1080` (en horizontal) y `1080x1920` (en vertical), sin importar la resolución nativa de entrada (720p, 1080p, 4K).
   - Verifica el posicionamiento `\pos` exacto y que no existan valores fuera de pantalla.
2. **Integration Tests:**
   - `tests/test_render_flat_clip_parameters.py`: Verifica que `render_flat_clip_for_candidate` recibe las opciones de personalización, genera los archivos `.ass` y `.png` correspondientes, y los vincula en el comando de FFmpeg.
3. **E2E Tests (Hardware Real):**
   - `tests/test_render_subtitles_and_cta_hardware_e2e.py`:
     - Renderiza un fragmento real de 10 segundos utilizando el motor FFmpeg instalado en el sistema.
     - Extrae fotogramas en $t = 2.5\text{s}$ y $t = 3.5\text{s}$.
     - Comprueba matemáticamente la presencia de píxeles de subtítulos amarillos/blancos y píxeles rojos del corazón del CTA en la imagen renderizada.
     - Verifica que la duración, codecs de audio/video y resolución del archivo MP4 final cumplan con los estándares requeridos.
4. **Validación de Toda la Suite de Tests:**
   - Ejecutar la suite completa de tests (`pytest tests/`) garantizando que todos los tests preexistentes y nuevos pasen al 100%.

