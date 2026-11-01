# Registro de Decisiones de Arquitectura y Documentación

## D-001: Reescritura del README Principal
- **Decisión:** Reestructurar `README.md` como una guía técnica exhaustiva de nivel profesional, documentando la totalidad de módulos implementados en el backend de Python 3 y el frontend de React 19.
- **Motivo:** El README previo omitía módulos críticos (faster-whisper con CTranslate2, presets de subtítulos ASS, detector de pausas dead-air y el importador de YouTube con análisis de derechos).
- **Estándar:** Aplicar principios de documentación técnica clara y directa: sin fórmulas vacías, sin guiones largos de tipo em dash y con especificaciones validadas contra el código fuente.

## D-002: Arquitectura del Backend en Python 3
- **Decisión:** Mantener y documentar la migración completa del backend desde Rust/Tauri hacia Python 3.11 sobre PyWebView.
- **Motivo:** Facilita la ejecución nativa de PyTorch con aceleración CUDA, integración directa con Whisper/CTranslate2 y comunicación sin fricción con servidores locales de LLM (Ollama y LM Studio).

## D-003: Eliminación de PyInstaller Antiguo y Lanzador Batch
- **Decisión:** Eliminar `build_exe.py`, `AutoShorts.spec`, `build_tmp/` y `release/`. Incorporar el lanzador `AutoShorts.bat` con detección automática de entornos virtuales (`venv`, `.venv`, `env`) y pausa diagnóstica.
- **Motivo:** El script antiguo de PyInstaller presentaba fallos y ensuciaba el repositorio. La distribución de un binario final se gestionará en un hito futuro mediante una release portable limpia para GitHub.

## D-004: Filosofía Local-First (Cero Coste de APIs)
- **Decisión:** Orientar la arquitectura y la documentación hacia el uso 100% local en la máquina del usuario: transcripción local con faster-whisper (CUDA FP16 / CPU INT8) e inferencia con Ollama y LM Studio.
- **Motivo:** AutoShorts está diseñado como un software a medida para creadores que aprovechan la potencia de su propio hardware sin pagar suscripciones ni consumo de tokens por minuto.

## D-005: Especialización Exclusiva en Clips y Purga de Funcionalidades Cloud y AutoEdición
- **Decisión:** Retirar completamente el importador de YouTube (yt-dlp), el módulo de AutoEdición de formato largo (autoedit_service.py, AutoEditWorkspace.tsx), OpenAI Whisper estándar, Deepgram y todas las pasarelas cloud (OpenRouter, DeepSeek, OpenAI, Anthropic, Gemini, Groq). El software se especializa exclusivamente en la extracción y edición de clips verticales virales (Shorts, Reels, TikTok) con faster-whisper y LLMs locales (Ollama y LM Studio).
- **Motivo:** Eliminar latencias de red y cuellos de botella de APIs gratuitas o de pago, simplificar la arquitectura, reducir la superficie de mantenimiento y garantizar una experiencia 100% privada, local y sin coste operativo.

## D-006: Estandarización Obligatoria en pnpm como Gestor de Paquetes
- **Decisión:** Establecer pnpm como el único gestor de paquetes de Node.js / frontend permitido en el proyecto (prohibido el uso de npm o yarn).
- **Motivo:** Directriz técnica explícita del usuario y ventajas de rendimiento, consistencia de dependencias y ahorro de almacenamiento mediante enlaces duros centralizados.

## D-007: Entrada Directa sin Modal de Bienvenida y Autodetección No Bloqueante de LLMs
- **Decisión:** Eliminar el modal bloqueante de onboarding (OnboardingModal.tsx). AutoShorts inicia de inmediato en el Dashboard principal de proyectos. La detección de Ollama y LM Studio opera de forma automática, no invasiva y en tiempo real, reflejándose en la barra de estado inferior (StatusBar.tsx) y en el panel de configuración (SettingsPanel.tsx), sin forzar descargas obligatorias de modelos.
- **Motivo:** Evitar fricción de entrada, respetar la autonomía del usuario para elegir libremente su motor local (LM Studio u Ollama) y garantizar el comportamiento fluido y tradicional esperado en aplicaciones nativas de escritorio.

## D-008: Detección Dinámica de VRAM/GPU, Ordenamiento Inteligente de Whisper y Rediseño de Configuración
- **Decisión:** Eliminar todas las referencias estáticas a GPUs específicas (como RTX 2060 12GB). La idoneidad de los modelos (Óptimo, Moderado, Pesado) se calcula de forma 100% dinámica en tiempo real según la GPU y VRAM detectadas (4GB, 6GB, 8GB, 12GB, 16GB o CPU). Los modelos de Whisper se ordenan con optgroups priorizando los ya descargados en disco y, dentro de cada grupo, de mayor idoneidad a mayor peso. El panel de configuración se rediseñó en una arquitectura limpia de 3 tarjetas independientes (Faster-Whisper, Motor de IA, y Prompt del Sistema) con responsive fluido.
- **Motivo:** Adaptar el software universalmente al hardware de cualquier usuario sin colapsos visuales, textos acumulados ni falsas advertencias de VRAM.

## D-009: Fusión Definitiva de Prompt de Detección de Momentos y Social Copywriting Conciso
- **Decisión:** Fusionar el prompt base del sistema (`DEFAULT_MOMENTS_PROMPT`) integrando los criterios de alta retención para TikTok, Reels y Shorts (ganchos de primeros 3s, picos emocionales/gameplay, contenido narrativo, auto-conclusión estricta, cortes limpios en pausas naturales y exclusiones de partes lentas o promocionales), manteniendo el contrato técnico JSON (`candidates`/`clips`) de bajo nivel 100% invisible para el usuario. Se actualizó el generador y normalizador de social copy (`generate_social_copy_with_llm`, `_normalize_social_copy_dict`) aplicando los principios de `antislop-copywriting`: descripciones breves de 2-3 líneas para no tapar los videos en smartphone, eliminación de guiones largos (`—`) y límite estricto garantizado de 3 a 5 hashtags específicos.
- **Motivo:** Maximizar la calidad de los clips detectados y la retención en redes sociales verticales, evitando descripciones excesivamente largas o saturadas de hashtags genéricos que perjudican el engagement.

## D-010: Identidad Visual Inicial
- **Decisión:** Reemplazar el icono genérico heredado del repositorio base por un primer imagotipo temático para AutoShorts en Windows y web.
- **Motivo:** Sustituir la gráfica base del template por recursos propios del proyecto.

## D-011: Rediseño Minimalista de Primer Nivel para el Isotipo y Branding
- **Decisión:** Rediseñar por completo el logo e icono de AutoShorts adoptando una estética geométrica puramente minimalista de nivel profesional: un squircle oscuro mate con un botón de reproducción estilizado dividido por un corte diagonal de alta energía en gradiente cálido neón (ámbar a coral magenta). Se generaron capas multi-resolución en `icon.ico` (16x16 a 256x256) con transparencia perimetral y `icon.png` (512x512) para máxima legibilidad en barra de tareas, barra lateral (36x36) y navegador.
- **Motivo:** Eliminar la complejidad visual recargada de tipo wallpaper, garantizando nitidez absoluta, alto contraste y presencia de marca sólida en cualquier escala.

## D-012: Cancelación Inmediata con Liberación de VRAM, Chunks Adaptativos y Circuit Breaker
- **Decisión:** Implementar liberación explícita y completa de memoria en transcripción (`gc.collect()`, `torch.cuda.empty_cache()` y desreferenciación inmediata de generadores de CTranslate2 y modelos) tanto en interrupción como en `cancel_transcription`, integrando chequeo de cancelación en el análisis acústico RMS. Para la inferencia LLM (LM Studio y Ollama), se implementó detección dinámica de contexto, dimensionamiento inteligente de bloques y sub-partición adaptativa por bisección ante desbordamiento de contexto (`exceed_context_size_error`), permitiendo operar fluidamente con ventanas de 4k u 8k sin saturar la VRAM de la GPU. Ante errores fatales o modelos descargados, un Circuit Breaker corta de inmediato la ejecución para evitar saturación inútil. Se amplió el logo en la barra lateral a 36x36 px para óptima presencia visual.
- **Motivo:** Evitar que procesos cancelados continúen ocupando la GPU y que grabaciones extensas fallen en bloque por exceder el context window cuando el usuario trabaja con VRAM ajustada.

## D-013: Release v2.5, Archivos de Proyecto Autónomos (autoshorts.project), Visor de Logs y Empaquetado Portable onedir
- **Decisión:** 
  1. Crear la rama `release-v2.5` siguiendo la secuencia de releases (`release-v1.0`, `release-v1.5`, `release-v2.0`) y fijar el versionado del software en `v2.5.0` (`python_backend/version.py`, `package.json`).
  2. Implementar arquitectura de proyectos autónomos (`autoshorts.project` en la raíz de cada carpeta de grabación, estilo Premiere/CapCut) con auto-migración de proyectos existentes, auto-detección al importar para omitir Whisper si ya existe transcripción, y re-vinculación inteligente de video cuando cambia la unidad de disco.
  3. Incorporar visor de terminal y logs en vivo (`LogsModal.tsx`, `logger.py`) accesible desde el Sidebar y la StatusBar, con buffer circular de 1,000 líneas, rotación en `autoshorts.log`, copia rápida al portapapeles y auto-scroll.
  4. Diseñar la arquitectura portable en modo `--onedir` (`AutoShorts.spec`, `paths.py`, `multiprocessing.freeze_support()` en `run.py`) e implementar `build_portable.py` para compilar el frontend y empaquetar `AutoShorts-v2.5.0-windows-x64-portable.zip` con checksum SHA-256.
- **Motivo:** Garantizar máxima portabilidad de datos entre máquinas y pendrives sin depender de SQLite central, evitar pérdida de visibilidad de eventos en Windows sin consola, y permitir la distribución oficial en GitHub Releases sin dependencias de instalación.

## D-014: Optimización de Tamaño del Bundle Portable (< 400 MB) Mediante Exclusión de PyTorch
- **Decisión:** Excluir explícitamente PyTorch (`torch`, `torchvision`, `torchaudio`, `torchtext`) de la compilación portable en `AutoShorts.spec` y adaptar `python_backend/transcription.py` para utilizar directamente `ctranslate2.get_cuda_device_count()` para la aceleración GPU de `faster-whisper`.
- **Motivo:** PyTorch y sus librerías CUDA (`torch_cuda.dll`, `cudnn_engines`, `cublasLt`, etc.) sumaban más de 2.2 GB innecesarios, haciendo que el ZIP resultante pesara 2.41 GB y fuera rechazado por el límite estricto de 2.0 GB de GitHub Releases. `faster-whisper` no utiliza PyTorch sino CTranslate2 (56 MB), el cual detecta y ejecuta modelos en GPUs NVIDIA CUDA de forma nativa e independiente, reduciendo el ZIP final a menos de 400 MB.

## D-015: Auditoría Integral y Purga de Dependencias Huérfanas de Tauri y Estandarización de Requisitos
- **Decisión:** 
  1. Eliminar por completo `@tauri-apps/api`, `@tauri-apps/plugin-dialog` y `@tauri-apps/cli` de `package.json`, junto con los scripts `tauri:*`. Refactorizar `src/apiBridge.ts` con tipado estricto eliminando las ramas condicionales de Tauri hacia una interfaz nativa directa con `window.pywebview.api`. Eliminar `package-lock.json` residual para respetar D-006 (`pnpm`).
  2. Actualizar `requirements.txt`: incorporar formalmente `pillow>=10.0.0` (utilizado por el generador de stickers y títulos en `media.py`), retirar la dependencia engañosa de `torch>=2.0.0` y documentar que la aceleración GPU es gestionada autónomamente por CTranslate2.
  3. Retirar `'psutil'` de `hiddenimports` en `AutoShorts.spec` (la telemetría es 100% nativa vía `ctypes` y `nvidia-smi`). Eliminar `AutoShorts.vbs` y preservar protegida la carpeta `analizarrepos/`.
- **Motivo:** Eliminar 14 paquetes muertos de `node_modules`, desvincular código obsoleto de la migración de Tauri, prevenir confusiones al instalar dependencias en Python y mantener el repositorio en un estado rigurosamente limpio y profesional.


## D-016: Blindaje Reactivo y Fallback Estático para Modelos Faster-Whisper en Ejecutable Portable
- **Decisión:**
  1. Definir DEFAULT_WHISPER_MODELS: WhisperModel[] en src/types.ts con las especificaciones oficiales de los 6 modelos Faster-Whisper (large-v3-turbo, large-v3, medium, small, ase, 	iny).
  2. Inicializar whisperModelsList con estos modelos por defecto en useAppSettings.ts e integrar sincronización reactiva automática mediante useEffect al actualizarse environment?.whisperModels.
  3. Extender el timeout del bridge en src/apiBridge.ts de 2.5s a 12s para mitigar arranques en frío (cold start) en WebView2 en Windows, incorporando reintentos con backoff al montar la aplicación.
  4. Implementar fallback defensivo en StyleModal.tsx y SettingsPanel.tsx para garantizar que los selectores desplegables contengan siempre las opciones de modelos en cualquier estado.
  5. Configurar en AutoShorts.spec la recolección exhaustiva de datos de aster_whisper (silero_vad_v6.onnx), librerías dinámicas de ctranslate2 (cudnn64_9.dll, libiomp5md.dll) y sus submódulos recursivos.
  6. Blindar python_backend/api.py registrando excepciones de llamadas RPC en utoshorts.log y garantizando lista de respaldo en environment_status.
- **Motivo:** Evitar que condiciones de carrera temporales en el puente PyWebView o inicializaciones lentas en Windows dejen los selectores de modelos vacíos en la interfaz portable (AutoShorts.exe), y asegurar la presencia de todos los binarios y pesos ONNX necesarios para la inferencia de voz y VAD.

## D-017: Supresión Total de Ventanas CMD en Subprocesos, Empaquetado de cuBLAS CUDA y Fallback Resiliente a CPU en Whisper
- **Decisión:**
  1. Implementar `get_no_window_kwargs()` en `python_backend/paths.py` inyectando `creationflags=subprocess.CREATE_NO_WINDOW` (`0x08000000`) y `STARTF_USESHOWWINDOW` con `wShowWindow=SW_HIDE` en Windows. Aplicar esta configuración a todas las llamadas de `subprocess.Popen` y `subprocess.run` en `media.py` (`extract_audio`, `probe_media`, `extract_video_thumbnail`, `render_flat_clip`), `stream_server.py` y `telemetry.py`.
  2. Redirigir la lectura de `stderr` de FFmpeg en `extract_audio` hacia `log_buffer.push(...)` para alimentar en tiempo real el visor interno de Terminal/Logs (`LogsModal.tsx`) sin requerir consolas externas.
  3. Empaquetar `cublas64_12.dll` y `cublasLt64_12.dll` en `ctranslate2` dentro de `AutoShorts.spec` y registrar `os.add_dll_directory` en `run.py` y `transcription.py` para aceleración nativa CUDA 12 sin requerir PyTorch ni instalación manual del CUDA Toolkit.
  4. Blindar `transcribe_local` en `python_backend/transcription.py` con degradación elegante (*graceful degradation*): ante cualquier fallo de inicialización en GPU CUDA (falta de DLLs, drivers incompatibles o hardware no NVIDIA), el software captura el error, emite alerta en el terminal interno y conmuta automáticamente a CPU (`int8`) completando la transcripción con cero cuelgues.
  5. Sustituir caracteres emoji en sentencias `print()` para prevenir errores `UnicodeEncodeError` en terminales con codificación estándar Windows `cp1252`.
- **Motivo:** Garantizar una experiencia de escritorio completamente limpia y profesional sin ventanas CMD flotantes, proporcionar aceleración CUDA autónoma en el bundle portable y asegurar tolerancia absoluta a fallos de hardware en cualquier ordenador con Windows.


## D-018: Release v2.6.0 — Editor de Cortes Internos CapCut, Calibración de Bitrate TikTok, Contexto Dinámico LM Studio, Summary Automático y Empaquetado tar.gz
- **Decisión:**
  1. Calibrar el exportador de video para TikTok y plataformas verticales en `python_backend/media.py`: sustituir el perfil sobre-inflado (`-crf 15`, `-b:v 16M`, `-maxrate 24M`, `-bufsize 30M`, `-b:a 320k`) por Constrained CRF con VBV (`-crf 19`, `-maxrate 10M`, `-bufsize 16M`, `-pix_fmt yuv420p`, `-c:a aac`, `-b:a 192k`, `-movflags +faststart`). Mantener resolución 1080x1920 nativa sin reescalado ni sharpening artificial para evitar la recompresión agresiva de TikTok.
  2. Implementar detección dinámica de contexto en LM Studio (`python_backend/llm.py`): consultar `GET /api/v0/models` extrayendo directamente `loaded_context_length` cuando `state == "loaded"` (con fallback a `/api/v1/models`). Al detectar 16k tokens, los bloques de análisis se calculan a 10 minutos (en vez de 5 min), reduciendo las llamadas al LLM de 50 a ~25 y acelerando el análisis al doble.
  3. Integrar editor de cortes internos estilo CapCut (`CandidatePreviewModal.tsx`, `useMediaPipeline.ts`, `media.py`): barra de tiempo multi-segmento con botón "Dividir en cabezal", marcado/desmarcado de fragmentos eliminados, selector de FPS (Auto/60/30) y salto automático en previsualización. En backend, concatenación frame-accurate (`trim`/`concat`/`xfade`) y re-mapeo temporal matemático de subtítulos ASS y SRT.
  4. Poblado automático de la carpeta `summary/` (`project_service.py`): generación continua de `transcripcion_completa.txt`, `subtitulos_completos.srt`, `transcripcion_detallada.json` y `momentos_virales.txt`.
  5. Empaquetado portable `.tar.gz`: migrar `build_portable.py` para generar `AutoShorts-v2.6.0-windows-x64-portable.tar.gz` con compresión Gzip nivel 9 y checksum SHA-256.
- **Motivo:** Entregar clips nítidos que no se pixelen tras subirse a TikTok, permitir a los creadores eliminar partes muertas dentro de los momentos antes de exportar, optimizar el uso de modelos LLM con ventanas de contexto amplias y cumplir con las especificaciones de la versión v2.6.0.

## D-019: Auto-Carga en LM Studio para Contexto Real de 16k, Sincronización Remotion en Subtítulos SRT/ASS con Cortes Internos y Feedback en Tiempo Real de Exportación FFmpeg
- **Decisión:**
  1. Auto-precarga en LM Studio (`python_backend/llm.py`): Antes de evaluar el contexto dinámico con `get_available_context_size`, el pipeline ejecuta `ensure_model_loaded(provider="lmstudio", model_name=model_name)`. Si el modelo está `"state": "not-loaded"`, lo carga en memoria automáticamente mediante warm-up ping y espera confirmación activa de carga. Esto asegura que LM Studio devuelva el valor real de `loaded_context_length` (16.384 tokens) incluso sin tener activo el "Modo Ráfaga", evitando la caída artificial al default de 8k y previniendo timeouts en inferencia.
  2. Sincronización estricta de subtítulos SRT y ASS ante cortes (`python_backend/media.py`): Actualizar `generate_srt` para utilizar `chunk_words_remotion` con `silence_break_sec=0.35`. Ante fragmentos eliminados o pausas de silencio, las palabras se segmentan de forma independiente y se reasignan a la línea de tiempo concatenada sin generar subtítulos que atraviesen los cortes ni permanecer en pantalla durante silencios.
  3. Feedback y diagnóstico visual en exportación de video (`src/components/modals/CandidatePreviewModal.tsx`, `media.py`, `api.py`):
     - En frontend: Mantener el modal abierto durante la exportación con estado `isExporting`, spinner animado (`<Loader2 className="spin" />`), texto `"Exportando video..."` y bloqueo de botones para evitar clics duplicados o abandonos accidentales. El modal se cierra automáticamente solo tras completar el render con éxito; si ocurre un error, muestra una alerta descriptiva en pantalla para permitir reintentar.
     - En backend: Canalizar eventos informativos en tiempo real hacia `log_buffer.push(...)` en `render_flat_clip` y `render_flat_clip_for_candidate` (inicio de render, parámetros CRF 19 / VBV 10M, subtítulos libass, badge CTA y reporte final con tamaño en MB o stderr detallado).
     - Sanitización de rutas: Blindar `safe_hook` para evitar colisiones de caracteres (`¡`, `¿`) con el filtro de libass en Windows.
- **Motivo:** Garantizar que los modelos de 16k se aprovechen al 100% desde la primera ejecución sin requerir interacción manual previa, asegurar que el usuario tenga plena visibilidad del proceso de renderizado con FFmpeg y mantener la sincronización absoluta de subtítulos con los cortes internos.

## D-020: Intercalado de Pads en FFmpeg Concat, Rediseño de Alto Contraste del Botón Dividir y Persistencia Unificada de Ajustes y Cortes
- **Decisión:**
  1. Intercalado obligatorio en filtro `concat` de FFmpeg (`python_backend/media.py`): Corregir la sintaxis del filtro para que los pads de video y audio se intercalen estrictamente por segmento (`[vseg0][aseg0][vseg1][aseg1]...concat=n=N:v=1:a=1[vjoined][ajoined]`). Esto elimina el error `Media type mismatch` entre `asetpts` y `concat`.
  2. Rediseño de alto contraste para "Dividir en cabezal" (`src/components/modals/CandidatePreviewModal.tsx`): Retirar la clase `.btn-confirm` (que forzaba fondo blanco) y aplicar fondo índigo `#4f46e5`, texto blanco `#ffffff`, borde `#6366f1` y feedback hover `#4338ca` para una legibilidad y contraste óptimos (>7:1).
  3. Persistencia unificada de ajustes y cortes (`CandidatePreviewModal.tsx`): El botón "Guardar Ajuste" ahora persiste tanto el punto de inicio y fin como los cortes internos (`segments` / `subRanges`) en `localStorage` por candidato, restaurándolos automáticamente al reabrir el modal y mostrando confirmación visual instantánea (`¡Ajuste Guardado!`). El botón "Restablecer Original" limpia los cortes guardados y restaura el rango inicial.
- **Motivo:** Garantizar que la exportación de video multi-segmento con cortes internos se ejecute sin errores en FFmpeg, mejorar la experiencia de usuario con botones legibles y permitir que los cortes estilo CapCut no se pierdan al cerrar el modal.
