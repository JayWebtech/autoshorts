# Plan 29 — Auditoría Senior: Corrección de Edge Cases, Sincronización en Lote, Persistencia y Pulido Antislop

## 1. Diagnóstico

Tras una inspección exhaustiva de nivel Senior sobre el estado del frontend React 19 y el backend Python 3.11 posterior a las entregas de los planes 1 a 28, y validada mediante auditoría en frío con subagentes Goldfish independientes (`egm-codebase-details` y `egm-implementation-readiness`), se identificaron y acotaron los siguientes 9 puntos críticos de robustez, consistencia y experiencia de usuario:

1. **Descalibración en Corte en Lote (`cutSelected` en `useMediaPipeline.ts`):**
   - Mientras que `cutCandidate` (corte individual) envía de forma completa los parámetros finos de renderizado (`captionColor`, `captionHighlight`, `captionLines`, `captionX`, `captionY`, `captionFontSize`, `captionAlignH`, `ctaX`, `ctaY`, `ctaScale`, `subRanges`, `startSec`, `endSec`), la función `cutSelected` (corte en lote desde la cabecera) omite la totalidad de estas coordenadas, estilos y cortes internos por candidato. Como resultado, si un creador ajusta subtítulos, CTA o recorta fragmentos internos y luego pulsa "Cortar (N)", los clips se renderizan descalibrados y con valores por defecto.
2. **Candidatos Descartados Persisten en Selección en Lote y Re-selección por Slider (`useMediaPipeline.ts`, `CandidatePanel.tsx`, `db.py`):**
   - El selector `selectedCandidates` y el contador `selectedCount` filtran únicamente `candidate.selected`, sin verificar `!candidate.dismissed`.
   - Al descartar un candidato (`toggleCandidateDismissed` en frontend y backend), su flag `selected` no se limpia.
   - En `python_backend/db.py`, la función `set_selected_clip_count` no excluye `dismissed = 1`, por lo que al usar el slider de selección se re-seleccionaban candidatos previamente descartados.
3. **Condición de Carrera Asíncrona en React al Guardar Trim (`CandidatePreviewModal.tsx`, `useMediaPipeline.ts`):**
   - En el modal de previsualización, al hacer clic en "Guardar Ajuste", se ejecutaba `setTrimStart(newStart)` y `setTrimEnd(newEnd)` seguido de `await onSaveTrim()`. Debido a la naturaleza asíncrona de React, `saveCandidateTrim` leía las variables de estado anteriores en su closure, provocando que se guardaran valores desfasados en base de datos.
4. **Cierre Silencioso del Modal ante Error de FFmpeg (`useMediaPipeline.ts`, `CandidatePreviewModal.tsx`):**
   - `cutCandidate` captura internamente cualquier error con `catch (err) { setError(...) }` pero no re-lanzaba la excepción (`throw err`). La promesa de `onCutCandidate` se resolvía exitosamente, lo que provocaba que el modal se cerrara de inmediato mediante `onClose()` y ocultara el error al usuario en lugar de mostrar la pastilla de error en el footer.
5. **Estado Inconsistente en Base de Datos y Fuga de Temporales en Exportación (`python_backend/api.py`):**
   - En `render_flat_clip_for_candidate`, el clip se marca como `status="cutting"`. Si FFmpeg arroja una excepción, el estado nunca se actualizaba a `"error"`, quedando permanentemente bloqueado en `"cutting"`.
   - Los archivos temporales intermedios `*_cta.png` y `*.ass` quedaban abandonados en la carpeta de clips del usuario tras el renderizado.
6. **Inaccesibilidad del Control de Volumen de Selección en la Pestaña por Defecto (`CandidatePanel.tsx`):**
   - El slider de selección para elegir cuántos clips cortar (`updateClipCount`) sólo estaba visible cuando `filterTab === "all"`. Sin embargo, la aplicación abre por defecto en `"pending"`, impidiendo al creador ajustar el número de clips a cortar desde su vista principal de trabajo.
7. **Antislop UI Residual en `CandidatePreviewModal.tsx`:**
   - Persistencia de emojis decorativos no profesionales en selectores de aspect ratio (`🎞️`, `🖥️`, `📱`), estilos de subtítulos (`🔥`, `🎮`, `💻`, `🟡`, `🟨`), presets de llamada a la acción (`🔥`, `🔔`, `💬`), animaciones (`💥`, `💓`) y badges (`✨`, `⚡`, `♡`, `✦`).
8. **Claridad Diagnóstica ante LM Studio sin Modelo Cargado (`python_backend/llm.py`):**
   - Cuando el servidor local de LM Studio está activo pero no hay ningún modelo cargado en memoria, responde con HTTP 400 (`"No model loaded"`), arrojando un error crudo en la interfaz en lugar de un mensaje guiado que indique al usuario cargar su modelo o usar el botón "Cargar RAM".
9. **Sincronización Continua de `autoshorts.project` en Disco:**
   - La persistencia del archivo de proyecto `autoshorts.project` no se disparaba tras `update_candidate_trim`, `toggle_candidate_dismissed` ni al finalizar `render_flat_clip_for_candidate`.

---

## 2. Alcance

- `python_backend/db.py`:
  - Descarte atómico con deselección automática en `toggle_candidate_dismissed`.
  - Exclusión de candidatos descartados (`AND (dismissed = 0 OR dismissed IS NULL)`) en `set_selected_clip_count`.
- `python_backend/api.py`:
  - Manejo robusto de errores con `try...except...finally` en `render_flat_clip_for_candidate`, marcado en SQLite a `status="error"` ante fallos.
  - Limpieza puntual y segura de temporales de trabajo (`badge_file` y `exported_ass_path`) mediante `unlink(missing_ok=True)`.
  - Sincronización a disco de `autoshorts.project` tras exportar clip, tras actualizar trim y tras descartar/restaurar candidato (obteniendo el `project_id` correspondiente).
- `python_backend/llm.py`:
  - Captura y traducción semántica de errores HTTP 400 (`"No model loaded"`) en `call_lmstudio` y `generate_social_copy_with_llm`.
- `src/hooks/useMediaPipeline.ts`:
  - Exclusión estricta de descartados en `selectedCandidates` y `selectedCount` (`candidate.selected && !candidate.dismissed`).
  - Deselección reactiva inmediata en `toggleCandidateDismissed`.
  - Firma consistente en `saveCandidateTrim(startSec?: number, endSec?: number, candidateId?: string)`.
  - Recuperación defensiva completa de coordenadas, colores, escala y cortes específicos por candidato en `cutSelected`.
  - Re-lanzamiento de excepción (`throw err`) en `cutCandidate` para permitir al modal interceptar el error sin cerrarse.
- `src/components/modals/CandidatePreviewModal.tsx`:
  - Actualización de interfaz: `onSaveTrim: (startSec?: number, endSec?: number) => Promise<void>`.
  - Invocación síncrona `await onSaveTrim(newStart, newEnd)` al hacer clic en "Guardar Ajuste".
  - Erradicación integral de emojis y símbolos decorativos según `antislop-ui`.
- `src/components/modals/ModalContainer.tsx`:
  - Actualización de interfaz: `onSaveTrim: (startSec?: number, endSec?: number) => Promise<void>`.
- `src/components/panels/CandidatePanel.tsx`:
  - Visualización del slider de selección de clips tanto en pestaña "Pendientes" como en "Todos", con límite dinámico `max={activeCandidates.length}`.
  - Manejo de promesa con `.catch(() => {})` en botón de corte directo de la tarjeta para prevenir `UnhandledPromiseRejection`.
- `scratch/test_plan29_unit.py`:
  - Suite de tests unitarios y de integración deterministas (aislados con `unittest.mock.patch`, offline, sin GPU).

---

## 3. Paso a Paso Técnico

### Paso 1: Base de Datos y Descarte Atómico (`python_backend/db.py`)
1. En `toggle_candidate_dismissed`:
   - Modificar la sentencia SQL para limpiar `selected` automáticamente al descartar:
     ```sql
     UPDATE candidates SET dismissed = ?, selected = CASE WHEN ? = 1 THEN 0 ELSE selected END WHERE id = ?
     ```
2. En `set_selected_clip_count`:
   - Modificar la subconsulta para excluir candidatos descartados al mover el slider de selección:
     ```sql
     UPDATE candidates SET selected = 1 WHERE id IN (
         SELECT id FROM candidates WHERE project_id = ? AND (dismissed = 0 OR dismissed IS NULL) ORDER BY rank ASC LIMIT {count}
     )
     ```

### Paso 2: Resiliencia de Exportación, Limpieza de Temporales y Persistencia (`python_backend/api.py`)
1. En `render_flat_clip_for_candidate`:
   - Inicializar explícitamente `badge_file: Optional[Path] = None` y `exported_ass_path: Optional[Path] = None` antes del bloque de ejecución.
   - Envolver el renderizado en `try...except...finally`:
     - En `except Exception as e`: registrar error en `log_buffer`, actualizar en SQLite `self.db.update_clip_for_candidate(candidate_id, "error")` y re-lanzar `raise`.
     - En `finally`: eliminar de forma segura los archivos temporales específicos si existen en disco:
       ```python
       if badge_file and badge_file.exists():
           badge_file.unlink(missing_ok=True)
       if exported_ass_path and exported_ass_path.exists():
           exported_ass_path.unlink(missing_ok=True)
       ```
     - Tras éxito, invocar `sync_project_to_disk(self.db, project["id"])` para que el archivo `autoshorts.project` registre el nuevo clip generado.
2. En `update_candidate_trim`:
   - Obtener `candidate, project = self.db.get_candidate_with_project(candidate_id)` e invocar `sync_project_to_disk(self.db, project["id"])`.
3. En `toggle_candidate_dismissed`:
   - Obtener `candidate, project = self.db.get_candidate_with_project(candidate_id)` e invocar `sync_project_to_disk(self.db, project["id"])`.

### Paso 3: Diagnóstico Amigable de LM Studio (`python_backend/llm.py`)
1. En `call_lmstudio`:
   - Detectar si `not resp.ok` y `err_text` contiene `"No model loaded"` o `"no model is loaded"` o `"Model not loaded"`:
     ```python
     if "no model" in err_text.lower() or "not loaded" in err_text.lower():
         raise ModelFatalError("No hay ningún modelo cargado en memoria en LM Studio. Abre LM Studio y carga tu modelo preferido o presiona 'Cargar RAM'.")
     ```
2. En `generate_social_copy_with_llm`:
   - Aplicar el mismo chequeo ante fallos HTTP 400 en peticiones directas de copy a LM Studio.

### Paso 4: Robustecimiento del Hook en Frontend (`src/hooks/useMediaPipeline.ts`)
1. En `selectedCandidates` y `selectedCount`:
   - `selectedCandidates = useMemo(() => detail?.candidates.filter((c) => c.selected && !c.dismissed) ?? [], [detail?.candidates]);`
   - `selectedCount = useMemo(() => selectedCandidates.length, [selectedCandidates]);`
2. En `toggleCandidateDismissed`:
   - Al actualizar localmente el array `candidates`, si `dismissed === true`, forzar `selected: false`.
3. En `saveCandidateTrim`:
   - Definir firma `(startSec?: number, endSec?: number, candidateId?: string)`.
   - Utilizar `candidateId || previewCandidate?.id`, y para los timestamps utilizar los parámetros directos si están definidos (`startSec !== undefined ? startSec : trimStart`).
4. En `cutSelected`:
   - Determinar `isVert` según `aspectRatio` y dimensiones del proyecto con sufijo `_v` o `_h`.
   - Para cada candidato en `selectedCandidates`:
     - Recuperar coordenadas guardadas en `localStorage` (`autoshorts_caption_x${suffix}`, `autoshorts_caption_y${suffix}`, `autoshorts_cta_x${suffix}`, etc.) con fallbacks proporcionales idénticos a `cutCandidate`.
     - Recuperar `rawSegments = localStorage.getItem("autoshorts_candidate_segments_" + candidate.id)`.
     - Si existen segmentos válidos: calcular `activeSubRanges = segments.filter(s => !s.deleted)`.
     - Determinar `effStart = activeSubRanges[0]?.start ?? candidate.startSec` y `effEnd = activeSubRanges[activeSubRanges.length - 1]?.end ?? candidate.endSec`.
     - Pasar `subRanges: activeSubRanges.length > 1 ? activeSubRanges : undefined`.
     - Pasar todas las opciones completas a `render_flat_clip_for_candidate`.
5. En `cutCandidate`:
   - En el bloque `catch (err)`: tras `setError(...)`, re-lanzar `throw err` para que el llamador pueda interceptar el fallo.

### Paso 5: Contratos de Tipos y Antislop UI en Modales (`CandidatePreviewModal.tsx`, `ModalContainer.tsx`)
1. En `ModalContainer.tsx`:
   - Actualizar prop `onSaveTrim: (startSec?: number, endSec?: number) => Promise<void>;`.
2. En `CandidatePreviewModal.tsx`:
   - Actualizar prop en `CandidatePreviewModalProps`: `onSaveTrim: (startSec?: number, endSec?: number) => Promise<void>;`.
   - En el botón "Guardar Ajuste": invocar `await onSaveTrim(newStart, newEnd)`.
   - Erradicar emojis decorativos:
     - Aspect ratio: cambiar `🎞️ Original`, `🖥️ 16:9`, `📱 9:16` por `Original`, `16:9`, `9:16`.
     - Animación de subtítulos: `Loud Viral (3D Impact)`, `Arcade Retro (Gaming Neón)`, `Cyber Terminal (Monospace)`, `TikTok Karaoke (Palabra Resaltada)`, `Clean Editorial (Elegante & Suave)`, `Clásico Contorno (Amarillo y Negro)`.
     - Presets de CTA: texto limpio `¡Sígueme y dale like!`, `¡Apóyame con tu follow!`, `¡Suscríbete para más clips!`, `¡Comenta qué opinas!`.
     - Animación de CTA: `Impacto Dinámico (Bounce Land)`, `Latido Neón (Pulse Glow)`, `Desplazamiento Suave (Slide Up)`, `Fundido Suave (Fade Smooth)`.
     - Purgar caracteres decorativos `✨`, `⚡`, `♡`, `✦` en etiquetas y badges.

### Paso 6: Accesibilidad del Slider y Manejo de Promesas en Panel (`CandidatePanel.tsx`)
1. Renderizar el control deslizante de selección N (`updateClipCount`) cuando `filterTab === "all" || filterTab === "pending"`.
2. Configurar el slider con `max={activeCandidates.length}` y conteo `{selectedCount} / {activeCandidates.length}`.
3. En el botón de corte directo de cada candidato, envolver la invocación:
   `onClick={() => { void cutCandidate(candidate.id).catch(() => {}); }}`.

---

## 4. Riesgos y Mitigaciones (Auditoría Goldfish)

- **Riesgo:** Inversión de parámetros en `saveCandidateTrim(startSec, endSec)`.
  - **Mitigación:** Ambos subagentes confirmaron que el orden `(startSec?, endSec?, candidateId?)` previene la asignación accidental de números flotantes al ID y garantiza retrocompatibilidad sin argumentos.
- **Riesgo:** Fallos de compilación TypeScript `TS2554`.
  - **Mitigación:** Inclusión explícita de `ModalContainer.tsx` y actualización estricta de las interfaces de props a `(startSec?: number, endSec?: number) => Promise<void>`.
- **Riesgo:** Re-selección involuntaria de descartados al mover el slider.
  - **Mitigación:** Inclusión de `AND (dismissed = 0 OR dismissed IS NULL)` en la query de `db.py`.
- **Riesgo:** Pérdida de archivos en limpieza de temporales.
  - **Mitigación:** Limpieza por referencia única (`badge_file.unlink()` y `exported_ass_path.unlink()`), sin uso de patrones globales (`glob`).
- **Riesgo:** Lentitud o fallo con `NaN` en `cutSelected`.
  - **Mitigación:** Guardas defensivas completas en parseo de `localStorage`, validación de `activeSubRanges.length > 1` y cálculo de sufijos de orientación `_v`/`_h`.

---

## 5. Estrategia de Testing

- **Tests Unitarios y de Integración (`scratch/test_plan29_unit.py`):**
  1. **Descarte Atómico:** Validar que al marcar `toggle_candidate_dismissed(id, True)` en SQLite, `dismissed = 1` y `selected = 0`.
  2. **Protección en Slider:** Validar que `set_selected_clip_count` no re-seleccione candidatos con `dismissed = 1`.
  3. **Manejo de Error en Exportación:** Con `unittest.mock.patch("python_backend.api.render_flat_clip", side_effect=RuntimeError("FFmpeg test failure"))`, verificar que el clip transiciona a `status="error"` y no permanece en `"cutting"`.
  4. **Limpieza de Temporales:** Verificar que tras ejecución exitosa o fallida, los archivos temporales `.ass` y `_cta.png` se eliminen del directorio mientras el `.mp4` y `.srt` se conservan.
  5. **Sincronización a Disco:** Validar que `update_candidate_trim` y `toggle_candidate_dismissed` actualicen el archivo `autoshorts.project`.
  6. **Captura 400 en LM Studio:** Con `unittest.mock.patch("requests.post")` simulando HTTP 400 (`"No model loaded"`), validar que `call_lmstudio` lanza `ModelFatalError` con mensaje claro y accionable.
- **Validación de Suite Completa:**
  - Ejecutar `python scratch/run_all_tests.py` (garantizando 100% verde).
  - Ejecutar `python -m unittest discover tests`.
- **Compilación E2E:**
  - Compilación frontend limpia sin errores TypeScript: `cmd.exe /c "pnpm run build"`.
  - Empaquetado portable con `python build_portable.py` y sincronización a la distribución de escritorio.
