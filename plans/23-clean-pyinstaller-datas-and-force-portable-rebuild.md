# Plan 23: Desacoplamiento de `datas` en PyInstaller, Limpieza de Caché y Compilación Limpia Garantizada

## 1. Diagnóstico

El usuario reporta que al poner la escala a 120% (1.2x), la insignia CTA se sigue cortando exactamente igual. La captura adjunta (`media_1793586637985_8b005731.png`) tiene unas dimensiones exactas de **282 x 64 píxeles**.

### Causa Raíz Comprobada al 100%
1. **La matemática del bug anterior:**
   - La lógica anterior (Plan 21) con el buffer fijo de `(400, 200)` produce matemáticamente: `pad_x*2 + emoji_w + gap_x + text_w = 564px` a 2X supersampling, lo que al dividirse entre 2 da **exactamente 282 píxeles**.
   - La nueva lógica corregida (Plan 22) produce **499 x 64 píxeles** (con el 100% del texto íntegro).
2. **¿Por qué el usuario seguía teniendo el resultado de 282 píxeles?**
   - Se inspeccionaron los timestamps en disco: `dist/AutoShorts/AutoShorts.exe` tenía fecha de `10:07 p.m.`, ¡nunca fue actualizado!
   - En `AutoShorts.spec` (línea 10), la configuración incluía:
     `datas = [ ('dist', 'dist'), ... ]`
   - Dado que PyInstaller genera su salida dentro de `dist/AutoShorts`, PyInstaller intentaba incluir recursivamente `dist/AutoShorts` dentro de sí mismo.
   - Esto provocó que la fase de ensamblado (`COLLECT`) de PyInstaller fallara con el error `The output directory dist/AutoShorts is not empty`, abortando la sobrescritura de `AutoShorts.exe` en `dist/AutoShorts`.
   - Por ende, el ejecutable que se sincronizó y que el usuario ejecutó en su escritorio era el binario antiguo de las 10:07 p.m. que aún contenía el límite de 400px.

---

## 2. Alcance

### Archivos de Configuración de Build:
- `AutoShorts.spec`:
  - Desacoplar `datas`: reemplazar la inclusión ciega de todo el directorio `dist` por únicamente los artefactos reales del frontend (`dist/index.html` y `dist/assets`), evitando la recursión cíclica con `dist/AutoShorts`.
- `build_portable.py`:
  - Agregar limpieza previa explícita: antes de llamar a PyInstaller, purgar `build/AutoShorts` y `dist/AutoShorts` para garantizar que la compilación sea siempre limpia y no queden binarios viejos bloqueados.
  - Usar la bandera `--noconfirm` (`-y`) en `pyinstaller`.

---

## 3. Paso a Paso Técnico

### Paso 1: Corregir `AutoShorts.spec`
1. Reemplazar en `datas`:
   ```python
   datas = [
       ('dist/index.html', 'dist'),
       ('dist/assets', 'dist/assets'),
       ('icon.ico', '.'),
       ('icon.png', '.'),
       ('public', 'public'),
   ]
   ```
   Esto elimina la auto-recursión con `dist/AutoShorts`.

### Paso 2: Fortalecer `build_portable.py`
1. En `main()` de `build_portable.py`, antes de compilar con PyInstaller:
   - Eliminar `dist/AutoShorts` si existe.
   - Ejecutar `pyinstaller --noconfirm --clean AutoShorts.spec`.
   - Verificar explícitamente que la fecha de `dist/AutoShorts/AutoShorts.exe` corresponda al segundo exacto de la compilación.

### Paso 3: Recompilación y Despliegue Limpio
1. Ejecutar `build_portable.py` de forma limpia.
2. Sincronizar el nuevo `AutoShorts.exe` y `_internal` a `C:\Users\JEFF\Desktop\AutoShorts - Portable`.
3. Comprobar mediante script que `AutoShorts.exe` en el escritorio tenga el hash y timestamp recién generados.
4. Generar una imagen de prueba del CTA al 1.2x directamente desde el entorno para ratificar los 499px de ancho.
5. Registrar decisión D-024 en `DECISIONS.md`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Mitigación |
|---|---|
| Archivos de usuario en `data/` del escritorio | Robocopy mantiene la exclusión `/XD data` para proteger intactas las bases de datos y proyectos del usuario. |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- `scratch/test_cta_badge_fix_unit.py`: Ejecutar y confirmar que el ancho a 1.2x sea `>= 490px` (y no 282px).

### Nivel 2: Tests de Integración
- Verificar que el binario `AutoShorts.exe` en `C:\Users\JEFF\Desktop\AutoShorts - Portable` tenga fecha posterior a las 10:35 p.m. y que ejecute correctamente.

### Nivel 3: Suite Completa
- Ejecutar la suite de 29 tests (100% pasando).

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Para proceder con la corrección de `AutoShorts.spec` y la compilación limpia definitiva, responde exactamente: **`PLAN APROBADO`**.

