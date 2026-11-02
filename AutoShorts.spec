# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_dynamic_libs

block_cipher = None

datas = [
    ('dist/index.html', 'dist'),
    ('dist/assets', 'dist/assets'),
    ('icon.ico', '.'),
    ('icon.png', '.'),
    ('public', 'public'),
]

# Recolectar datos y modelos auxiliares para Faster-Whisper y CTranslate2 (Silero VAD ONNX, etc.)
datas += collect_data_files('faster_whisper')
datas += collect_data_files('ctranslate2')

binaries = []
# Bundle local ffmpeg / ffprobe if available
ffmpeg_bin = Path(r"C:\ffmpeg\bin")
if (ffmpeg_bin / "ffmpeg.exe").is_file():
    binaries.append((str(ffmpeg_bin / "ffmpeg.exe"), "bin"))
if (ffmpeg_bin / "ffprobe.exe").is_file():
    binaries.append((str(ffmpeg_bin / "ffprobe.exe"), "bin"))

# Recolectar librerias dinamicas de ctranslate2 (cudnn64, libiomp5md, etc.)
binaries += collect_dynamic_libs('ctranslate2')

# Recolectar librerias cuBLAS CUDA de NVIDIA (cublas64_12.dll y cublasLt64_12.dll) para aceleracion GPU
for torch_lib_candidate in [
    Path(r"C:\Users\JEFF\AppData\Local\Programs\Python\Python311\Lib\site-packages\torch\lib"),
    Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib",
]:
    if torch_lib_candidate.is_dir():
        for dll_name in ["cublas64_12.dll", "cublasLt64_12.dll"]:
            dll_p = torch_lib_candidate / dll_name
            if dll_p.is_file():
                binaries.append((str(dll_p), "ctranslate2"))
                binaries.append((str(dll_p), "."))
        break

hiddenimports = [
    'faster_whisper',
    'ctranslate2',
    'webview',
    'webview.platforms.winforms',
    'webview.platforms.edgechromium',
    'clr',
    'requests',
    'PIL',
    'sqlite3',
    'python_backend',
    'python_backend.api',
    'python_backend.db',
    'python_backend.llm',
    'python_backend.llm_prompts',
    'python_backend.media',
    'python_backend.stream_server',
    'python_backend.telemetry',
    'python_backend.transcription',
    'python_backend.version',
    'python_backend.paths',
    'python_backend.logger',
    'python_backend.services.project_service',
]
# Recolectar recursivamente todos los submodulos internos de faster_whisper y ctranslate2
hiddenimports += collect_submodules('faster_whisper')
hiddenimports += collect_submodules('ctranslate2')

a = Analysis(
    ['run.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'torch',
        'torchvision',
        'torchaudio',
        'torchtext',
        'tkinter',
        'matplotlib',
        'scipy',
        'pandas',
        'IPython',
        'notebook',
        'pytest'
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='AutoShorts',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='AutoShorts',
)
