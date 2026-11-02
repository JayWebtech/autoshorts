# Plan 22: Corrección de Truncamiento en Insignia CTA al Incrementar Escala

## 1. Diagnóstico

A partir del reporte del usuario y la captura adjunta (`media_1793585841367_1f2c7d8b.jpg`), se evidencia que al aumentar la escala del CTA (por ejemplo a 1.2x o 1.4x), la pastilla se corta horizontalmente a la mitad del texto (`❤️ ¡Sígueme y`), perdiendo la parte final (`dale like!`) y cerrando el borde redondeado prematuramente.

### Causa Raíz
En `python_backend/media.py` (línea 720), la función auxiliar `get_exact_glyph_bbox` utilizaba un lienzo en memoria de tamaño fijo:
`test_img = Image.new("RGBA", (400, 200), (0, 0, 0, 0))`
Al invocar `get_exact_glyph_bbox(rest_text, text_font)` sobre el texto completo ("¡Sígueme y dale like!") con una escala mayor a 1.0 (o a resolución de supersampling 2X):
- El texto mide en realidad más de 800-900 píxeles de ancho.
- Al dibujarse en una imagen de 400 píxeles, la caja envolvente devuelta por `.getbbox()` se truncó rígidamente en el límite de `400` píxeles.
- El cálculo `total_w = pad_x * 2 + emoji_w + gap_x + text_w` fijó el ancho de la pastilla en solo ~450 píxeles, generando un lienzo donde las palabras posteriores quedaron fuera de los límites de la imagen y el borde curvado se cerró sobre el texto.

### Solución
1. **Medición Vectorial Ilimitada para el Texto:**
   - Para `rest_text`, sustituir la renderización sobre imagen de tamaño fijo por `draw_d.textbbox((0, 0), rest_text, font=text_font)`. Esta función de Pillow/FreeType calcula directamente las métricas vectoriales del glifo sin asignar ningún buffer raster, lo que permite admitir textos de cualquier longitud o escala (hasta 2000+ px) con precisión subpíxel y costo computacional de 0 ms.
2. **Lienzo Dinámico para el Emoji:**
   - Para `emoji_part`, como se trata de un solo glifo que requiere rasterización para obtener el bounding box de color (Segoe UI Emoji), dimensionar el lienzo de prueba de forma dinámica en función del tamaño de fuente escalado: `side = int(ss_font_size * 3)`. Esto garantiza que el emoji nunca sea recortado independientemente del factor de escala elegido por el usuario (0.5x a 2.0x).
3. **Verificación de Bounding Box Completo:**
   - Asegurar que `img_ss` contenga holgadamente la totalidad del texto y el emoji sin ningún pixel fuera de los límites.

---

## 2. Alcance

### Archivos Backend:
- `python_backend/media.py`:
  - En `generate_cta_badge_image`:
    - Eliminar `get_exact_glyph_bbox` sobre el texto y emplear `draw_d.textbbox` directamente para `rest_text`.
    - Dimensionar dinámicamente el canvas auxiliar de `emoji_part` según `ss_font_size * 3`.

---

## 3. Paso a Paso Técnico

### Paso 1: Modificación de `generate_cta_badge_image` en `python_backend/media.py`
1. Reemplazar la medición de texto y emoji:
   ```python
   # Emoji exact pixel bbox on a dynamically sized canvas (ss_font_size * 3):
   emoji_w = 0
   emoji_h = 0
   bbox_e = (0, 0, 0, 0)
   if emoji_part:
       side = int(ss_font_size * 3)
       offset = ss_font_size
       e_img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
       ed = ImageDraw.Draw(e_img)
       try:
           ed.text((offset, offset), emoji_part, font=emoji_font, embedded_color=True)
       except Exception:
           ed.text((offset, offset), emoji_part, font=emoji_font, fill=(255, 255, 255, 255))
       bb = e_img.getbbox()
       if bb:
           bbox_e = (bb[0] - offset, bb[1] - offset, bb[2] - offset, bb[3] - offset)
       emoji_w = bbox_e[2] - bbox_e[0]
       emoji_h = bbox_e[3] - bbox_e[1]

   # Text bbox via textbbox directly (unlimited length & scale, exact metrics):
   dummy = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
   draw_d = ImageDraw.Draw(dummy)
   bbox_t = draw_d.textbbox((0, 0), rest_text, font=text_font)
   text_w = bbox_t[2] - bbox_t[0]
   text_h = bbox_t[3] - bbox_t[1]
   ```
2. Mantener la fórmula de centrado métrico y espaciado proporcional ya validada:
   - `total_w = pad_x * 2 + (emoji_w + gap_x if emoji_part else 0) + text_w`
   - `total_h = content_h + pad_y * 2`

### Paso 2: Verificación Automatizada
1. Actualizar `scratch/test_cta_badge_fix_unit.py` probando escalas extremas (`scale_factor = 0.5`, `1.0`, `1.4`, `1.8`, `2.0`) y textos largos ("¡Sígueme y dale like!", "Suscríbete al canal para no perderte ningún clip").
2. Verificar que en todos los casos `img.getbbox()` no corte ningún pixel y que el ancho de la pastilla contenga el 100% de los caracteres.
3. Ejecutar la suite completa de tests de AutoShorts (100% verde).
4. Compilar y sincronizar la distribución portable en `C:\Users\JEFF\Desktop\AutoShorts - Portable`.
5. Registrar decisión D-023 en `DECISIONS.md`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Mitigación |
|---|---|
| Textos muy largos que superen el ancho del video (1080px) a escala 2.0x | FFmpeg centra el badge con `max(0, min(W-w, X-w/2))`. Se recomienda en UI escalas de 0.8x a 1.4x, pero el renderizado mantendrá la integridad del gráfico sin recortes internos de texto. |

---

## 5. Estrategia de Testing (Gate de Cierre Obligatorio)

### Nivel 1: Tests Unitarios
- `scratch/test_cta_badge_fix_unit.py`: Verificará que para escalas de 0.5 a 2.0 y textos de hasta 60 caracteres, el ancho calculado `total_w` coincida con el ancho visual renderizado sin truncamiento de palabras.
- Validar alineación vertical de centroides `abs(emoji_center_y - text_center_y) <= 1.0px`.

### Nivel 2: Tests de Integración
- `scratch/test_custom_overlay_render_integration.py`: Validar la generación de insignia CTA integrada en el flujo de exportación de clips.

### Nivel 3: Suite Completa
- Ejecutar los 29 tests automatizados del workspace (100% pasando).

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Para proceder con la aplicación de los cambios y la compilación, responde exactamente: **`PLAN APROBADO`**.

