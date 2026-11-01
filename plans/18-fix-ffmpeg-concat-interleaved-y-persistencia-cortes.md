# Plan 18: Corrección de Concat Intercalado en FFmpeg, Contraste de Botón Dividir y Persistencia Unificada de Ajustes y Cortes

## 1. Diagnóstico

### Problema 1: Error `Media type mismatch` en FFmpeg al Exportar Clips con Cortes Internos
- **Causa Raíz:** En `python_backend/media.py` (línea 1203), al construir el filtro `concat` para múltiples segmentos con audio (`has_audio=True`), los pads de entrada se concatenaban agrupando primero todos los videos y luego todos los audios:
  ```python
  v_inputs = "".join(f"[vseg{i}]" for i in range(N))
  a_inputs = "".join(f"[aseg{i}]" for i in range(N))
  filter_parts.append(f"{v_inputs}{a_inputs}concat=n={N}:v=1:a=1[vjoined][ajoined]")
  ```
  Esto generaba para $N=2$: `[vseg0][vseg1][aseg0][aseg1]concat=n=2:v=1:a=1`.
  En la especificación del filtro `concat` de FFmpeg con $v=1, a=1$, los pads se esperan **estrictamente intercalados por segmento** (`[vseg0][aseg0][vseg1][aseg1]`).
  Al enviar `[vseg1]` en el pad 1 (donde FFmpeg esperaba el audio del segmento 0) y `[aseg0]` en el pad 2 (donde esperaba el video del segmento 1), FFmpeg abortó inmediatamente con el error:
  `[Parsed_asetpts_3] Media type mismatch between output pad 0 (audio) and 'Parsed_concat_8' input pad 2 (video)`.
- **Solución requerida:** Modificar la construcción de los pads de entrada para intercalar video y audio por cada segmento $i$: `[vseg{i}][aseg{i}]`.

### Problema 2: Ilegibilidad del Botón "Dividir en cabezal" (Falta de Contraste)
- **Causa Raíz:** El botón en `src/components/modals/CandidatePreviewModal.tsx` tenía la clase `btn-confirm`. En `layout.css`, `.btn-confirm` fuerza `background: #fafafa` (blanco/claro) que colisionaba con el estilo en línea `color: #ffffff`, provocando que el texto fuera blanco sobre fondo blanco (completamente invisible e ilegible).
- **Solución requerida:** Retirar la clase `btn-confirm` y aplicar un diseño de alto contraste con fondo acento índigo oscuro `#4f46e5`, texto blanco `#ffffff`, borde definido y estados interactivos claros.

### Problema 3: Persistencia de Cortes Internos en el Botón "Guardar Ajuste"
- **Causa Raíz:** El botón "Guardar Ajuste" actualmente solo enviaba `startSec` y `endSec` simples a la base de datos, ignorando los cortes internos (`segments` / `subRanges`). Si el usuario dividía o eliminaba partes, los cortes solo existían en la memoria temporal del modal y no se persistían si cerraba la ventana sin exportar.
- **Solución requerida:** Unificar el botón "Guardar Ajuste" para que:
  1. Calcule y guarde el inicio y fin efectivos (`trimStart`, `trimEnd`).
  2. Persista los segmentos y cortes internos del candidato en almacenamiento local persistente (`autoshorts_segments_<candidateId>`).
  3. Al reabrir el modal para ese candidato, recupere automáticamente los cortes guardados.
  4. Al pulsar "Restablecer Original", limpie los cortes persistidos y restaure el segmento original del LLM.
  5. Muestre un feedback visual inmediato al guardar ("¡Ajustes y cortes guardados!").

---

## 2. Alcance

### Archivos a Modificar:
1. `python_backend/media.py`:
   - Corregir el orden de pads en el filtro `concat` para que sean intercalados: `"".join(f"[vseg{i}][aseg{i}]" for i in range(N))`.
2. `src/components/modals/CandidatePreviewModal.tsx`:
   - Rediseñar el botón "Dividir en cabezal" con alto contraste (fondo índigo `#4f46e5`, texto `#ffffff`, sin clases que fuercen fondo blanco).
   - Unificar "Guardar Ajuste" para persistir tanto los puntos de inicio/fin como los cortes internos (`segments`) en `localStorage`.
   - Inicializar `segments` cargando cortes previamente guardados si existen para ese candidato.
   - En "Restablecer Original", limpiar también los cortes internos guardados.
   - Mostrar indicador de éxito temporal tras guardar.

### Archivos de Test a Crear/Actualizar:
1. `scratch/test_ffmpeg_concat_interleaved_unit.py`: Test unitario y de integración que verifica la construcción exacta del comando de filtro FFmpeg y ejecuta un render real con 2 segmentos de video y audio verificando código de salida 0 sin `Media type mismatch`.
2. `scratch/test_segments_persistence_unit.py`: Test de lógica de sincronización y persistencia de segmentos y subrangos.

---

## 3. Paso a Paso Técnico

### Paso 1: Corrección de FFmpeg Concat Intercalado (`python_backend/media.py`)
- En `python_backend/media.py`:
  - Reemplazar líneas 1200-1205:
    ```python
    if has_audio:
        concat_inputs = "".join(f"[vseg{i}][aseg{i}]" for i in range(N))
        filter_parts.append(f"{concat_inputs}concat=n={N}:v=1:a=1[vjoined][ajoined]")
    else:
        concat_inputs = "".join(f"[vseg{i}]" for i in range(N))
        filter_parts.append(f"{concat_inputs}concat=n={N}:v=1:a=0[vjoined]")
    ```
  - Probar con el video del usuario para asegurar ejecución fluida con retorno 0.

### Paso 2: Corrección de Estilo y Contraste del Botón Dividir (`CandidatePreviewModal.tsx`)
- En `CandidatePreviewModal.tsx`:
  - Eliminar `className="btn-confirm"` del botón de división.
  - Aplicar estilos de alto contraste con fondo `#4f46e5`, texto `#ffffff`, borde `#6366f1`, padding cómodo y tipografía mono/sans de alta visibilidad.

### Paso 3: Persistencia Unificada de Ajustes y Cortes (`CandidatePreviewModal.tsx`)
- En `CandidatePreviewModal.tsx`:
  - Inicializar `segments` consultando `localStorage.getItem("autoshorts_segments_" + candidate.id)`.
  - En la función de "Guardar Ajuste":
    - Guardar `segments` en `localStorage.setItem("autoshorts_segments_" + candidate.id, JSON.stringify(segments))`.
    - Invocar `onSaveTrim()` con el rango activo.
    - Mostrar estado de confirmación: `"¡Ajuste y cortes guardados!"`.
  - En "Restablecer Original":
    - Remover `localStorage.removeItem("autoshorts_segments_" + candidate.id)`.
    - Reiniciar `segments` al tramo original continuo.

### Paso 4: Validación con Tests y Compilación Frontend
- Ejecutar `pnpm run build` para asegurar 0 errores de TypeScript en React.
- Ejecutar suite de pruebas completa en `scratch/` (23+ tests al 100%).
- Reconstruir distribución portable con `python build_portable.py` y sincronizar a `C:\Users\JEFF\Desktop\AutoShorts - Portable`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Videos sin pista de audio en cortes múltiples | Podría fallar el concat si se asume audio | Se mantiene la condición `if has_audio:` para intercalar solo cuando existe audio y mapear solo video cuando no |
| Incompatibilidad de segmentos antiguos en localStorage | Podría cargar rangos inválidos si el usuario cambia de video | Validar que los segmentos cargados caigan dentro del rango `candidate.startSec` y `candidate.endSec` |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- **Archivo:** `scratch/test_ffmpeg_concat_interleaved_unit.py`
- **Casos:**
  - Validar que la cadena de filtro `concat` para $N$ segmentos genera el orden intercalado `[vseg0][aseg0][vseg1][aseg1]`.
  - Validar que para videos sin audio genera `[vseg0][vseg1]concat=n=2:v=1:a=0`.

### Nivel 2: Tests de Integración
- **Archivo:** `scratch/test_ffmpeg_concat_interleaved_unit.py`
- **Casos:**
  - Ejecución real de FFmpeg con 2 cortes sobre un clip de prueba con audio y video simultáneo, verificando salida `.mp4` y ausencia total de `Media type mismatch`.

### Nivel 3: Tests E2E y Suite Completa
- Ejecución de los 24 tests de `scratch/test_*.py`.
- Verificación del 100% de tests en verde.
- Validación de compilación de frontend con `pnpm run build`.

---

## 6. Skills del Workspace Aplicadas

- **`senior-code-craft`**: 
  - **Sección 2.1 (Debugging y Análisis de Causa Raíz):** Reproducción exacta del error de FFmpeg en el archivo real del usuario y verificación de la solución matemática de intercalado de pads.
- **`antislop-ui` y `antislop-human`**: 
  - **Accesibilidad y Contraste:** Corrección del botón ilegible blanco-sobre-blanco a una relación de contraste superior a 7:1 (índigo `#4f46e5` con texto blanco `#ffffff`).
- **`antislop-code`**: 
  - Limpieza de código y mantenimiento de comentarios directos sin elementos decorativos innecesarios.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan requiere tu autorización formal antes de ejecutar cualquier cambio.
> Para proceder, responde exactamente: **`PLAN APROBADO`**.

