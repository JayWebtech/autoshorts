# Plan 31: Release v2.9.0 — Empaquetado Portable ZIP, Actualización Exhaustiva de README, Optimización Dinámica de Chunks OpenRouter y Fix de Exportación de Logs

## 1. Diagnóstico y Contexto
Tras la implementación y prueba en hardware real de la integración con OpenRouter (Plan 30), el usuario validó el sistema procesando un video de **2 horas y 5 minutos (125 minutos)** con el modelo gratuito `openrouter/free`.

### 1.1 Hallazgos del Test Real de OpenRouter
- **Comportamiento de la API:** Se generaron 9 peticiones en 7 minutos (de 03:31 PM a 03:38 PM) consumiendo ~2,600 a 3,300 tokens de entrada por bloque y ruteando exitosamente hacia Particle-1, Nemotron 3.5, North Mini Code y Ling 3.2.
- **Costo Operativo:** **$0.00** (totalmente gratuito).
- **Consumo de Cuota:** 9 peticiones de las 50 peticiones/día disponibles en OpenRouter Free (18% de la cuota diaria).
- **Oportunidad de Optimización:** Con un contexto configurado de 16k tokens, una llamada de 15 minutos solo ocupa ~3,000 tokens de entrada (menos del 20% de la ventana). En grabaciones largas de directos (> 60m o > 120m), podemos dimensionar adaptativamente los bloques a 20 o 25 minutos. Para este mismo video de 2h 5m, el número de peticiones se reducirá de **9 a solo 5 peticiones**, ahorrando un 45% de cuota adicional.

### 1.2 Problemas Reportados por el Usuario
1. **Ausencia del Portable en `dist/`:** El script `build_portable.py` genera actualmente un archivo `.tar.gz` que no es el estándar para usuarios finales de Windows (que esperan un archivo `.zip` para descomprimir con el explorador nativo de Windows y subir directamente a GitHub Releases). Además, el empaquetado portable no se ejecutó en la sesión anterior, dejando solo la carpeta de compilación de Vite en `dist/`.
2. **Version Bump v2.9.0:** El software se encuentra en `2.8.0` en `python_backend/version.py` y `package.json`. Debe ser elevado oficialmente a `v2.9.0`.
3. **Fallo en "Exportar Logs":** En `LogsModal.tsx`, actualmente solo existen botones de "Copiar" y "Limpiar". No existe un botón de "Exportar / Descargar Logs" en archivo descargable (`.log`/`.txt`), y en WebView2 `navigator.clipboard.writeText` puede fallar si la ventana no tiene el foco activo o si faltan permisos del host.
4. **README Desactualizado:** `README.md` sigue referenciando la versión `v2.5.0` y omite OpenRouter, cortes estilo CapCut, persistencia de subtítulos/CTA, antislop en UI y el nuevo subsistema GUI sin consolas.

---

## 2. Alcance

### Archivos a Modificar / Crear
1. `build_portable.py`:
   - Incorporar generación de `AutoShorts-v2.9.0-windows-x64-portable.zip` mediante `zipfile` estándar de Python con compresión `zipfile.ZIP_DEFLATED, compresslevel=9`, normalización estricta de rutas internas con `.as_posix()` y cálculo de checksum `.zip.sha256`.
   - Limpieza estricta: abortar si instancias activas de `AutoShorts.exe` bloquean `dist/AutoShorts`, y excluir rigurosamente archivos `.pyc`, `.log`, `.db`, `.tmp`, directorios `__pycache__` o datos locales residuales dentro del ZIP público.
   - Mantener también `.tar.gz` para compatibilidad.
2. `python_backend/version.py`: Bump a `__version__ = "2.9.0"`.
3. `package.json`: Bump a `"version": "2.9.0"`.
4. `python_backend/llm.py`:
   - Dimensionamiento adaptativo de macro-chunks en `detect_candidates_pipeline`:
     - Cálculo defensivo de duración: `total_duration = max((s.get("end", 0.0) for s in segments), default=0.0)`.
     - Preservación prioritaria de `target_duration in ["10m", "15m"]` (mínimo 1200s y 1800s respectivamente) para que clips largos nunca queden truncados.
     - Para `provider == "openrouter"` en clips estándar (`auto`, `30s`, `1m`, `3m`, `5m`):
       - Si `available_ctx >= 16384`:
         - Duración total $\le 60$ min: bloque de 15 min (`900s`), overlap 1 min (`60s`).
         - Duración total $> 60$ min y $\le 120$ min: bloque de 20 min (`1200s`), overlap 1.5 min (`90s`).
         - Duración total $> 120$ min (2+ horas): bloque de 25 min (`1500s`), overlap 2 min (`120s`).
       - Si `available_ctx <= 8192`: límite máximo de 10 min (`600s`), overlap 1 min (`60s`).
       - Rama `else:` de respaldo fijada en 15 min (`900s`).
5. `python_backend/api.py`:
   - Agregar método RPC `export_system_logs(self, args)`:
     - Volcar de forma integral el buffer en memoria `log_buffer.get_entries()` hacia el archivo de destino para garantizar que no se pierda ningún evento emitido por `log_buffer.push(...)`.
     - Utilizar diálogo nativo de PyWebView `self._window.create_file_dialog(SAVE_DIALOG)` para permitir elegir la ubicación de guardado, con fallback a la carpeta `Downloads` del usuario.
     - Retornar `{ "success": True, "path": str(dest_path), "dir": str(dest_dir), "cancelled": False, "lines": len(entries) }`.
6. `src/components/modals/LogsModal.tsx`:
   - Agregar botón de acción **"Exportar"** con icono `Download` (`lucide-react`).
   - Invocación de `invoke("export_system_logs")` recibiendo la ruta del archivo, mostrando feedback visual `"Exportado"` y botón/notificación con la ruta y acceso directo a "Abrir carpeta" (`open_folder`).
   - Fallback secundario de descarga por `Blob` en el DOM en caso de error.
   - Blindar `handleCopyLogs` con fallback a `document.execCommand('copy')` usando `<textarea>` fuera de pantalla para garantizar copia infalible en cualquier estado de WebView2.
7. `README.md`:
   - Actualización completa y exhaustiva a `v2.9.0`: insignias, documentación de OpenRouter, descarga del portable `.zip`, matriz de modelos y tabla de arquitectura.
8. `DECISIONS.md`: Registrar decisión arquitectónica `D-032`.

---

## 3. Paso a Paso Técnico

### Paso 1: Optimización Adaptativa de Chunks en OpenRouter
- En `python_backend/llm.py`:
  - Extraer `total_duration = max((s.get("end", 0.0) for s in segments), default=0.0)`.
  - Configurar bloques adaptativos respetando duraciones objetivo:
    ```python
    if target_duration == "15m":
        chunk_dur = 1800.0  # 30 minutos necesarios para capturar un momento de 15 min
        overlap = 240.0
    elif target_duration == "10m":
        chunk_dur = 1200.0  # 20 minutos necesarios para capturar un momento de 10 min
        overlap = 180.0
    elif provider == "openrouter":
        if available_ctx >= 16384:
            if total_duration > 7200.0:    # Grabaciones de más de 2 horas
                chunk_dur = 1500.0         # 25 minutos
                overlap = 120.0            # 2 minutos
            elif total_duration > 3600.0:  # Grabaciones de 1 a 2 horas
                chunk_dur = 1200.0         # 20 minutos
                overlap = 90.0             # 1.5 minutos
            else:                          # Grabaciones cortas (hasta 1 hora)
                chunk_dur = 900.0          # 15 minutos
                overlap = 60.0
        elif available_ctx <= 8192:
            chunk_dur = 600.0              # 10 minutos (seguridad para 8k)
            overlap = 60.0
        else:
            chunk_dur = 900.0              # Fallback seguro para contextos intermedios
            overlap = 60.0
    ```
  - Preservar el delay de 2.5s entre peticiones y el circuit breaker para OpenRouter Free.

### Paso 2: Implementación de Exportación Integral de Logs en Backend y Frontend
- En `python_backend/api.py`:
  - Definir `export_system_logs(self, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]`:
    - Obtener todas las entradas de `log_buffer.get_entries()`.
    - Determinar ruta de destino:
      - Si `self._window`: invocar `create_file_dialog(getattr(webview, 'SAVE_DIALOG', 20), save_filename=f"autoshorts_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log", file_types=("Archivos de registro (*.log)", "Todos los archivos (*.*)"))`. Si el usuario cancela, retornar `{"success": False, "cancelled": True}`.
      - Si es modo headless/dev o diálogo nulo: usar `Path.home() / "Downloads" / f"autoshorts_logs_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"`.
    - Escribir todas las entradas en UTF-8 con `errors="replace"`.
    - Retornar `{ "success": True, "path": str(dest_path), "dir": str(dest_path.parent), "cancelled": False, "lines": len(entries) }`.
- En `src/components/modals/LogsModal.tsx`:
  - Añadir estados `exported`, `exportedInfo` y botón `Exportar` con `<Download size={13} />`.
  - Cuando se hace clic en `Exportar`:
    - Ejecutar `await invoke<{ success: boolean; path: string; dir: string; cancelled?: boolean }>("export_system_logs")`.
    - Si `res.success`, mostrar feedback visual: `"Exportado"` y botón/acceso para abrir la carpeta (`invoke("open_folder", { path: res.dir })`).
    - Si falla la llamada RPC, fallback secundario a descarga de `Blob` en el navegador.
  - En `handleCopyLogs`: agregar fallback con `<textarea>` fuera de pantalla y `document.execCommand("copy")` ante rechazo de `navigator.clipboard`.

### Paso 3: Bump de Versión a v2.9.0 y Empaquetado ZIP
- En `python_backend/version.py`: `__version__ = "2.9.0"`.
- En `package.json`: `"version": "2.9.0"`.
- En `build_portable.py`:
  - Asegurar limpieza limpia de `dist/AutoShorts`: si `shutil.rmtree` falla, abortar con error explícito solicitando cerrar instancias abiertas de `AutoShorts.exe`.
  - Crear `AutoShorts-v2.9.0-windows-x64-portable.zip` mediante `zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9)`.
  - Normalizar rutas internas obligatoriamente con `.as_posix()`:
    `arc_name = (Path("AutoShorts") / full_path.relative_to(output_dir)).as_posix()`.
  - Excluir explícitamente archivos `.pyc`, `.log`, `.db`, `.tmp`, directorios `__pycache__` o carpetas temporales.
  - Asegurar creación de entrada de carpeta vacía para `AutoShorts/data/`.
  - Generar `AutoShorts-v2.9.0-windows-x64-portable.zip.sha256`.
  - Mantener la verificación in-place de la cabecera PE `ensure_gui_subsystem` (Subsystem = 2).

### Paso 4: Reescritura y Actualización Exhaustiva de README.md
- Actualizar badges a `v2.9.0` y enlaces a la release oficial de GitHub.
- Documentar detalladamente el motor OpenRouter (Free vs Paid, cuota diaria de 50 peticiones, macro-chunks adaptativos de 15 a 25 min, modelos recomendados y saneamiento de CoT).
- Documentar las funcionalidades acumuladas (cortes internos CapCut, control de subtítulos/CTA, antislop UI, detección acústica de gameplay y portables sin ventana de consola).
- Proporcionar guía de instalación y ejecución en 1 clic para Windows 10/11.

### Paso 5: Suite de Tests y Compilación del Binario
- Crear `scratch/test_plan31_unit.py` con pruebas para:
  - Lógica de chunks adaptativos en videos de 30m, 90m y 150m con OpenRouter y protección de clips de 10m y 15m (`test_adaptive_openrouter_chunk_sizes`).
  - Consistencia de versión exacta entre `version.py`, `package.json` y `README.md` (`test_version_consistency`).
  - Integración del exportador de logs con volcado de buffer (`test_export_system_logs_integration`).
  - Simulación de pipeline de OpenRouter para video de 125m comprobando reducción de 9 a 5 chunks (`test_pipeline_openrouter_partition_count`).
- Ejecutar `scratch/run_all_tests.py` (100% de tests en verde).
- Compilar el proyecto ejecutando `python build_portable.py` para generar el portable `.zip` en `dist/`.
- Validar automáticamente la integridad del paquete ZIP generado:
  - Miembros con formato POSIX `/`.
  - Presencia obligatoria de `AutoShorts/AutoShorts.exe` y `AutoShorts/portable.mode`.
  - Ausencia de archivos `.db`, `.log` y `__pycache__`.
  - Verificación del hash SHA-256 y tamaño $< 400$ MB.

---

## 4. Riesgos y Auditoría Goldfish (EGM)
- **Riesgo 1 (Compatibilidad de rutas dentro del archivo ZIP):** En Windows, si `zipfile` escribe rutas con `\`, exploradores como el nativo de Windows o unzip en Linux pueden tener problemas.
  - *Mitigación:* Se fuerza `.as_posix()` en todos los miembros del archivo ZIP (`AutoShorts/...`).
- **Riesgo 2 (Desbordamiento de tokens en macro-chunks de 25 min):** ¿Puede un bloque de 25 minutos de habla continua exceder los 16k tokens?
  - *Mitigación:* `macro_compact_segments` comprime el audio a ~200 tokens por minuto. 25 minutos representan ~5,000 tokens de entrada, lo que deja más de 11,000 tokens libres para el prompt y la respuesta en una ventana de 16k. Además, la bisección adaptativa existente captura cualquier `exceed_context_size_error` y divide el bloque a la mitad automáticamente.
- **Riesgo 3 (Logs incompletos en disco):** `log_buffer.push` solo escribe en memoria y no en disco.
  - *Mitigación:* `export_system_logs` vuelca el 100% del buffer en memoria directamente al archivo exportado antes de entregarlo.
- **Riesgo 4 (Exportación de logs en entornos restringidos de WebView2):** Si el navegador bloquea la descarga de blobs o si el diálogo nativo de PyWebView falla.
  - *Mitigación:* Se implementa doble canal: llamada al backend nativo con diálogo `SAVE_DIALOG` de Windows (o guardado en Descargas) con opción directa de abrir carpeta, más fallback en cliente y fallback infalible en el botón de copiar.

---

## 5. Estrategia de Testing
- **Tests Unitarios e Integración (`scratch/test_plan31_unit.py`):**
  - Verificación matemática de `partition_segments` adaptativo según duración total y contexto.
  - Verificación de clips de 10m y 15m con tamaños de bloque ampliados (1200s y 1800s).
  - Verificación de consistencia de versión en `version.py`, `package.json` y `README.md`.
  - Verificación del exportador de logs con volcado de buffer.
  - Verificación de simulación para video de 125 min (5 chunks).
- **Suite de Regresión (`scratch/run_all_tests.py`):**
  - Ejecución de los 38 tests previos + tests nuevos de Plan 31. Requisito: 100% en verde.
- **Validación Automatizada del Binario ZIP:**
  - Comprobar existencia de `dist/AutoShorts-v2.9.0-windows-x64-portable.zip`.
  - Inspección del ZIP: miembros sin barras invertidas, archivos requeridos presentes, archivos excluidos ausentes y peso $< 400$ MB.
  - Comprobar que `AutoShorts.exe` tenga `Subsystem = 2` (GUI pura sin terminal).
