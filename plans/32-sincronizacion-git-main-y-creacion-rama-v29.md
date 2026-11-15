# Plan 32: Sincronización de Git — Creación de Rama `release-v2.9` y Fusión con `main`

## 1. Diagnóstico y Contexto
- **Estado Actual de Git:**
  - Los desarrollos de las versiones v2.7, v2.8 y v2.9 (hasta el commit `ae579ef`) se consolidaron directamente en la rama de trabajo `release-v2.8`.
  - La rama `main` se encuentra actualmente en el commit `997b0cd` (Release v2.6), por lo que está 13 commits por detrás de `release-v2.8`.
  - La rama oficial para la versión 2.9 (`release-v2.9`) no ha sido creada aún en el árbol de ramas locales ni remotas.
- **Solicitud del Usuario:**
  - Llevar los cambios consolidados a la rama principal `main`.
  - Crear la rama `release-v2.9` correspondiente a la versión actual `v2.9.0` para mantener la convención histórica del repositorio (`release-v1.0`, `release-v1.5`, `release-v2.0`, `release-v2.5`, `release-v2.6`, `release-v2.7`, `release-v2.8`, `release-v2.9`).

---

## 2. Alcance
- **Ramas Locales:**
  - `release-v2.8` (se mantiene intacta en commit `ae579ef`).
  - `release-v2.9` (creada a partir de `release-v2.8` en commit `ae579ef`).
  - `main` (actualizada mediante fusión *fast-forward* al commit `ae579ef`).
- **Ramas Remotas (`origin`):**
  - Subir `main`, `release-v2.8` y `release-v2.9` a GitHub (`origin`).

---

## 3. Paso a Paso Técnico

1. **Persistencia del Plan 32 en Git:**
   - Añadir y commitear el archivo del plan en `release-v2.8` para mantener el árbol 100% limpio:
     ```bash
     git add plans/32-sincronizacion-git-main-y-creacion-rama-v29.md
     git commit -m "docs: registrar plan 32 de sincronizacion git y release-v2.9"
     ```
2. **Creación de la Rama `release-v2.9` y Etiquetado de Versión:**
   - Crear y cambiar a la rama oficial `release-v2.9`:
     ```bash
     git checkout -b release-v2.9
     ```
   - Crear tag anotado de versión:
     ```bash
     git tag -a v2.9.0 -m "Release v2.9.0 - OpenRouter Cloud, Macro-Chunks, Portable ZIP y GUI Subsystem 2"
     ```
3. **Fusión Lineal en `main` mediante Fast-Forward:**
   - Cambiar a la rama `main`:
     ```bash
     git checkout main
     ```
   - Fusionar los cambios consolidados sin commits espurios:
     ```bash
     git merge release-v2.9 --ff-only
     ```
4. **Sincronización Exhaustiva con GitHub (`origin`):**
   - Subir `main`, las ramas de versiones históricas y la nueva rama con upstream tracking, junto con el tag:
     ```bash
     git push origin main
     git push origin release-v2.7
     git push -u origin release-v2.8
     git push -u origin release-v2.9
     git push origin v2.9.0
     ```
5. **Verificación y Estado Final Determinista:**
   - Ejecutar `git branch -v` y `git status` para certificar que `main`, `release-v2.8` y `release-v2.9` apuntan al mismo commit sincronizado con `origin` y árbol 100% limpio.
   - Dejar el checkout activo en `main` como rama principal de producción.

---

## 4. Riesgos y Auditoría Goldfish (EGM)
- **Riesgo 1 (Divergencia entre `main` y `release-v2.8`):** Si `main` tuviera commits independientes posteriores a `997b0cd`, `--ff-only` fallaría.
  - *Mitigación:* Verificado con `git log main..release-v2.8`: `release-v2.8` contiene estrictamente a `main` como ancestro directo sin bifurcaciones (`997b0cd` es el padre directo de `2a2d988`). El avance rápido (`--ff-only`) está 100% garantizado matemáticamente.
- **Riesgo 2 (Credenciales o conectividad con `origin`):** Si el token o SSH expiró o si hay restricciones de red.
  - *Mitigación:* Se valida primero la operación local (`branch` y `merge`) y luego se ejecuta el `push`. Si el remoto requiere credenciales del usuario, se reportará claramente sin romper el estado local.

---

## 5. Estrategia de Testing
- Verificación previa: suite de 39 tests ya ejecutada con **100% verde**.
- Verificación posterior de Git:
  - `git branch -a`
  - `git log -n 1 --oneline` en `main`, `release-v2.8` y `release-v2.9`.
  - Comprobación de que `AutoShorts-v2.9.0-windows-x64-portable.zip` en `dist/` permanece inalterado.
