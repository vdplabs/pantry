# Launch at login (Service Management)

pantry provides a first-class CLI for managing its macOS LaunchAgent daemon:

## CLI Commands

```bash
# 1. Install and load pantry as a login daemon (menu bar status item enabled by default)
pantry service install

# Optional: run headless without menu bar, or with worker isolation and custom paths
pantry service install --no-menubar --worker-isolation --home "$PANTRY_HOME" --data "$PANTRY_DATA"

# 2. Check service status and running PID
pantry service status

# 3. Start or stop the service
pantry service start
pantry service stop

# 4. Uninstall and remove the LaunchAgent plist
pantry service uninstall
```

Logs are automatically routed to `~/Library/Logs/pantry-serve.out.log` and `~/Library/Logs/pantry-serve.err.log`.

## Manual Plist Configuration (Alternative)

If you prefer managing plists manually:

1. Copy [`examples/com.vdplabs.pantry.serve.plist`](examples/com.vdplabs.pantry.serve.plist).
2. Replace `/ABS/PATH/TO/pantry/.venv/bin/pantry` and log paths with yours.
3. Install and load:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
cp Docs/examples/com.vdplabs.pantry.serve.plist \
  ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
launchctl load ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.vdplabs.pantry.serve.plist
```

