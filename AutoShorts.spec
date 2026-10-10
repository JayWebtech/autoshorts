# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import sys

base_dir = Path.cwd()

added_files = [
    (str(base_dir / "dist"), "dist"),
]
if (base_dir / "icon.ico").exists():
    added_files.append((str(base_dir / "icon.ico"), "."))

a = Analysis(
    ['run.py'],
    pathex=[str(base_dir)],
    binaries=[],
    datas=added_files,
    hiddenimports=[
        'python_backend',
        'python_backend.api',
        'python_backend.db',
        'python_backend.llm',
        'python_backend.media',
        'python_backend.stream_server',
        'python_backend.transcription',
        'webview',
        'webview.platforms',
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'requests',
        'sqlite3',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='AutoShorts',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(base_dir / "icon.ico") if (base_dir / "icon.ico").exists() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='AutoShorts',
)
