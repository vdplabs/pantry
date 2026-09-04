# Launch at login (optional)

pantry does not require a LaunchAgent. For a login-time daemon:

1. Install pantry into a stable venv (or `uv tool install` once published).
2. Copy [`examples/com.vdplabs.pantry.serve.plist`](examples/com.vdplabs.pantry.serve.plist).
3. Replace `/ABS/PATH/TO/pantry/.venv/bin/pantry` and log paths with yours.
4. Install and load:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cp Docs/examples/com.vdplabs.pantry.serve.plist \
  ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
# edit the plist paths, then:
launchctl load ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
```

Keep the bind address on `127.0.0.1` unless you intentionally expose the API.
