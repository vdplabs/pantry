from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

LABEL = "com.vdplabs.pantry.serve"


def default_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def default_logs_dir() -> Path:
    return Path.home() / "Library" / "Logs"


def find_pantry_executable() -> str:
    venv_bin = Path(sys.prefix) / "bin" / "pantry"
    if venv_bin.is_file():
        return str(venv_bin)
    which = shutil.which("pantry")
    if which:
        return which
    return sys.executable


def generate_plist_xml(
    executable: str,
    *,
    host: str = "127.0.0.1",
    port: int = 18787,
    home: Path | None = None,
    data: Path | None = None,
    menubar: bool = True,
    worker_isolation: bool = False,
) -> str:
    args = [executable, "serve", "--host", host, "--port", str(port)]
    if home:
        args.extend(["--home", str(home.resolve())])
    if data:
        args.extend(["--data", str(data.resolve())])
    if not menubar:
        args.append("--no-menubar")
    if worker_isolation:
        args.append("--worker-isolation")

    logs = default_logs_dir()
    stdout_log = logs / "pantry-serve.out.log"
    stderr_log = logs / "pantry-serve.err.log"

    args_xml = "\n".join(f"    <string>{arg}</string>" for arg in args)
    env_xml_parts = [
        "    <key>PATH</key>",
        f"    <string>{os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin')}</string>",
    ]
    if home:
        env_xml_parts.extend(["    <key>PANTRY_HOME</key>", f"    <string>{home.resolve()}</string>"])
    if data:
        env_xml_parts.extend(["    <key>PANTRY_DATA</key>", f"    <string>{data.resolve()}</string>"])
    env_xml = "\n".join(env_xml_parts)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{args_xml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>{stdout_log}</string>
  <key>StandardErrorPath</key>
  <string>{stderr_log}</string>
  <key>EnvironmentVariables</key>
  <dict>
{env_xml}
  </dict>
</dict>
</plist>
"""


def write_plist(plist_content: str, dest: Path | None = None) -> Path:
    target = dest or default_plist_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(plist_content, encoding="utf-8")
    return target


def install_service(
    *,
    host: str = "127.0.0.1",
    port: int = 18787,
    home: Path | None = None,
    data: Path | None = None,
    menubar: bool = True,
    worker_isolation: bool = False,
    executable: str | None = None,
) -> dict[str, Any]:
    exe = executable or find_pantry_executable()
    content = generate_plist_xml(
        exe,
        host=host,
        port=port,
        home=home,
        data=data,
        menubar=menubar,
        worker_isolation=worker_isolation,
    )
    plist_path = write_plist(content)

    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, check=False)
    load_res = subprocess.run(
        ["launchctl", "load", str(plist_path)],
        capture_output=True,
        text=True,
        check=False,
    )

    return {
        "ok": load_res.returncode == 0,
        "label": LABEL,
        "plist": str(plist_path),
        "executable": exe,
        "message": (
            "Service installed and loaded successfully."
            if load_res.returncode == 0
            else f"Installed plist, but launchctl load returned: {load_res.stderr.strip()}"
        ),
    }


def uninstall_service() -> dict[str, Any]:
    plist_path = default_plist_path()
    if not plist_path.exists():
        return {
            "ok": True,
            "label": LABEL,
            "message": "Service plist does not exist; nothing to uninstall.",
        }

    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, check=False)
    try:
        plist_path.unlink()
    except OSError as e:
        return {"ok": False, "label": LABEL, "error": str(e)}

    return {
        "ok": True,
        "label": LABEL,
        "message": "Service unloaded and plist removed.",
    }


def start_service() -> dict[str, Any]:
    plist_path = default_plist_path()
    if not plist_path.exists():
        return {
            "ok": False,
            "label": LABEL,
            "error": "Service is not installed. Run 'pantry service install' first.",
        }
    res = subprocess.run(
        ["launchctl", "start", LABEL],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "ok": res.returncode == 0,
        "label": LABEL,
        "message": "Service start triggered." if res.returncode == 0 else res.stderr.strip(),
    }


def stop_service() -> dict[str, Any]:
    res = subprocess.run(
        ["launchctl", "stop", LABEL],
        capture_output=True,
        text=True,
        check=False,
    )
    return {
        "ok": res.returncode == 0,
        "label": LABEL,
        "message": "Service stop triggered." if res.returncode == 0 else res.stderr.strip(),
    }


def status_service(host: str = "127.0.0.1", port: int = 18787) -> dict[str, Any]:
    plist_path = default_plist_path()
    installed = plist_path.exists()
    pid = None
    last_exit_code = None

    if installed:
        res = subprocess.run(
            ["launchctl", "list", LABEL],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                line = line.strip()
                if line.startswith('"PID" ='):
                    try:
                        pid = int(line.split("=")[1].strip().rstrip(";"))
                    except Exception:  # noqa: BLE001, S110
                        pass
                elif line.startswith('"LastExitStatus" ='):
                    try:
                        last_exit_code = int(line.split("=")[1].strip().rstrip(";"))
                    except Exception:  # noqa: BLE001, S110
                        pass

    http_healthy = False
    health_payload = None
    try:
        import httpx

        r = httpx.get(f"http://{host}:{port}/v1/health", timeout=1.0)
        if r.status_code == 200:
            http_healthy = True
            health_payload = r.json()
    except Exception:  # noqa: BLE001, S110
        pass

    return {
        "label": LABEL,
        "installed": installed,
        "plist": str(plist_path) if installed else None,
        "running": pid is not None or http_healthy,
        "pid": pid,
        "last_exit_status": last_exit_code,
        "http_healthy": http_healthy,
        "health": health_payload,
    }
