# Plan de Diseño: Rediseño de Navegación por Pestañas, Optimización de Previsualización, Virality Scoring & Parser Robusto de Copy

- **Fecha:** 2026-10-10
- **Proyecto:** AutoShorts
- **Estado:** Propuesto (Brainstorming validado)

---

## 1. Objetivos del Plan

1. **Corrección Robusta del Parser de Copy (Bug de JSON crudo con backticks)**:
   - Evitar que fallos menores de sintaxis del LLM (ej. comas duplicadas, `#` fuera de comillas en los hashtags como en el screenshot del usuario) provoquen que se guarde el bloque entero ````json { ... } ```` como descripción.
   - Implementar un extractor resiliente que repare o rescate los campos (`full_copy`, `caption`, `hooks`, `cta`, `hashtags`) pase lo que pase, y limpie cualquier formato markdown antes de persistir en base de datos.

2. **Aceleración Inmediata de la Previsualización de Clips (Reducción de Lag)**:
   - Migrar `stream_server.py` de `HTTPServer` mono-hilo a `ThreadingHTTPServer` con buffers de transmisión optimizados (256 KB - 512 KB) para soportar múltiples conexiones simultáneas de Range Requests de Chromium/WebView2.
   - En `CandidatePreviewModal.tsx`, eliminar la clave destructiva `key={`${candidate.id}-${trimStart}-${trimEnd}`}` que forzaba el desmontaje y reconexión completa de la red en cada micro-ajuste de trim.
   - Usar seek directo en memoria sobre el mismo elemento de video (`video.currentTime = targetTime`) para que la reproducción comience instantáneamente, imitando la agilidad de reproductores como VLC.

3. **Integración de Virality Score Desglosado y Hook Titles (Inspirado en SupoClip)**:
   - **Backend (`python_backend/llm.py` y `db.py`)**:
     - Actualizar el schema de candidatos en el prompt del LLM para extraer:
       - `virality`: `{ hook_score (0-25), engagement_score (0-25), value_score (0-25), shareability_score (0-25), total_score (0-100), hook_type }`.
       - `hook_title`: Titular corto y contundente de 3 a 8 palabras para el clip.
     - Persistir estas columnas en la tabla `candidates` de SQLite.
   - **Frontend (`CandidatePanel.tsx`)**:
     - Mostrar el **Hook Title** resaltado como etiqueta llamativa arriba del hook descriptivo.
     - Mostrar un widget visual con mini-barras o badges para los 4 componentes de viralidad:
       - 🪝 Gancho (Hook): XX/25
       - ⚡ Engagement: XX/25
       - 💡 Valor: XX/25
       - 🚀 Compartir: XX/25
       - Tipo de gancho (*Pregunta intrigante*, *Anécdota*, *Contraste*, etc.).

4. **Rediseño de Interfaz: Navegación por Pestañas Dedicadas**:
   - Reemplazar la vista dividida fija (donde la columna de Transcripción de 4000 segmentos ocupaba el 50% de la pantalla) por **Pestañas de Trabajo a pantalla completa**:
     1. 📝 **Transcripción**: Vista dedicada y espaciosa con buscador, edición de texto, filtro de disparos y botón de pulir con IA.
     2. 🎬 **Clips y Momentos**: Vista amplia y despejada que aprovecha el 100% del ancho para ver las tarjetas de clips con sus estadísticas de viralidad, buscador, filtros (Todos / Pendientes / Exportados) y controles de corte.
     3. ⚡ **AutoEdición YouTube**: Integración de la suite de resúmenes directamente en su propia pestaña en lugar de un modal encimado.

---

## 2. Arquitectura de Cambios Técnicos

### A. Backend Python (`python_backend/`)
- `stream_server.py`:
  - Cambiar herencia a `http.server.ThreadingHTTPServer`.
  - Incrementar tamaño de lectura a 256 KB.
  - Asegurar cabeceras de respuesta rápidas para streaming HTTP 206 Partial Content.
- `llm.py`:
  - Añadir función `repair_and_extract_copy_json(raw_text)` con regex y auto-reparación de comas y hashtags mal formateados.
  - Enriquecer el prompt de detección de momentos (`analyze_transcript_chunk`) para solicitar el desglose de `virality` y `hook_title` siguiendo las mejores prácticas de SupoClip.
- `db.py`:
  - Asegurar migraciones/columnas seguras en SQLite para `hook_title` y campos de virality (`hook_score`, `engagement_score`, `value_score`, `shareability_score`, `hook_type`).

### B. Frontend React (`src/`)
- `src/App.tsx`:
  - Barra de navegación superior con selector de pestaña activa: `activeTab: 'transcript' | 'clips' | 'autoedit'`.
  - Renderizado condicional limpio:
    - Cuando `activeTab === 'transcript'`: Renderiza `TranscriptPanel` en ancho completo.
    - Cuando `activeTab === 'clips'`: Renderiza `CandidatePanel` en ancho completo con grid o lista optimizada.
    - Cuando `activeTab === 'autoedit'`: Renderiza el panel de autoedición de YouTube con timeline de compilación y miniaturas.
- `src/components/panels/CandidatePanel.tsx`:
  - Integrar el componente visual de desglose de Virality Score.
  - Renderizar el `hook_title` en un badge destacado.
- `src/components/modals/CandidatePreviewModal.tsx`:
  - Eliminar el reload destructivo del elemento `<video>`.
  - Actualizar `currentTime` mediante ref y controlar el buffering sin cortes.

---

## 3. Plan de Verificación y Pruebas
1. **Prueba de Parser de Copy**:
   - Test unitario simulando la salida exacta del screenshot (`,"#ClipViral",# #HumorGaming,`) verificando que se extraiga el texto limpio de `full_copy` sin backticks ni errores.
2. **Prueba de Rendimiento de Streaming**:
   - Apertura de modal de previsualización en video de prueba largo y comprobación de tiempo hasta el primer fotograma (First Frame Latency).
3. **Prueba de Pestañas**:
   - Navegación fluida entre Transcripción, Clips y AutoEdición sin pérdida de estado ni scroll reset.
