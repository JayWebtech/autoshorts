# Plan 27: Antislop UI, Refactorización de Prompts de Copy, Control Estricto de Duración y Purgado de Thinking

## 1. Diagnóstico

A partir del análisis exhaustivo del código, los registros de ejecución y las capturas reales enviadas por el usuario, se identifican con precisión las cinco necesidades críticas:

### 1.1 Detección en Gameplay con Escaso Diálogo o Poca Reacción
- **Pregunta del usuario:** ¿Cuál es la opción para gameplays donde la persona habla poco y reacciona de vez en cuando?
- **Diagnóstico:** AutoShorts **ya cuenta con un analizador acústico RMS continuo** (`inject_acoustic_cues_into_transcript` en `python_backend/media.py`) que escanea automáticamente los silencios del streamer durante la transcripción. Cuando detecta fuego cruzado, disparos, explosiones o combate intenso, inyecta marcas sincronizadas `(DISPAROS / ACCIÓN)` en la transcripción. Luego, el prompt del LLM en `llm_prompts.py` tiene la directriz `SILENCIO Y ACCIÓN`, la cual instruye al modelo a capturar estas zonas como jugadas épicas de alta concentración aunque no haya diálogo.
- **Falta en UI:** Falta visibilidad y claridad en la interfaz para que el usuario conozca que el sistema ya realiza esta detección acústica de fondo al seleccionar `Tipo de Video: Gaming`, y especificar el `Subgénero Gaming` (Competitivo, Campaña, Souls, Rítmico, etc.) junto con el `Contexto o Juego Específico` (ej. "Call of Duty", "Hollow Knight").

### 1.2 "Rehacer Copy" Repite el Titular y Pierde Naturalidad
- **Problema:** En el candidato #13 (visible en las capturas), al pulsar "Rehacer Copy", la descripción generada comenzó literalmente con: `🚨 Jugada Clutch y Acción Intensa Un tiro, una kill y pura adrenalina...`. El copy inicial generado al buscar momentos es fluido, conciso y vendedor, mientras que "Rehacer Copy" duplicó el titular de forma redundante y añadió emojis de alarma.
- **Causa Raíz:**
  1. En `python_backend/api.py` (líneas 870-878), `regenerate_social_copy` enviaba: `extra_context=f"Título actual del clip (mantener este mismo concepto sin cambiarlo): {candidate['hook']}"`. El LLM interpretó que debía pegar el título como la primera línea de la descripción.
  2. En `python_backend/llm.py` (`generate_social_copy_with_llm`), el prompt de sistema instruía `"full_copy": "Gancho punchy\n1 o 2 oraciones..."` y en `_normalize_social_copy_dict` (línea 1401) se anteponía `primary_hook` al cuerpo del texto, forzando la concatenación del titular.
  3. No existía una regla negativa explícita que prohibiera anteponer o repetir el título dentro de la descripción del post, ni que prohibiera emojis de alarma como `🚨`.

### 1.3 Candidatos de Duración Excesiva (Solicitar 1 min y obtener clips de 3 a 5 min)
- **Problema:** En las capturas, al seleccionar objetivo de 1 minuto (`60s`, rango 45s a 75s), el candidato #5 duró `29:40 - 32:48` (188 segundos = 3m 8s) y otros candidatos alcanzaron 91s y 105s.
- **Causa Raíz:**
  - En `python_backend/llm.py` (`_extract_json_from_llm_response` / `parse_candidate_json`), existe la función `expand_short_candidate` para alargar momentos menores a `target_min`, pero **NO existía ninguna lógica de recorte o contención (`clamp_candidate_duration`) para cuando el LLM devuelve un rango que excede `target_max`**.
  - El sistema aceptaba cualquier duración superior a 30s sin techo, permitiendo que momentos de 188s se colaran en la lista.

### 1.4 Presencia Confusa de "Thinking / Modo Razonamiento / CoT" en UI
- **Problema:** La opción de "Modo Razonamiento (Thinking / CoT en Ollama) / Modo Rápido" aparece en la barra superior de `CandidatePanel.tsx`, en `StyleModal.tsx` y en `SettingsPanel.tsx`, generando confusión, saturación visual y ralentizaciones inesperadas en modelos locales.
- **Acción:** Purgar completamente todos los toggles, textos y advertencias de "Thinking / CoT" de la interfaz gráfica y fijar la configuración interna a `enableThinking = false` de forma uniforme, garantizando respuestas JSON directas, rápidas y limpias.

### 1.5 Antislop en UI: Eliminación de Emojis Decorativos No Profesionales
- **Problema:** Siguiendo las directrices de `antislop-ui` (R-04, R-16) y `antislop-copywriting`:
  - En `CandidatePanel.tsx`: `⚡ Viral ... /100:`, `🪝 Hook:`, `🔥 Engag:`, `💡 Valor:`, `🚀 Share:`, `⚡ Modo Ráfaga`, y emojis en chips de filtros (`⚡ Reacción`, `⭐ Destacado`, `💥 Clutch`, `📖 Anécdota`, `💀 Fail`, `💡 Tutorial`, `❓ Pregunta`) y ordenamiento (`⭐ Match`, `⏱️ Cronología`, `⏳ Duración`).
  - En `StyleModal.tsx`: emojis en subgéneros (`🏆`, `📖`, `💀`, `⚡`, `👻`, `🛠️`, `🎮`), en botones de relación de aspecto (`🎞️`, `🖥️`, `📱`) y en el botón principal de importación (`📱 Importar y Buscar Clips`).
  - En `WorkspaceHeader.tsx`: `📱 Shorts & Clips`.
  - En `python_backend/llm.py`: el hook generado por picos acústicos tenía `"💥 Jugada Clutch y Acción Intensa"`.
- **Acción:** Purgar todos los emojis decorativos de la UI y del backend. Reemplazarlos por diseño sobrio y profesional estilo suite NLE (DaVinci Resolve / Premiere Pro), utilizando tipografía nítida y únicamente iconos funcionales de Lucide cuando aporten significado real.

---

## 2. Alcance

### Archivos Backend a Modificar:
1. `python_backend/llm.py`:
   - Implementar función `clamp_candidate_duration(start, end, segments, target_min, target_max)` para restringir y recortar candidatos al límite máximo permitido (`target_max * 1.10`) alineado al final de frase/segmento más cercano.
   - Integrar `clamp_candidate_duration` en `parse_candidate_json` y `_extract_json_from_llm_response`.
   - Limpiar emojis en títulos por defecto (cambiar `"💥 Jugada Clutch y Acción Intensa"` a `"Jugada Clutch y Acción Intensa"`).
   - Aplicar `strip_emojis_from_text` sobre ganchos y titulares producidos.
   - Refactorizar el prompt de `generate_social_copy_with_llm` prohibiendo expresamente la repetición del titular y los emojis de alarma (`🚨`).
   - Ajustar `_normalize_social_copy_dict` para no concatenar el hook al inicio de la descripción del post si ya es un copy completo.
2. `python_backend/llm_prompts.py`:
   - Reforzar las instrucciones de corte y duración en `build_system_prompt` para exigir que `end - start` respete estrictamente el rango máximo configurado.
3. `python_backend/api.py`:
   - Refactorizar `regenerate_social_copy` pasando `extra_context` enfocado en el tema del clip sin inducir a que el LLM repita el título como primera frase.

### Archivos Frontend a Modificar:
4. `src/components/panels/CandidatePanel.tsx`:
   - Retirar el checkbox y texto de "Modo Thinking / Modo Rápido".
   - Purgar todos los emojis de la tarjeta de candidatos (`⚡ Viral /100`, `🪝 Hook`, `🔥 Engag`, `💡 Valor`, `🚀 Share`). Reemplazarlos por badges limpios y métricas tipográficas profesionales.
   - Purgar emojis de los chips de filtrado por categoría (`Reacción`, `Destacado`, `Clutch`, `Anécdota`, `Fail`, `Tutorial`, `Pregunta`).
   - Purgar emojis de los botones de ordenamiento (`Match`, `Cronología`, `Duración`) usando iconos Lucide sobrios.
   - Purgar emoji `⚡` en "Modo Ráfaga", usando icono `<Zap size={12} />` o texto plano.
   - Asegurar que el hook y el titular mostrados se limpien de emojis mediante filtro antislop visual.
5. `src/components/modals/StyleModal.tsx`:
   - Retirar la sección de "Modo Razonamiento (Thinking / CoT en Ollama)".
   - Retirar la nota de texto que menciona "modo razonamiento (thinking)".
   - Purgar emojis de las opciones de subgénero Gaming (`Competitivo`, `Campaña / Lore`, `Souls / Desafío`, etc.).
   - Purgar emojis de las opciones de relación de aspecto (`Nativo / Original`, `Horizontal 16:9`, `Vertical 9:16`).
   - Purgar emoji `📱` del botón `Importar y Buscar Clips`.
   - Agregar un badge explicativo sobrio en la sección Gaming: *"Detección acústica activa: identifica jugadas intensas, combate y momentos tensos automáticamente aunque el streamer guarde silencio."*
6. `src/components/modals/SettingsPanel.tsx`:
   - Retirar el toggle de "Activar modo razonamiento (Thinking / CoT)".
7. `src/components/panels/WorkspaceHeader.tsx`:
   - Retirar emoji `📱` en `Shorts & Clips`.
8. `src/hooks/useAppSettings.ts` & `src/hooks/useMediaPipeline.ts`:
   - Mantener `enableThinking = false` como valor fijo por defecto sin interfaz disruptiva.

### Archivos de Test y Herramientas:
9. `scratch/test_clamp_candidate_duration_unit.py`: Tests unitarios de restricción de duración.
10. `scratch/test_social_copy_antislop_unit.py`: Tests unitarios de generación y normalización de copy sin duplicación de titular ni emojis.
11. `scratch/test_antislop_ui_cleanliness_unit.py`: Tests de validación estática para certificar ausencia de emojis en componentes clave de UI.
12. `scratch/test_aspect_ratio_geometry_unit.py`: Actualización del test para validar la resolución canónica 1920x1080 fijada en Plan 26.

---

## 3. Paso a Paso Técnico

### Fase 1: Control de Duración y Purgado de Emojis en Backend (`llm.py`, `llm_prompts.py`, `api.py`)
1. En `python_backend/llm.py`:
   - Crear función `clamp_candidate_duration(start: float, end: float, segments: Optional[List[Dict[str, Any]]], target_min: float, target_max: float) -> Tuple[float, float]`.
   - Si `end - start > target_max * 1.10`:
     - Recorrer los `segments` hacia adelante desde `start` y buscar el corte de frase más cercano cuyo timestamp final esté dentro de `[start + target_min, start + target_max]`.
     - Si no se encuentra un corte de frase natural dentro de esa ventana, recortar `end = start + target_max`.
   - Aplicar `clamp_candidate_duration` en `parse_candidate_json` y en `_extract_json_from_llm_response`.
2. En `python_backend/llm.py` (línea 1098):
   - Eliminar emoji del hook acústico: cambiar `"💥 Jugada Clutch y Acción Intensa"` a `"Jugada Clutch y Acción Intensa"`.
   - Asegurar que al extraer o registrar candidatos, se aplique `strip_emojis_from_text` sobre `hook` y `hook_title`.
3. En `python_backend/api.py`:
   - En `regenerate_social_copy`: cambiar `extra_context` a:
     `f"Contexto temático del clip: {clean_hook}. Redacta una descripción atractiva para redes sociales basada en la transcripción. PROHIBIDO repetir o anteponer el título o titular del clip en el texto. Comienza directamente con la intriga o la acción."`
4. En `python_backend/llm.py`:
   - En `generate_social_copy_with_llm`, reforzar el system prompt:
     `"REGLA NEGATIVA ESTRICTA: PROHIBIDO incluir o repetir el título o gancho del clip como primera frase de la descripción. La descripción debe ser una apertura atractiva o curiosa basada en el suceso real. PROHIBIDO usar emojis de alarma (🚨, ⚠️) o listas de emojis al inicio."`
   - En `_normalize_social_copy_dict`: construir `full_copy` como post limpio (Apertura/Caption -> CTA interactivo -> 3-5 hashtags) sin duplicar el titular.

### Fase 2: Retiro de Controles y Referencias a "Thinking"
1. En `src/components/panels/CandidatePanel.tsx`:
   - Eliminar el bloque JSX que renderiza el checkbox y texto de `Thinking CoT (Lento) / Modo Rápido`.
2. En `src/components/modals/StyleModal.tsx`:
   - Eliminar el bloque JSX del contenedor "Modo Razonamiento (Thinking / CoT en Ollama)".
   - En el texto de ASR Refiner, eliminar la mención a `(thinking)`.
3. En `src/components/modals/SettingsPanel.tsx`:
   - Eliminar el checkbox "Activar modo razonamiento (Thinking / CoT)".

### Fase 3: Antislop en Interfaz de Usuario (UI & Copywriting)
1. En `src/components/panels/CandidatePanel.tsx`:
   - Reemplazar la barra de métricas virales con diseño minimalista NLE:
     - Badge principal: `Viral {total_score}/100` con tipografía limpia y borde sutil.
     - Sub-métricas: `Hook: {hook_score}/25`, `Engagement: {engagement_score}/25`, `Valor: {value_score}/25`, `Compartir: {shareability_score}/25`.
   - Limpiar chips de categorías: `Reacción`, `Destacado`, `Clutch`, `Anécdota`, `Fail`, `Tutorial`, `Pregunta` (sin emojis).
   - Limpiar botones de orden: `Match`, `Cronología`, `Duración` (con iconos Lucide `<Sparkles size={12} />`, `<Clock size={12} />`, `<Hourglass size={12} />`).
   - En `Modo Ráfaga`: usar `<Zap size={12} />` en lugar del emoji `⚡`.
2. En `src/components/modals/StyleModal.tsx`:
   - Limpiar etiquetas de subgéneros: `Competitivo`, `Campaña / Lore`, `Souls / Desafío`, `Rítmico / Precisión`, `Terror / Sustos`, `Sandbox / Rol`, `Gaming Variado`.
   - Limpiar selector de aspecto: `Nativo / Original`, `Horizontal 16:9`, `Vertical 9:16`.
   - Botón de acción: `Importar y Buscar Clips` (sin emoji `📱`).
   - Agregar indicativo informativo sobre detección acústica para gameplays sin voz.
3. En `src/components/panels/WorkspaceHeader.tsx`:
   - Cambiar `📱 Shorts & Clips` por `Shorts & Clips`.

### Fase 4: Reconciliación de Tests y Validación Integral
1. Crear los tests unitarios y de integración para validar la nueva lógica.
2. Actualizar `scratch/test_aspect_ratio_geometry_unit.py` para sincronizar con la resolución canónica de subtítulos de Plan 26.
3. Ejecutar toda la suite de pruebas con `python scratch/run_all_tests.py` y `python -m unittest discover tests`.
4. Compilar frontend con `npm run build` y regenerar el paquete portable con `python build_portable.py`.
5. Sincronizar el directorio portable `C:\Users\JEFF\Desktop\AutoShorts - Portable`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Implicación Potencial | Medida de Mitigación |
|---|---|---|
| Recorte de clips a mitad de palabra | Si `clamp_candidate_duration` corta abruptamente a `target_max` segundos. | La función busca activamente el final del último segmento de voz anterior a `target_max`, garantizando que las oraciones no queden truncadas. |
| Incompatibilidad de argumentos en llamadas LLM sin thinking | Modelos locales que requieran un flag booleano. | El parámetro `enable_thinking=False` se mantiene internamente en las funciones de API de backend para no romper compatibilidad con Ollama ni LM Studio. |
| Regeneración de copy vacía si la transcripción es breve | Si el clip tiene poco texto y no se pasa el titular como fallback. | Se pasa el titular como tema conceptual de fondo (`Contexto temático: ...`), garantizando contexto rico para el LLM sin forzar su repetición literal. |

---

## 5. Estrategia de Testing (Gate de Cierre OBLIGATORIO)

Siguiendo estrictamente la regla `RULE[user_global]`, la tarea no se dará por concluida hasta verificar el 100% en verde en todos los niveles:

### 5.1 Tests Unitarios (Nivel 1)
- `scratch/test_clamp_candidate_duration_unit.py`:
  - Validar que un candidato de 188s con objetivo `60s` (máximo 75s) se recorte exactamente a $\le 75s$ respetando los límites de segmentos.
  - Validar que candidatos con duración normal (ej. 55s) no se modifiquen.
  - Validar que candidatos para duraciones largas (`10m`, `15m`) respeten sus techos respectivos.
- `scratch/test_social_copy_antislop_unit.py`:
  - Validar que `_normalize_social_copy_dict` no anteponga el hook al caption si ya existe un cuerpo de texto.
  - Validar que `strip_emojis_from_text` elimine emojis como `🚨`, `💥`, `⚡`.
- `scratch/test_antislop_ui_cleanliness_unit.py`:
  - Escanear `CandidatePanel.tsx`, `StyleModal.tsx` y `WorkspaceHeader.tsx` verificando que no existan emojis decorativos en las cadenas de texto visual.

### 5.2 Tests de Integración (Nivel 2)
- Ejecutar `scratch/test_candidate_sorting_and_filtering_integration.py` para asegurar que los filtros por tipo de momento y ordenamiento funcionen al 100% con las nuevas etiquetas sin emojis.
- Ejecutar `scratch/test_gaming_subgenre_prompts_unit.py` para asegurar que las directrices de gaming y detección acústica se acoplen perfectamente al sistema.
- Ejecutar `python -m unittest discover tests` para validar la integridad del subsistema de medios y subtítulos.

### 5.3 Tests E2E (Nivel 3)
- Ejecutar `npm run build` para certificar que el bundle frontend de Vite/React compile limpiamente sin errores de tipos o JSX.
- Ejecutar la suite completa mediante `python scratch/run_all_tests.py` certificando 100% PASSED (todos en verde).
- Ejecutar `python build_portable.py` para generar la distribución ejecutable portable y sincronizarla en `C:\Users\JEFF\Desktop\AutoShorts - Portable`.

