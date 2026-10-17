# Diseño: Rediseño a 2 Columnas de la Ventana de Previsualización y Recorte de Clips

## 1. Contexto y Objetivo
Actualmente, el modal `CandidatePreviewModal.tsx` tiene una estructura vertical monolítica de una sola columna. Debido a la cantidad de herramientas añadidas recientemente (ajuste de trim, estilos de subtítulos HyperFrames, colores, selector de líneas, CTA animado con 4 estilos y caja de simulación), el usuario debe hacer demasiado scroll vertical para configurar y exportar su clip.

El objetivo es transformar el modal en una estación de trabajo de **2 columnas estilo estudio (inspirado en CapCut / Premiere)**:
- **Columna Izquierda (Pantalla en Vivo):** Marco vertical 9:16 tipo móvil con el reproductor de video en tiempo real y la previsualización directa de los subtítulos activos y el badge CTA sobre el video.
- **Columna Derecha (Panel de Ajustes por Pestañas):** Pestañas compactas `[1. Recorte] [2. Subtítulos] [3. CTA Animado]` para editar parámetros sin scroll.
- **Barra Inferior Unificada:** Score de IA, justificación del momento y botón prominente de "Cortar y Exportar Clip".

---

## 2. Arquitectura de Componentes y UI

### 2.1 Estructura Principal
```
+------------------------------------------------------------------------------------+
| [Icon] Previsualizar Clip #1  (31:20 - 32:17) "{Hook}"         [Badge] [X]         |
+-------------------------------------------------+----------------------------------+
| COLUMNA IZQUIERDA (Preview & Player)            | COLUMNA DERECHA (Ajustes)        |
|                                                 | [1. Recorte] [2. Subs] [3. CTA]  |
|  +-------------------------------------------+  | +------------------------------+ |
|  | [Marco Móvil 9:16]                        |  | | PESTAÑA ACTIVA:              | |
|  | - Video en reproducción                   |  | | Controles de la sección      | |
|  | - Insignia CTA en vivo                    |  | | seleccionada con diseño      | |
|  | - Subtítulo animado en posición           |  | | limpio y sin scroll.         | |
|  | - Botón Play/Pause central al hover       |  | +------------------------------+ |
|  +-------------------------------------------+  |                                  |
|  [Play] 0:18 ===[========]=== 0:57              |                                  |
|  Clip: 18.2s / 57.1s    Original: 31:38         |                                  |
+-------------------------------------------------+----------------------------------+
| ● Score IA: 94/100 - "Justificación del clip"          [Descartar] [✂ Cortar Clip] |
+------------------------------------------------------------------------------------+
```

### 2.2 Pestañas de la Columna Derecha

1. **Pestaña `trim` (Recorte Fino):**
   - Tarjetas de Inicio y Fin con pasos rápidos `-5s`, `-1s`, `+1s`, `+5s`.
   - Indicador de duración resultante tabular en vivo.
   - Acciones de "Restablecer" y "Guardar Ajuste".

2. **Pestaña `subs` (Subtítulos HyperFrames):**
   - Switch "Incrustar en el video".
   - Selector de animación: 8 estilos (`Loud Viral`, `Arcade Retro`, `Cyber Terminal`, `Clean Editorial`, `TikTok Karaoke`, etc.).
   - Posición en pantalla: Abajo / Centro / Arriba.
   - Paleta de color base y color de resaltado Karaoke.
   - Distribución: 1 Sola Línea vs 2 Líneas.

3. **Pestaña `cta` (Llamado a la Acción Animado):**
   - Switch "Incrustar en el video".
   - Texto del llamado con selector rápido de sugerencias predefinidas.
   - Selector de animación: Impacto & Rebote (`bounce-land`), Deslizamiento (`slide-up`), Latido Neón (`pulse-glow`), Fundido (`fade-smooth`).
   - Posición en pantalla: Arriba / Medio / Abajo.

### 2.3 Simulación Directa en el Reproductor
- Si el clip **no está exportado todavía**, la columna izquierda dibuja el badge CTA y el subtítulo activo directamente encima del video en su posición real (evitando la necesidad de una caja de simulación redundante al fondo).
- Si el clip **ya fue exportado**, el video se reproduce con sus subtítulos y CTA incrustados por FFmpeg, mostrando el banner verde indicativo.

---

## 3. Estado y Persistencia
- Todo el estado actual de `CandidatePreviewModal.tsx` se preserva intacto:
  - `localStorage` para `captionStyle`, `captionPosition`, `captionColor`, `captionHighlight`, `captionLines`, `ctaEnabled`, `ctaText`, `ctaPosition`, `ctaAnimation`.
  - Nueva variable de estado local `activeTab: "trim" | "subs" | "cta"` (default `"trim"`).
  - Integración transparente con `onCutCandidate` y `onSaveTrim`.
