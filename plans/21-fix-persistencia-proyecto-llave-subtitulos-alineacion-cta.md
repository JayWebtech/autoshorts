# Plan 21: Auto-Apertura del Último Proyecto, Eliminación de '}' Parásito en Subtítulos y Alineación Métrica del Emoji en CTA

## 1. Diagnóstico

A partir del feedback del usuario y la captura adjunta (`media_1793584114808_cf145fb0.jpg`), se identifican tres causas raíz específicas:

### 1. El proyecto no se abre automáticamente al reiniciar AutoShorts
- **Causa Raíz:** En `src/App.tsx`, al montar el componente, se invoca `projectActions.refresh()` sin argumentos. En `src/hooks/useProjectActions.ts` (línea 57), cuando `nextProjectId` no viene definido, la función ejecuta explícitamente `setDetail(null)`. Aunque el proyecto está guardado en SQLite (`data/autoshorts.db`) y en su archivo `autoshorts.project`, la interfaz arranca en estado vacío ("sin proyecto seleccionado"), forzando al usuario a volver a seleccionarlo o importarlo.
- **Solución:** Persistir en `localStorage` la clave `autoshorts_last_active_project_id` cada vez que se selecciona o refresca un proyecto. Al iniciar (`refresh()`), si no se suministra un ID explícito, buscar si el último proyecto activo sigue existiendo en `projectList`; de lo contrario, cargar automáticamente el proyecto más reciente (`projectList[0].id`). Así, la app reanuda exactamente donde el usuario la dejó (comportamiento idéntico a Premiere Pro y CapCut).

### 2. Carácter '}' parásito en los subtítulos renderizados (`BUENO} UN M700`)
- **Causa Raíz:** En `python_backend/media.py` (líneas 1053-1059), al formatear las palabras de karaoke en `tiktok-karaoke` y otros estilos, se incluyó `{pos_tag}` dentro de la cadena de reset:
  `words_text.append(f"{{\\fscx122\\fscy122\\c{highlight_color}}}{display_w}{{\\rAutoStyle\\fscx100\\fscy100{pos_tag}{fs_tag}}}")`
  Dado que `pos_tag` ya contiene llaves `{\an5\pos(X, Y)}`, se formaba una llave anidada `{\rAutoStyle...{\an5\pos(...)}}`. En el estándar ASS de libass, al encontrar el primer `}` que cierra `\pos`, libass da por terminado el bloque de control; el segundo `}` sobrante queda fuera del tag y se dibuja en el video como texto literal visible en pantalla (`BUENO}`).
- **Solución:**
  1. En `generate_ass_subtitles`: `pos_tag` y `fs_tag` son directivas de nivel de evento (Dialogue) y ya están colocadas al inicio de la línea `Dialogue: 0,...,AutoStyle,,0,0,0,,{pos_tag}{fs_tag}{text_line}`.
  2. Eliminar `{pos_tag}` y `{fs_tag}` de las cadenas internas de palabras individuales en `words_text`, dejando el reseteo limpio: `{\rAutoStyle\fscx100\fscy100}` para la palabra activa y `{\rAutoStyle}` para cyber-terminal / hero words. Esto suprime de raíz cualquier llave huérfana en pantalla.

### 3. El emoji del CTA (`❤️`) no está alineado verticalmente con el texto
- **Causa Raíz:** En `python_backend/media.py` (`generate_cta_badge_image`), se medían los bounding boxes pero al dibujar:
  - El emoji se dibujaba en `pad_y - int(3 * scale * ss)`, mientras el texto se dibujaba en `pad_y`.
  - La fuente de emoji (`seguiemj.ttf`) tiene una métrica vertical diferente a la de texto (`segoeuib.ttf`): en las pruebas reales, el glyph del corazón comienza en `top = 1`, mientras el texto comienza en `top = 23`. Al no compensar `bbox[1]`, el texto quedaba más de 20 píxeles más abajo que el corazón.
  - Además, se sumaba un espaciado horizontal artificial excesivo entre el emoji y el texto, generando un hueco desproporcionado.
- **Solución — Alineación Métrica Subpixel:**
  1. Calcular la altura visual real de cada elemento: `emoji_h = bbox_e[3] - bbox_e[1]` y `text_h = bbox_t[3] - bbox_t[1]`.
  2. Centrar verticalmente ambos elementos respecto a `total_h` compensando sus offsets internos de glyph:
     - `emoji_draw_y = (total_h - emoji_h) // 2 - bbox_e[1]`
     - `text_draw_y = (total_h - text_h) // 2 - bbox_t[1]`
     Ambos tendrán su centro visual exactamente en `total_h / 2`.
  3. Establecer un espaciado horizontal calibrado `gap_x = int(8 * scale * ss)` entre el borde derecho real del emoji y el inicio del texto.

---

## 2. Alcance

### Archivos Backend:
- `python_backend/media.py`:
  - En `generate_ass_subtitles`: limpiar `words_text` eliminando `{pos_tag}` y `{fs_tag}` anidados en los tags de reset inline de karaoke.
  - En `generate_cta_badge_image`: implementar centrado vertical métrico por bounding box y espaciado horizontal calibrado.

### Archivos Frontend:
- `src/hooks/useProjectActions.ts`:
  - En `refresh`: auto-cargar el último proyecto activo guardado en `localStorage`, o el primer proyecto de `projectList` si existe.
  - En `selectProject`: actualizar o limpiar `localStorage.setItem("autoshorts_last_active_project_id", projectId)`.

---

## 3. Paso a Paso Técnico

### Paso 1: Corrección en Subtítulos ASS (`python_backend/media.py`)
1. Revisar `generate_ass_subtitles`:
   - En las líneas donde se procesa `supports_karaoke`:
     - Sustituir `{{\\rAutoStyle\\fscx100\\fscy100{pos_tag}{fs_tag}}}` por `{{\\rAutoStyle\\fscx100\\fscy100}}`.
     - Sustituir `{{\\rAutoStyle{pos_tag}{fs_tag}}}` por `{{\\rAutoStyle}}`.
   - Verificar que `{pos_tag}` y `{fs_tag}` se ubiquen únicamente una vez al principio del evento Dialogue:
     `Dialogue: 0,{start},{end},AutoStyle,,0,0,0,,{pos_tag}{fs_tag}{text_line}`

### Paso 2: Corrección Métrica en Insignia CTA (`python_backend/media.py`)
1. En `generate_cta_badge_image`:
   - Extraer métricas exactas:
     - `emoji_w = bbox_e[2] - bbox_e[0]`, `emoji_h = bbox_e[3] - bbox_e[1]`
     - `text_w = bbox_t[2] - bbox_t[0]`, `text_h = bbox_t[3] - bbox_t[1]`
   - Calcular dimensiones de la pastilla:
     - `content_h = max(emoji_h, text_h)`
     - `total_h = content_h + pad_y * 2`
     - `gap_x = int(8 * scale * ss)` si hay emoji, `0` si no
     - `total_w = pad_x * 2 + (emoji_w + gap_x if emoji_part else 0) + text_w`
   - Dibujar con centrado métrico:
     - `emoji_draw_x = pad_x - bbox_e[0]`
     - `emoji_draw_y = (total_h - emoji_h) // 2 - bbox_e[1]`
     - `text_draw_x = pad_x + (emoji_w + gap_x if emoji_part else 0) - bbox_t[0]`
     - `text_draw_y = (total_h - text_h) // 2 - bbox_t[1]`

### Paso 3: Auto-Apertura del Proyecto al Iniciar (`src/hooks/useProjectActions.ts`)
1. En `refresh(nextProjectId?)`:
   - Si `nextProjectId` no viene especificado, consultar `localStorage.getItem("autoshorts_last_active_project_id")`.
   - Si existe en `projectList`, usarlo como objetivo. Si no, pero `projectList.length > 0`, usar `projectList[0].id`.
   - Obtener detalle con `get_project_detail` y asignar `setDetail(nextDetail)`.
2. En `selectProject(projectId)`:
   - Si `projectId` es `null`, remover de `localStorage`.
   - Si es válido, guardar en `localStorage`.

### Paso 4: Pruebas y Verificación Integral
1. Crear test unitario `scratch/test_no_stray_closing_brace_unit.py` verificando que ninguna línea de diálogo ASS contenga `}` literal tras las palabras.
2. Actualizar `scratch/test_cta_badge_fix_unit.py` para validar la alineación vertical de centroides entre el emoji y el texto.
3. Crear test de integración `scratch/test_auto_restore_last_project_unit.py`.
4. Ejecutar la suite completa de 28 tests (100% verde).
5. Compilar frontend con `pnpm run build`, empaquetar portable con `python build_portable.py` y sincronizar en el escritorio.
6. Registrar decisión D-022 en `DECISIONS.md`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Mitigación |
|---|---|
| Proyecto borrado o disco desconectado al intentar auto-abrir | `refresh` envuelve `get_project_detail` en un bloque `try/catch`. Si el proyecto falla, hace fallback a `setDetail(null)` sin quebrar la app. |
| Fuentes de sistema sin emoji en Linux/macOS | Si `seguiemj.ttf` no existe, se mantiene el fallback a `text_font` con el mismo cálculo métrico seguro. |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- **Subtítulos sin llaves:** `scratch/test_no_stray_closing_brace_unit.py` procesará fragmentos de texto en todos los estilos (`tiktok-karaoke`, `loud-viral`, `arcade-retro`, `cyber-terminal`, `clean-editorial`) con coordenadas custom activas y validará que en el texto de las palabras nunca aparezca el caracter `}` fuera de tags.
- **Alineación CTA:** `scratch/test_cta_badge_fix_unit.py` verificará que `abs(emoji_center_y - text_center_y) <= 1.0` pixel.

### Nivel 2: Tests de Integración
- **Persistencia de Proyecto:** `scratch/test_auto_restore_last_project_unit.py` simulará el ciclo de `list_projects` y recuperación de detalle sin suministrar ID explícito.

### Nivel 3: Suite Completa de AutoShorts
- Ejecutar los 28 tests con el runner automatizado y verificar 100% pasando.
- Compilación de producción con `pnpm run build` y validación de bundle.

---

## 6. Skills del Workspace Aplicadas
- **`senior-code-craft`**: Depuración profunda del analizador léxico de libass y resolución de discrepancias métricas en fuentes TrueType.
- **`antislop-ui`**: Alineación tipográfica precisa a nivel de píxel y flujo de experiencia sin fricción al abrir la app.
- **`antislop-code`**: Código robusto sin comentarios innecesarios.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan requiere tu autorización formal antes de ejecutar cambios de código o compilación.
> Para proceder, responde exactamente: **`PLAN APROBADO`**.

