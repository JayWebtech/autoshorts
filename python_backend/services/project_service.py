import os
import re
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, Optional


def resolve_project_dir(db: Any, project: Dict[str, Any]) -> Path:
    """Calculates and prepares standard project directory structure."""
    proj_dir_val = project.get("projectDir")
    if proj_dir_val and str(proj_dir_val).strip():
        p = Path(str(proj_dir_val).strip())
    else:
        proj_name = project.get("name") or (Path(project["sourcePath"]).stem if project.get("sourcePath") else project["id"])
        clean_name = re.sub(r'[\U00010000-\U0010ffff\u2600-\u27bf\ufe00-\ufe0f\u200d\u2300-\u23ff\u2b50-\u2b55]', '', proj_name)
        clean_name = re.sub(r'[\\/*?:"<>|#]', "", clean_name).strip() or project["id"]
        p = Path.home() / "Documents" / "AutoShorts" / clean_name
        try:
            db.update_project_dir(project["id"], str(p))
        except Exception:
            pass

    os.makedirs(p, exist_ok=True)
    os.makedirs(p / "audio", exist_ok=True)
    os.makedirs(p / "clips", exist_ok=True)
    os.makedirs(p / "summary", exist_ok=True)
    return p


def open_media_file(path: Optional[str]) -> bool:
    if path:
        p = Path(path)
        if p.exists():
            try:
                os.startfile(str(p))
                return True
            except Exception as e:
                print(f"Error opening media file: {e}")
    return False


def open_folder(path: Optional[str]) -> bool:
    if path:
        p = Path(path)
        folder = p.parent if p.is_file() else p
        if folder.exists():
            try:
                os.startfile(str(folder))
            except Exception as e:
                print(f"Error opening folder: {e}")
    return True


def move_project_folder_action(
    db: Any,
    project_id: str,
    new_parent_dir: str,
    get_project_dir_fn: Callable[[Dict[str, Any]], Path]
) -> Dict[str, Any]:
    if not project_id:
        raise ValueError("Missing projectId")
    if not new_parent_dir or not os.path.exists(new_parent_dir):
        raise FileNotFoundError(f"Carpeta de destino no existe: {new_parent_dir}")

    proj = db.get_project(project_id)
    current_dir = get_project_dir_fn(proj)

    folder_name = current_dir.name
    dest_dir = Path(new_parent_dir) / folder_name

    if dest_dir.resolve() == current_dir.resolve():
        return {"success": True, "projectDir": str(current_dir), "message": "La carpeta ya está en esa ubicación."}

    if dest_dir.exists():
        counter = 1
        while dest_dir.exists():
            dest_dir = Path(new_parent_dir) / f"{folder_name}_{counter}"
            counter += 1

    try:
        shutil.move(str(current_dir), str(dest_dir))
    except Exception:
        shutil.copytree(str(current_dir), str(dest_dir), dirs_exist_ok=True)
        shutil.rmtree(str(current_dir), ignore_errors=True)

    updated = db.update_project_dir(project_id, str(dest_dir))
    return {
        "success": True,
        "projectDir": str(dest_dir),
        "project": updated
    }
