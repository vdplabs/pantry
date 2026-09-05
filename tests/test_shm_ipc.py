from __future__ import annotations

import stat
import time
import socket
import threading
from pathlib import Path

import httpx
import uvicorn
from fastapi.testclient import TestClient

from pantry.server import create_app
from pantry.shm import ShmManager
from pantry.store import PackageStore


def test_shm_manager_allocation_and_permissions(tmp_path: Path):
    shm_dir = tmp_path / "shm"
    mgr = ShmManager(shm_dir, default_ttl=10.0)

    payload = b"TEST_SHARED_MEMORY_ZERO_COPY_PAYLOAD_12345"
    desc = mgr.allocate(payload, format="raw_rgba", prefix="frame", metadata={"width": 64, "height": 64})

    assert desc.key.startswith("frame_")
    assert desc.byte_size == len(payload)
    assert desc.format == "raw_rgba"
    assert desc.metadata["width"] == 64

    buf_path = Path(desc.path)
    assert buf_path.is_file()

    # Permissions must be 0600 (owner read/write only)
    file_stat = buf_path.stat()
    assert (file_stat.st_mode & 0o777) == 0o600

    # Read bytes back
    data = mgr.read_bytes(desc.key)
    assert data == payload


def test_shm_manager_rejects_path_traversal(tmp_path: Path):
    shm_dir = tmp_path / "shm"
    mgr = ShmManager(shm_dir)

    assert not mgr.is_safe_key("../../etc/passwd")
    assert not mgr.is_safe_key("../foo")
    assert not mgr.is_safe_key("/tmp/hacked")
    assert not mgr.is_safe_key("shm_../../test")

    assert mgr.resolve("../../etc/passwd") is None
    assert mgr.read_bytes("../../etc/passwd") is None
    assert not mgr.release("../../etc/passwd")


def test_shm_manager_release_and_cleanup(tmp_path: Path):
    shm_dir = tmp_path / "shm"
    mgr = ShmManager(shm_dir, default_ttl=0.1)

    desc1 = mgr.allocate(b"alpha", prefix="a")
    desc2 = mgr.allocate(b"beta", prefix="b")

    # Explicit release of desc1
    assert mgr.release(desc1.key)
    assert mgr.resolve(desc1.key) is None
    assert not mgr.release(desc1.key)  # second release is false

    # Wait for TTL expiration of desc2
    time.sleep(0.15)
    removed = mgr.cleanup(ttl_seconds=0.1)
    assert removed >= 1
    assert mgr.resolve(desc2.key) is None


def test_image_generations_shm_transport(client: TestClient):
    body = {
        "model": "image-compact",
        "prompt": "a bright green circle on black",
        "size": "64x64",
        "response_format": "shm",
    }
    r = client.post("/v1/images/generations", json=body)
    assert r.status_code == 200, r.text
    data = r.json()

    assert "data" in data
    assert len(data["data"]) == 1
    item = data["data"][0]

    # In SHM mode, b64_json is omitted and shm descriptor is returned
    assert "b64_json" not in item
    assert "shm" in item
    shm_desc = item["shm"]
    assert "key" in shm_desc
    assert "path" in shm_desc
    assert shm_desc["format"] == "png"
    assert shm_desc["byte_size"] > 0
    assert shm_desc["width"] == 64
    assert shm_desc["height"] == 64

    # Fetch raw bytes via GET /v1/shm/{key}
    key = shm_desc["key"]
    get_res = client.get(f"/v1/shm/{key}")
    assert get_res.status_code == 200
    assert get_res.headers["content-type"] == "application/octet-stream"
    assert len(get_res.content) == shm_desc["byte_size"]
    # PNG signature check
    assert get_res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # Explicit delete via DELETE /v1/shm/{key}
    del_res = client.delete(f"/v1/shm/{key}")
    assert del_res.status_code == 200
    assert del_res.json()["ok"] is True

    # After delete, key returns 404
    assert client.get(f"/v1/shm/{key}").status_code == 404


def test_audio_generations_shm_header(client: TestClient):
    body = {
        "model": "music-compact",
        "prompt": "ambient drone",
        "duration_seconds": 0.5,
    }
    # Pass via X-Pantry-Transport: shm header
    r = client.post("/v1/audio/generations", json=body, headers={"X-Pantry-Transport": "shm"})
    assert r.status_code == 200, r.text
    data = r.json()

    assert "data" in data
    item = data["data"][0]
    assert "shm" in item
    shm_desc = item["shm"]
    assert shm_desc["format"] == "wav"
    assert shm_desc["byte_size"] > 0

    key = shm_desc["key"]
    get_res = client.get(f"/v1/shm/{key}")
    assert get_res.status_code == 200
    assert get_res.content[:4] == b"RIFF"


def test_uds_server_communication(tmp_path: Path, catalog_dir: Path):
    """Verify live serving over Unix Domain Socket with zero TCP stack."""
    store = PackageStore(tmp_path / "uds_home")
    store.ensure()
    store.seed_from_catalog(catalog_dir)

    # Use /tmp for socket path because Darwin has a strict 104-byte AF_UNIX limit,
    # and pytest's nested tmp_path in /var/folders often exceeds it.
    sock_path = Path(f"/tmp/pantry_test_{time.time_ns()}.sock")
    sock_path.unlink(missing_ok=True)

    s_uds = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s_uds.bind(str(sock_path))
    s_uds.listen(128)

    app = create_app(store)
    cfg = uvicorn.Config(app, log_level="error")
    srv = uvicorn.Server(cfg)

    thread = threading.Thread(target=lambda: srv.run(sockets=[s_uds]), daemon=True)
    thread.start()

    time.sleep(0.4)

    try:
        transport = httpx.HTTPTransport(uds=str(sock_path))
        with httpx.Client(transport=transport, timeout=5.0) as uclient:
            res = uclient.get("http://localhost/v1/health")
            assert res.status_code == 200
            payload = res.json()
            assert payload["ok"] is True
            assert payload["name"] == "pantry"
            assert "shm" in payload
    finally:
        srv.should_exit = True
        thread.join(timeout=3.0)
        sock_path.unlink(missing_ok=True)
