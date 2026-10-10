# Documento de Diseño: Motor de AutoEdición con IA (Rough Cut / A-Roll Ensamblado)

**Fecha:** 2026-09-25  
**Estado:** Aprobado  
**Objetivo:** Permitir que AutoShorts procese streams largos (2 a 4 horas) y genere automáticamente un video base (.mp4) estructurado narrativamente (YouTube 16:9 o TikTok 9:16) con poda opcional de silencios (jump-cuts), dejándole el trabajo pesado (Rough Cut / A-Roll) completamente resuelto al editor.

---

## 1. Contexto y Objetivos

### Problema
Actualmente, la herramienta detecta clips aislados o permite concatenar momentos simples. Un editor de video humano que enfrenta un stream de varias horas necesita mucho más que clips sueltos: necesita un corte en bruto estructurado, sin tiempos muertos, con un gancho inicial y organizado de forma lógica.

### Decisiones de Diseño
- **No convertir la app en un editor no lineal pesado:** Evitar la sobrecarga computacional de herramientas como Premiere o CapCut (zooms, subtítulos complejos, tracking de facecam se dejan para la post-producción).
- **Enfoque en el A-Roll / Rough Cut:** Extraer la narrativa principal, podar pausas muertas y ensamblar un único archivo `.mp4` listo para que el editor añada música, subtítulos y efectos.
- **Sin emojis en la interfaz:** Uso estricto de iconos vectoriales limpios (Lucide icons).
- **Descarte de XML/EDL:** Para evitar problemas de compatibilidad y versiones de Premiere/DaVinci, la entrega se realiza en un único archivo MP4 de alta fidelidad más un archivo de texto con capítulos.

---

## 2. Experiencia de Usuario (UI/UX)

### Punto de Entrada
- En `WorkspaceHeader`, se renueva la acción principal a: `AutoEdición con IA` (icono `Zap` o `Scissors`).

### Modal de AutoEdición (`AutoEditModal`)
1. **Selector de Formato Destino:**
   - **Modo YouTube (16:9 Horizontal):** Optimizado para videos de resumen o episodios completos.
   - **Modo Shorts / TikTok (9:16 Vertical):** Optimizado para compilaciones de alto impacto en formato vertical.
2. **Presets de Duración Objetivo:**
   - Para YouTube: `8m`, `12m`, `15m`, `20m`.
   - Para Shorts: `60s`, `2m`, `3m`.
3. **Opciones Inteligentes (Toggles):**
   - `Hook Teaser Inicial (3 a 5 seg)`: Coloca el momento de mayor impacto al inicio como gancho.
   - `Poda de Silencios Muertos`: Elimina pausas sin voz ni acción mayores a 1.8 segundos generando jump-cuts dinámicos.
4. **Estado y Ejecución:**
   - Barra de progreso con etapas claras:
     - Etapa 1: Planificando guion narrativo con IA...
     - Etapa 2: Podando silencios y pausas muertas...
     - Etapa 3: Ensamblando video con FFmpeg...
   - Botón de cancelación que aborta el proceso y limpia archivos temporales inmediatamente.

---

## 3. Arquitectura del Backend

### 3.1. Inteligencia Narrativa (`python_backend/llm.py`)
- Función: `plan_autoedit_narrative(candidates, target_duration_minutes, format_mode, include_teaser)`
- Lee la transcripción y los momentos detectados en el stream.
- Identifica el momento con mayor score de retención para extraer el `teaser_hook` (3 a 5 segundos).
- Selecciona los segmentos de la historia asegurando cubrir la duración objetivo sin redundancias.
- Devuelve la estructura JSON ordenada con marcas de tiempo precisas.

### 3.2. Poda de Silencios y Ensamble (`python_backend/media.py`)
- Función: `detect_dead_air_silences(source_path, start_sec, end_sec, min_silence_dur=1.8, db_threshold=-32)`
  - Utiliza `ffmpeg -af silencedetect` para ubicar silencios muertos dentro de cada segmento seleccionado.
- Función: `render_autoedit_video(source_path, plan, aspect_ratio, trim_silences, output_path, progress_callback)`
  - Extrae y procesa los sub-segmentos limpios.
  - Concatena el Teaser Hook + Transición/Fundido breve + Segmentos de la historia.
  - Exporta en resolución nativa (16:9) o con recorte centrado (9:16) usando `libx264 -preset fast -crf 19 -c:a aac -b:a 192k`.

### 3.3. Entrega de Archivos
- Carpeta de salida: `autoedit/` dentro del directorio del proyecto (o directorio personalizado si fue configurado).
- Archivo de video: `AutoEdit_[YouTube|Shorts]_[Duracion]_[NombreProyecto].mp4`
- Archivo de capítulos: `AutoEdit_[YouTube|Shorts]_[Duracion]_Capitulos.txt` con marcas de tiempo formateadas para YouTube.

---

## 4. Pruebas y Validación

1. **Prueba Unitaria de Detección de Silencios:**
   - Verificar que pausas de más de 1.8s se eliminen correctamente y que la voz no se corte bruscamente (añadir márgenes de 0.15s en bordes de habla).
2. **Prueba de Planificación Narrativa con LLM:**
   - Validar que el prompt estructurado genere correctamente el `teaser_hook` y la lista de `story_segments` respetando el presupuesto de tiempo.
3. **Prueba de Cancelación y Limpieza:**
   - Validar que al pulsar cancelar se interrumpa FFmpeg y no queden archivos huérfanos temporales.
