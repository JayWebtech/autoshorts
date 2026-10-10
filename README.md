# AutoShorts 🎬⚡

[![Python 3.11](https://img.shields.io/badge/Python-3.11%20Recomendado-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Requerido-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**AutoShorts** es una suite de escritorio integral y de código abierto para creadores de contenido, streamers y editores. Transforma transmisiones en vivo de larga duración (streams de 1 a 4+ horas en Twitch/Kick/YouTube) y podcasts en:

1. **Clips Verticales de Alto Impacto (9:16 Shorts / TikToks / Reels)** con subtítulos dinámicos estilo TikTok (karaoke animado), hooks virales y copies para redes sociales.
2. **Compilaciones y Resúmenes Autoeditados para YouTube (16:9 u 9:16)** de 3, 5, 8, 10 o 15 minutos, estructurados narrativamente por IA con timestamps de capítulos y miniaturas HD 1080p.

> [!IMPORTANT]
> **Migración de Backend:** A diferencia del proyecto original basado en Rust/Tauri, este fork migró el backend completo a **Python 3**. Esto permite ejecutar modelos de IA locales (Whisper CUDA, LM Studio, Ollama) con cero complicaciones de compilación en Rust y un consumo optimizado de recursos.

---

## 📑 Tabla de Contenidos
- [✨ Características Principales](#-características-principales)
  - [🧠 Detección Inteligente de Momentos (Streams de 1h a 4h+)](#-detección-inteligente-de-momentos-streams-de-1h-a-4h)
  - [💬 Subtítulos Dinámicos Estilo TikTok (Animaciones & Karaoke)](#-subtítulos-dinámicos-estilo-tiktok-animaciones--karaoke)
  - [🤖 Soporte Multi-LLM (LM Studio, Ollama y Cloud)](#-soporte-multi-llm-lm-studio-ollama-y-cloud)
  - [✍️ Generador de Copy Rápido & Rehacer Copy en Clips](#️-generador-de-copy-rápido--rehacer-copy-en-clips)
  - [✂️ Recorte Interactivo (Trim Controls) con Tiempo en Vivo](#️-recorte-interactivo-trim-controls-con-tiempo-en-vivo)
  - [🎬 Autoedición y Compilaciones para YouTube](#-autoedición-y-compilaciones-para-youtube)
  - [📊 Telemetría de Hardware en Tiempo Real](#-telemetría-de-hardware-en-tiempo-real)
- [🛠️ Requisitos Previos](#️-requisitos-previos)
- [🚀 Instalación Paso a Paso](#-instalación-paso-a-paso)
- [💻 Ejecución y Modo Desarrollo](#-ejecución-y-modo-desarrollo)
- [📁 Estructura del Proyecto](#-estructura-del-proyecto)
- [🤝 Créditos, Fork y Migración a Python](#-créditos-fork-y-migración-a-python)
- [📄 Licencia](#-licencia)

---

## ✨ Características Principales

### 🧠 Detección Inteligente de Momentos (Streams de 1h a 4h+)
- **Chunking Adaptativo con Overlap:** Divide transmisiones masivas en bloques de 10 minutos con 30 segundos de solapamiento para no perder jugadas o anécdotas situadas entre bloques.
- **Detección Acústica RMS en Silencio (Gaming Clutches):** 
  - Analizador de picos sonoros escrito en Python puro (`wave`, `struct`, `math`).
  - Procesa 1 hora de stream en **menos de 1.6 segundos**.
  - Si estás en un clutch 1v3 o tiroteo intenso y te concentras sin hablar, el algoritmo detecta la energía acústica (disparos, explosiones) y genera automáticamente candidatos de highlight para que la IA no los descarte por falta de diálogo.
- **Duraciones Objetivo Flexibles:** Elige clips de **30s, 1m, 2m, 3m o 5m** para ajustar el análisis a tu estrategia de contenido.

### 💬 Subtítulos Dinámicos Estilo TikTok (Animaciones & Karaoke)
- **Word-Level Timing:** Sincronización palabra por palabra extraída directamente de Whisper o Deepgram.
- **Efecto de Salto / Pop (Karaoke Highlight):** La palabra activa resalta y realiza una sutil animación de escala (*jump/pop*) al mismo compás que el streamer habla.
- **Estilos Visuales Preconfigurados:**
  - *TikTok Moderno:* Letras blancas ultra legibles con borde negro y resalte amarillo chillón.
  - *Amarillo Viral (MrBeast style):* Alto contraste para retención de audiencia.
  - *Neón / Cyberpunk:* Resalte futurista con trazo vibrante.
  - *Minimalista:* Elegante, limpio y sutil.
- **Posicionamiento en Pantalla:** Selecciona si ubicar los subtítulos en la parte **Superior, Centro o Inferior** para no tapar interfaces del juego, cámaras o la UI de TikTok/Instagram.
- **Live Preview:** Previsualiza exactamente cómo se verá la tipografía antes de exportar.
- **Re-exportación Rápida:** Vuelve a exportar cualquier clip ya guardado activando o cambiando el estilo de subtítulos.

### 🤖 Soporte Multi-LLM (LM Studio, Ollama y Cloud)
- **LM Studio (Local):** 
  - Conexión automática con el servidor local (`http://127.0.0.1:1234`).
  - **Auto-detección del modelo activo:** Consulta la API `/v1/models` y selecciona automáticamente el modelo que tienes cargado en memoria.
  - **Supresión de Reasoning:** Desactiva razonamientos largos e innecesarios (thinking tags) para obtener respuestas directas y evitar consumo excesivo de tokens.
  - **Liberación de Memoria:** Cancela peticiones inmediatamente liberando la carga del modelo.
- **Ollama (100% Offline y Privado):**
  - Compatible con `llama3.2`, `qwen2.5`, `qwen3.5`, `mistral`, `gemma2`, etc.
  - Descargador integrado con barra de progreso dentro de la interfaz.
  - **Descarga Inmediata de VRAM (`keep_alive: 0`):** En cuanto la IA devuelve el plan de momentos, libera la memoria de tu tarjeta gráfica para que puedas jugar o renderizar sin lag.
- **Proveedores en la Nube:**
  - **OpenRouter** (modelos gratuitos y premium con rate limiting inteligente).
  - **DeepSeek** (económico y de gran capacidad analítica).
  - **Anthropic Claude** (copywriting y hooks de máxima calidad).
  - **Google Gemini** (modelos Flash de alta velocidad).
  - **OpenAI GPT-4o** y **Groq** (inferencia ultrarrápida).

### ✍️ Generador de Copy Rápido & Rehacer Copy en Clips
- **Quick Copy con Subida de `.srt`:**
  - Permite subir directamente un archivo `.srt`, `.vtt` o `.txt` desde tu explorador sin copiar y pegar texto a mano.
  - **Limpieza Automática:** Elimina números de secuencia y códigos de tiempo (`00:00:01,000 --> ...`), entregándole a la IA únicamente el diálogo limpio.
  - **Grounding Real:** El copy se redacta estrictamente en función de lo que sucede en la transcripción, eliminando textos genéricos.
- **Rehacer Copy en Momentos Exportados:**
  - Cada momento en la pestaña de "Exportados" cuenta con un botón **"✨ Rehacer Copy con IA"**.
  - Utiliza el `.srt` del propio clip para generar un nuevo copy completo (gancho, cuerpo, llamado a la acción y hashtags) **sin modificar el título original del momento**.

### ✂️ Recorte Interactivo (Trim Controls) con Tiempo en Vivo
- **Visualizador de Tiempo en Vivo (Estilo VLC):** Muestra el tiempo actual exacto del reproductor (`00:00:00`) y la duración recortada resultante en tiempo real.
- **Ajustes Rápidos:** Botones de salto fino de `[-5s]`, `[-1s]`, `[+1s]` y `[+5s]` para cuadrar el inicio y el fin del momento con precisión de fotograma.
- **Organización de Momentos:** Pestañas separadas para "Momentos Pendientes" y "Momentos Exportados", con botón de 1 clic para copiar el título al portapapeles.

### 🎬 Autoedición y Compilaciones para YouTube
- **Auto-Editor Narrativo:** Concatena automáticamente los mejores momentos en orden cronológico en un solo video final de 3, 5, 8, 10 o 15 minutos.
- **3 Modos / Vibes:**
  - *Equilibrado:* Ritmo completo de inicio a fin.
  - *Tryhard / Épico:* Prioriza jugadas clutch, kills y tensión.
  - *Risas y Fails:* Prioriza anécdotas, momentos graciosos y fails.
- **Presupuesto Real de Tiempo:** No corta frases a la mitad.
- **Capítulos y Timestamps:** Genera el texto con marcas de tiempo para YouTube (`00:00 Intro...`) con botón de copiar y guardado automático en `Descripcion_YouTube.txt`.
- **Miniaturas HD (1080p):** Captura el fotograma de mayor impacto con sugerencias de títulos clickbait.

### 📊 Telemetría de Hardware en Tiempo Real
- Barra de estado inferior siempre visible (incluso con modales abiertos) que muestra en tiempo real:
  - **CPU %**
  - **GPU %**
  - **VRAM Usada / Total (GB)**
  - **RAM del Sistema Usada / Total (GB)**
  - **Temperatura de la GPU (°C)**

---

## 🛠️ Requisitos Previos

| Requisito | Versión Recomendada | Notas |
| :--- | :--- | :--- |
| **Python** | **3.11.x** (Mínimo 3.10) | Python 3.11 ofrece la mayor compatibilidad y estabilidad con PyTorch, PyWebView y Whisper en Windows/Linux/macOS. |
| **Node.js** | **18.x o superior** (LTS) | Necesario para compilar el frontend (`pnpm` o `npm`). |
| **FFmpeg & FFprobe** | Última versión en el `PATH` | Esencial para corte de video, audio RMS, subtítulos y extracción de fotogramas. |
| **GPU NVIDIA (Opcional)** | Con controladores CUDA | Acelera notablemente la transcripción local con Whisper. |
| **LM Studio u Ollama** | Opcional | Para utilizar inteligencia artificial 100% local y gratuita. |

### Instalación de FFmpeg
Asegúrate de que `ffmpeg` y `ffprobe` estén accesibles desde tu terminal:
- **Windows:** Ejecuta en PowerShell:
  ```powershell
  winget install Gyan.FFmpeg
  ```
  *(O descárgalo desde [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) y agrégalo a las variables de entorno `PATH`).*
- **macOS:**
  ```bash
  brew install ffmpeg
  ```
- **Linux (Ubuntu/Debian):**
  ```bash
  sudo apt update && sudo apt install ffmpeg
  ```

---

## 🚀 Instalación Paso a Paso

### 1. Clonar el Repositorio
```bash
git clone https://github.com/jeffd2599/autoshorts.git
cd autoshorts
```

### 2. Configurar el Entorno de Python
Se recomienda crear un entorno virtual para aislar dependencias:

```bash
# Crear entorno virtual
python -m venv venv

# Activar en Windows (PowerShell):
.\venv\Scripts\Activate.ps1

# Activar en Linux/macOS:
source venv/bin/activate
```

### 3. Instalar PyTorch (Aceleración GPU opcional)
- **Si tienes GPU NVIDIA (Recomendado para Whisper local rápido):**
  ```bash
  pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
  ```
- **Si usarás solo CPU o proveedores de IA Cloud:**
  ```bash
  pip install torch torchvision torchaudio
  ```

### 4. Instalar Dependencias del Backend
```bash
pip install -r requirements.txt
```

### 5. Instalar y Compilar el Frontend
Puedes usar `pnpm` (recomendado) o `npm`:

```bash
# Con pnpm:
pnpm install
pnpm run build

# O con npm:
npm install
npm run build
```

---

## 💻 Ejecución y Modo Desarrollo

### Iniciar AutoShorts (Modo Producción / Uso Habitual)
Ejecuta el script principal:
```bash
python run.py
```
Esto realizará lo siguiente de forma automática:
1. Inicia el servidor multimedia interno en `http://127.0.0.1:1422`.
2. Lanza la ventana de escritorio nativa (basada en WebView2 / PyWebView).

---

### Modo Desarrollo (Hot Reload)
Si deseas modificar el código de la interfaz en tiempo real:

1. **Terminal 1 (Vite Dev Server):**
   ```bash
   pnpm run dev
   ```
2. **Terminal 2 (Desktop Launcher):**
   ```bash
   python run.py
   ```
El lanzador detectará el servidor en `http://127.0.0.1:1420` y conectará la ventana nativa con recarga en caliente automática.

---

## 📁 Estructura del Proyecto

```text
autoshorts/
├── python_backend/          # Backend central en Python 3
│   ├── api.py               # API RPC expuesta al frontend (transcripción, clips, copies, filtros)
│   ├── db.py                # Capa SQLite (proyectos, transcripciones, clips, trims, copies)
│   ├── llm.py               # Orquestador Multi-LLM (LM Studio, Ollama, Claude, DeepSeek, etc.)
│   ├── llm_prompts.py       # Prompts optimizados para viralidad y grounded copy
│   ├── media.py             # FFmpeg, generación de subtítulos ASS dinámicos, audio RMS, thumbnails
│   ├── stream_server.py     # Servidor HTTP local con soporte Range para streaming de video/audio
│   ├── telemetry.py         # Muestreador de hardware sin bloqueo (GPU, VRAM, CPU, RAM)
│   ├── transcription.py     # Pipeline Whisper local con CUDA y Deepgram Cloud
│   └── services/            # Servicios modulares (autoedición, proyectos, YouTube)
├── src/                     # Frontend en React 19 + TypeScript
│   ├── components/          # Componentes visuales (CandidatePanel, QuickCopyModal, TrimEditor, etc.)
│   ├── hooks/               # Custom hooks (useMediaPipeline, useTelemetry)
│   ├── styles/              # Sistema de diseño dark mode y glassmorphism en CSS puro
│   └── types.ts             # Definiciones de tipos TypeScript
├── run.py                   # Punto de entrada de la aplicación de escritorio
├── requirements.txt         # Dependencias de Python
├── package.json             # Scripts y dependencias frontend
└── vite.config.ts           # Configuración del bundler Vite
```

---

## 🤝 Créditos, Fork y Migración a Python

Este proyecto es un fork y evolución integral del repositorio original de [JayWebtech/autoshorts](https://github.com/JayWebtech/autoshorts).

### ¿Por qué se cambió a Python?
La versión original utilizaba una arquitectura basada en Rust (Tauri). Para este proyecto, el backend fue **completamente reescrito y migrado a Python 3**, aportando ventajas sustanciales:

1. **Sin dependencias pesadas de compilación:** Ya no se requiere instalar el toolchain de Rust (`cargo`, `rustc`) ni Microsoft Visual C++ Build Tools para compilar el backend. Cualquier creador o desarrollador puede clonar e instalar con un simple `pip install`.
2. **Ecosistema Nativo de IA y Machine Learning:** Python es el estándar de facto para IA. Facilita la integración nativa y directa de librerías como `openai-whisper`, `torch` con CUDA, análisis acústico en tiempo real y conectores con servidores locales como **LM Studio** y **Ollama**.
3. **Mantenibilidad y Extensibilidad:** Permite a la comunidad añadir nuevos algoritmos de detección, modificar prompts de IA o personalizar pipelines de edición con facilidad.
4. **Subtítulos Dinámicos e Integración FFmpeg Avanzada:** Motor de subtítulos `.ass` con efectos de escala y karaoke generado en tiempo récord sin dependencias externas.

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo [LICENSE](LICENSE) para más información.
