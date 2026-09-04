from __future__ import annotations

from pantry.service import generate_plist_xml, write_plist


def test_generate_plist_xml(tmp_path):
    home = tmp_path / "home"
    data = tmp_path / "data"
    # Test with menubar=False (explicit headless)
    xml_headless = generate_plist_xml(
        "/usr/local/bin/pantry",
        host="127.0.0.1",
        port=18787,
        home=home,
        data=data,
        menubar=False,
        worker_isolation=True,
    )
    assert "<string>com.vdplabs.pantry.serve</string>" in xml_headless
    assert "<true/>" in xml_headless
    assert "<string>/usr/local/bin/pantry</string>" in xml_headless
    assert "<string>serve</string>" in xml_headless
    assert "<string>--host</string>" in xml_headless
    assert "<string>127.0.0.1</string>" in xml_headless
    assert "<string>--no-menubar</string>" in xml_headless
    assert "<string>Aqua</string>" not in xml_headless
    assert "<string>--worker-isolation</string>" in xml_headless
    assert f"<string>{home.resolve()}</string>" in xml_headless
    assert f"<string>{data.resolve()}</string>" in xml_headless

    # Test default (menubar=True)
    xml = generate_plist_xml(
        "/usr/local/bin/pantry",
        host="127.0.0.1",
        port=18787,
    )
    assert "<string>--no-menubar</string>" not in xml
    assert "<string>Aqua</string>" in xml
    assert "<key>PYTHONPATH</key>" in xml

    dest = tmp_path / "test.plist"
    written = write_plist(xml, dest)
    assert written.is_file()
    content = written.read_text(encoding="utf-8")
    assert content == xml


def test_set_accessory_activation_policy():
    import sys
    from unittest.mock import patch

    from pantry.menubar import set_accessory_activation_policy

    res = set_accessory_activation_policy()
    assert isinstance(res, bool)

    # When AppKit is unavailable (e.g. core-only or headless CI), it safely returns False
    with patch.dict(sys.modules, {"AppKit": None}):
        assert set_accessory_activation_policy() is False


