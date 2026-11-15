"""
Script de construccion y empaquetado portable para AutoShorts.
Genera la distribucion onedir compilada y el paquete comprimido .tar.gz (Gzip nivel 9) con hash SHA-256.
"""

import os
import sys
import shutil
import hashlib
import tarfile
import subprocess
from pathlib import Path
import pefile

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(PROJECT_ROOT))

from python_backend.version import __version__, APP_NAME


def ensure_gui_subsystem(exe_path: Path):
    """
    Inspecciona y fuerza la cabecera PE de AutoShorts.exe a Subsystem: 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI).
    Evita de forma permanente que Windows abra una terminal CMD obligatoria al lanzar el portable.
    """
    print(f"\n[*] Verificando cabecera PE en {exe_path.name}...")
    pe = pefile.PE(str(exe_path))
    curr_sub = pe.OPTIONAL_HEADER.Subsystem
    if curr_sub != 2:
        print(f"[*] Ajustando Subsystem PE de {curr_sub} a 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)...")
        pe.OPTIONAL_HEADER.Subsystem = 2
        pe.OPTIONAL_HEADER.CheckSum = pe.generate_checksum()
        pe_offset = pe.DOS_HEADER.e_lfanew
        opt_offset = pe_offset + 4 + 20
        subsystem_offset = opt_offset + 68
        pe.close()
        with open(exe_path, "r+b") as f:
            f.seek(subsystem_offset)
            f.write((2).to_bytes(2, byteorder="little"))
        print("    Cabecera PE corregida exitosamente a Subsystem 2 (GUI pura).")
    else:
        pe.close()
        print("    Cabecera PE ya es Subsystem 2 (GUI pura, sin terminal).")



def compute_sha256(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def run_command(cmd: str, desc: str):
    print(f"\n[*] {desc}...")
    print(f"    Ejecutando: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=str(PROJECT_ROOT))
    if res.returncode != 0:
        print(f"\n[ERROR] Falló: {desc} (código de salida: {res.returncode})")
        sys.exit(res.returncode)


def main():
    print("=" * 60)
    print(f"      Construyendo paquete portable para {APP_NAME} v{__version__}")
    print("=" * 60)

    # 1. Compilar frontend de React con pnpm
    run_command("pnpm.cmd run build", "Compilando frontend de producción con pnpm")

    # 2. Purgar compilación previa y compilar con PyInstaller en modo onedir
    output_dir = PROJECT_ROOT / "dist" / "AutoShorts"
    build_dir = PROJECT_ROOT / "build" / "AutoShorts"
    if output_dir.exists():
        try:
            shutil.rmtree(output_dir)
        except Exception as e:
            print(f"[!] Aviso al limpiar dist/AutoShorts: {e}")
    if build_dir.exists():
        try:
            shutil.rmtree(build_dir)
        except Exception as e:
            print(f"[!] Aviso al limpiar build/AutoShorts: {e}")

    run_command("pyinstaller -y --clean AutoShorts.spec", "Compilando backend ejecutable con PyInstaller (onedir)")

    output_dir = PROJECT_ROOT / "dist" / "AutoShorts"
    if not output_dir.exists() or not (output_dir / "AutoShorts.exe").exists():
        print("\n[ERROR] No se encontró el ejecutable generado en dist/AutoShorts/AutoShorts.exe")
        sys.exit(1)

    # 2.5 Asegurar que el ejecutable tenga Subsystem = 2 (GUI, sin terminal CMD)
    ensure_gui_subsystem(output_dir / "AutoShorts.exe")

    # 3. Crear archivo marcador portable.mode y carpeta data inicial
    portable_marker = output_dir / "portable.mode"
    with open(portable_marker, "w", encoding="utf-8") as f:
        f.write("# AutoShorts Portable Mode - Data will be stored locally in ./data/\n")
    os.makedirs(output_dir / "data", exist_ok=True)

    # 4. Comprimir en archivo tar.gz de distribución (Gzip nivel 9)
    tar_name = f"AutoShorts-v{__version__}-windows-x64-portable.tar.gz"
    tar_path = PROJECT_ROOT / "dist" / tar_name

    print(f"\n[*] Comprimiendo {output_dir.name} en {tar_name} (tar.gz con gzip nivel 9)...")
    if tar_path.exists():
        try:
            os.remove(tar_path)
        except Exception:
            pass

    file_count = 0
    with tarfile.open(tar_path, "w:gz", compresslevel=9) as tf:
        for root, _, files in os.walk(output_dir):
            for file in files:
                full_path = Path(root) / file
                arc_name = Path("AutoShorts") / full_path.relative_to(output_dir)
                tf.add(full_path, arcname=str(arc_name).replace("\\", "/"))
                file_count += 1

    size_mb = tar_path.stat().st_size / (1024 * 1024)
    sha256 = compute_sha256(tar_path)

    sha_file = tar_path.with_name(f"{tar_name}.sha256")
    with open(sha_file, "w", encoding="utf-8") as f:
        f.write(f"{sha256}  {tar_name}\n")

    print("\n" + "=" * 60)
    print("      CONSTRUCCIÓN Y EMPAQUETADO PORTABLE EXITOSO")
    print("=" * 60)
    print(f" Aplicación:     {APP_NAME} v{__version__}")
    print(f" Directorio:     {output_dir}")
    print(f" Paquete tar.gz: {tar_path}")
    print(f" Tamaño tar.gz:  {size_mb:.2f} MB ({file_count} archivos incluidos)")
    print(f" SHA-256:        {sha256}")
    print(f" Hash Check:     {sha_file}")
    print("=" * 60)


if __name__ == "__main__":
    main()
