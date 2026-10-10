import ctypes
import os
import subprocess
import time
from typing import Dict, Any, Optional

# Windows kernel32 FILETIME structure for non-blocking CPU calculation
class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", ctypes.c_uint), ("dwHighDateTime", ctypes.c_uint)]


def _ft_to_int(ft: FILETIME) -> int:
    return (ft.dwHighDateTime << 32) + ft.dwLowDateTime


_last_idle = 0
_last_kernel = 0
_last_user = 0
_last_cpu_time = 0.0
_cached_cpu_pct = 0.0

_cached_telemetry: Optional[Dict[str, Any]] = None
_last_telemetry_time = 0.0


def get_cpu_usage() -> float:
    global _last_idle, _last_kernel, _last_user, _last_cpu_time, _cached_cpu_pct
    now = time.time()

    # If sampled within 500ms, return cached value to avoid spin
    if now - _last_cpu_time < 0.5 and _cached_cpu_pct > 0:
        return _cached_cpu_pct

    if os.name != "nt":
        return 0.0

    try:
        idle = FILETIME()
        kernel = FILETIME()
        user = FILETIME()
        if not ctypes.windll.kernel32.GetSystemTimes(
            ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
        ):
            return _cached_cpu_pct

        idle_val = _ft_to_int(idle)
        kernel_val = _ft_to_int(kernel)
        user_val = _ft_to_int(user)

        if _last_cpu_time > 0:
            diff_idle = idle_val - _last_idle
            diff_kernel = kernel_val - _last_kernel
            diff_user = user_val - _last_user
            diff_total = diff_kernel + diff_user

            if diff_total > 0:
                pct = (1.0 - (diff_idle / diff_total)) * 100.0
                _cached_cpu_pct = max(0.0, min(100.0, round(pct, 1)))

        _last_idle = idle_val
        _last_kernel = kernel_val
        _last_user = user_val
        _last_cpu_time = now
    except Exception:
        pass

    return _cached_cpu_pct


def get_gpu_telemetry() -> Dict[str, Any]:
    # Query nvidia-smi with nounits
    gpu_data = {
        "hasGpu": False,
        "gpuName": "Integrated / CPU",
        "gpuUsagePercent": 0,
        "gpuTempC": 0,
        "vramTotalMb": 0,
        "vramUsedMb": 0,
        "vramFreeMb": 0,
        "vramUsagePercent": 0.0,
    }

    try:
        startupinfo = None
        if os.name == "nt":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        res = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.total,memory.used,memory.free,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2.0,
            startupinfo=startupinfo,
        )

        if res.returncode == 0 and res.stdout.strip():
            parts = [p.strip() for p in res.stdout.strip().split(",")]
            if len(parts) >= 6:
                name = parts[0]
                usage = int(parts[1]) if parts[1].isdigit() else 0
                total_mb = int(parts[2]) if parts[2].isdigit() else 0
                used_mb = int(parts[3]) if parts[3].isdigit() else 0
                free_mb = int(parts[4]) if parts[4].isdigit() else 0
                temp = int(parts[5]) if parts[5].isdigit() else 0

                vram_pct = round((used_mb / total_mb * 100), 1) if total_mb > 0 else 0.0

                gpu_data = {
                    "hasGpu": True,
                    "gpuName": name,
                    "gpuUsagePercent": usage,
                    "gpuTempC": temp,
                    "vramTotalMb": total_mb,
                    "vramUsedMb": used_mb,
                    "vramFreeMb": free_mb,
                    "vramUsagePercent": vram_pct,
                }
                return gpu_data
    except Exception:
        pass

    # Fallback to PyTorch CUDA if nvidia-smi failed
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            total_mb = int(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
            allocated_mb = int(torch.cuda.memory_allocated(0) / (1024 * 1024))
            free_mb = max(0, total_mb - allocated_mb)
            vram_pct = round((allocated_mb / total_mb * 100), 1) if total_mb > 0 else 0.0

            gpu_data = {
                "hasGpu": True,
                "gpuName": name,
                "gpuUsagePercent": 0,
                "gpuTempC": 0,
                "vramTotalMb": total_mb,
                "vramUsedMb": allocated_mb,
                "vramFreeMb": free_mb,
                "vramUsagePercent": vram_pct,
            }
    except Exception:
        pass

    return gpu_data


def get_hardware_telemetry() -> Dict[str, Any]:
    global _cached_telemetry, _last_telemetry_time
    now = time.time()

    if _cached_telemetry is not None and (now - _last_telemetry_time < 1.2):
        return _cached_telemetry

    gpu = get_gpu_telemetry()
    cpu_pct = get_cpu_usage()

    data = {
        **gpu,
        "cpuUsagePercent": cpu_pct,
    }
    _cached_telemetry = data
    _last_telemetry_time = now
    return data
