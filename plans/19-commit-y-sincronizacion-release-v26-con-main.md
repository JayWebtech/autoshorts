# Plan 19: Commit y Sincronización de Release v2.6 con Main y Origin

## 1. Diagnóstico

### Estado Actual del Repositorio Git:
- **Ramas Locales y Remotas:**
  - `main`: `d275c6a`
  - `release-v2.6`: `d275c6a`
  - `origin/main`: `d275c6a`
  - `origin/release-v2.6`: `d275c6a`
- **Diagnóstico:** Ambas ramas (`main` y `release-v2.6`) están exactamente en el mismo commit base (`d275c6a`). Ninguna está adelantada respecto a la otra en este momento.
- **Cambios Pendientes por Commitear:**
  Los cambios desarrollados y validados en los Planes 17 y 18 se encuentran actualmente en el árbol de trabajo (*working directory*):
  1. Auto-carga y polling de modelos en LM Studio para detección de contexto real de 16k (`python_backend/llm.py`).
  2. Corrección del orden intercalado en el filtro `concat` de FFmpeg (`[vseg0][aseg0][vseg1][aseg1]...`), eliminando el error `Media type mismatch` (`python_backend/media.py`).
  3. Sincronización estricta de subtítulos SRT y ASS ante fragmentos cortados/eliminados con Remotion (`python_backend/media.py`).
  4. Rediseño de alto contraste para el botón "Dividir en cabezal" (`CandidatePreviewModal.tsx`).
  5. Persistencia unificada de inicio/fin y cortes internos en `localStorage` al hacer clic en "Guardar Ajuste" (`CandidatePreviewModal.tsx`).
  6. Feedback visual en tiempo real con spinner animado durante la exportación y canalización de logs a `log_buffer` (`CandidatePreviewModal.tsx`, `media.py`, `api.py`).
  7. Actualización del registro de decisiones D-019 y D-020 (`DECISIONS.md`).
  8. Planes de acción documentados (`plans/17-...md`, `plans/18-...md`).

---

## 2. Alcance

### Archivos a Incluir en el Commit:
- `python_backend/llm.py`
- `python_backend/media.py`
- `python_backend/api.py`
- `src/components/modals/CandidatePreviewModal.tsx`
- `build_portable.py`
- `DECISIONS.md`
- `plans/17-autocarga-lmstudio-y-diagnostico-exportacion-video.md`
- `plans/18-fix-ffmpeg-concat-interleaved-y-persistencia-cortes.md`
- `plans/19-commit-y-sincronizacion-release-v26-con-main.md`

### Ramas a Sincronizar:
- `release-v2.6` (rama de la versión)
- `main` (rama principal de producción)
- `origin/release-v2.6` y `origin/main` (remoto en GitHub)

---

## 3. Paso a Paso Técnico

1. **Cambio a la rama `release-v2.6`:**
   - Ejecutar `git checkout release-v2.6` preservando los cambios validados en el árbol de trabajo.
2. **Creación del Commit en `release-v2.6`:**
   - Añadir los archivos modificados y los planes:
     ```bash
     git add DECISIONS.md build_portable.py python_backend/ src/ plans/
     ```
   - Crear el commit siguiendo el formato de Conventional Commits:
     ```bash
     git commit -m "fix(release-v2.6): autocarga lmstudio 16k, ffmpeg concat intercalado y persistencia de cortes"
     ```
3. **Fusión en `main`:**
   - Cambiar a la rama `main`: `git checkout main`.
   - Fusionar los cambios de `release-v2.6` mediante avance rápido (*fast-forward*):
     ```bash
     git merge release-v2.6 --ff-only
     ```
4. **Sincronización con GitHub (`origin`):**
   - Subir el nuevo commit a `origin` tanto para `release-v2.6` como para `main`:
     ```bash
     git push origin release-v2.6 main
     ```
5. **Verificación final del árbol de Git:**
   - Ejecutar `git status` y `git log -n 3 --oneline --graph --decorate` para certificar que el working tree está limpio y ambas ramas apuntan al nuevo commit idéntico sincronizado con `origin`.

---

## 4. Riesgos e Implicaciones

| Riesgo | Mitigación |
|---|---|
| Conflicto de fusión entre `release-v2.6` y `main` | Ninguno: ambas ramas parten del mismo commit `d275c6a`, por lo que el merge será puramente fast-forward (`--ff-only`) garantizando cero divergencia. |
| Olvidar archivos de plan o decisiones | Se audita con `git status` que todo quede registrado y el working tree termine 100% limpio. |

---

## 5. Estrategia de Testing (Validación Previa al Commit)

1. **Unit, Integration y E2E Tests:**
   - La suite completa de 24 tests de `scratch/test_*.py` ya fue ejecutada y validada con **24 passed, 0 failed (100% OK)**.
2. **Frontend Build Check:**
   - El frontend fue compilado con `pnpm run build` sin errores de TypeScript ni dependencias.
3. **Distribución Portable:**
   - El paquete `.tar.gz` ya fue construido con SHA-256 verificado y sincronizado en `C:\Users\JEFF\Desktop\AutoShorts - Portable`.

---

## 6. Skills del Workspace Aplicadas

- **`senior-code-craft`**: Estándar de control de versiones y ramas limpias sin bifurcaciones innecesarias ni commits sucios.
- **`antislop-code`**: Mensajes de commit directos, semánticos y concisos sin adornos ni verbosidad superflua.

---

> [!IMPORTANT]
> **GATE DE APROBACIÓN EXPLÍCITA (RULE[user_global]):**
> Este plan requiere tu autorización formal antes de ejecutar los comandos de Git.
> Para proceder, responde exactamente: **`PLAN APROBADO`**.

