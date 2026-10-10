import os
import sys
import subprocess
from pathlib import Path


def main():
    root_dir = Path(__file__).resolve().parent
    os.chdir(root_dir)

    print("============================================")
    print("      AutoShorts Windows Executable Builder ")
    print("============================================")

    # 1. Ensure icon.ico exists
    icon_png = root_dir / "icon.png"
    icon_ico = root_dir / "icon.ico"
    if icon_png.exists() and not icon_ico.exists():
        print("Converting icon.png to icon.ico...")
        try:
            from PIL import Image
            img = Image.open(icon_png)
            img.save(icon_ico, format="ICO")
            print("Icon converted successfully.")
        except Exception as e:
            print(f"Warning: Could not create icon.ico: {e}")

    # 2. Build Frontend React bundle
    print("\n[1/3] Building frontend assets (pnpm run build)...")
    res = subprocess.run("cmd /c pnpm run build", shell=True)
    if res.returncode != 0:
        print("pnpm failed, trying npm...")
        res = subprocess.run("cmd /c npm run build", shell=True)
        if res.returncode != 0:
            print("ERROR: Failed to build frontend.")
            sys.exit(1)

    dist_index = root_dir / "dist" / "index.html"
    if not dist_index.exists():
        print(f"ERROR: Expected {dist_index} does not exist.")
        sys.exit(1)
    print("Frontend bundle verified in 'dist/'.")

    # 3. Check / Install PyInstaller
    print("\n[2/3] Checking PyInstaller...")
    try:
        import PyInstaller
        print(f"PyInstaller version {PyInstaller.__version__} detected.")
    except ImportError:
        print("Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # 4. Run PyInstaller build
    print("\n[3/3] Compiling AutoShorts.exe with PyInstaller...")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "AutoShorts.spec",
        "--distpath", "release",
        "--workpath", "build_tmp",
        "--noconfirm"
    ]
    subprocess.check_call(cmd)

    exe_path = root_dir / "release" / "AutoShorts" / "AutoShorts.exe"
    if exe_path.exists():
        print("\n============================================")
        print("  SUCCESS! AutoShorts.exe has been compiled.")
        print(f"  Location: {exe_path}")
        print("============================================")
        print("You can create a desktop shortcut to 'AutoShorts.exe' or distribute the entire 'release/AutoShorts' folder.")
    else:
        print("\nBuild finished but executable was not found at expected path.")


if __name__ == "__main__":
    main()
