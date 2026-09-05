# Optional session health check

Hooks are disabled by default. The shared `hooks.json` contains only the
supported `description` and `hooks` fields so Codex can parse it.

To enable the SessionStart health check in Claude Code, replace `hooks.json`
with the following configuration. This example uses Claude Code's
`CLAUDE_PLUGIN_ROOT` environment variable.

```json
{
  "description": "Run a wiki health check at session start.",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/health.mjs\" || true" }
        ]
      }
    ]
  }
}
```

Restore `"hooks": {}` to disable the check.
