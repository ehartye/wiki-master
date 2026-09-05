# Codex setup

Wiki Master includes a native `.codex-plugin/plugin.json` manifest pointing to
the same 19 skills used by Claude Code and Copilot CLI. The Node helpers and
vault format are shared. See the [official plugin packaging guide](https://developers.openai.com/plugins/build/plugins)
for Codex's manifest and personal marketplace conventions.

## Install from a local checkout

1. Copy this entire checkout to `~/plugins/wiki-master` (on Windows,
   `%USERPROFILE%\plugins\wiki-master`). Include `.codex-plugin`, `skills`,
   `scripts`, and `templates`; copying only the skills breaks helper paths.
2. Register it in your personal marketplace at
   `~/.agents/plugins/marketplace.json`. If that file already exists, preserve
   its name, interface, and other plugins, and append the `wiki-master` entry
   below to its `plugins` array. If absent, create the file with this content:

   ```json
   {
     "name": "personal",
     "interface": { "displayName": "Personal" },
     "plugins": [
       {
         "name": "wiki-master",
         "source": { "source": "local", "path": "./plugins/wiki-master" },
         "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
         "category": "Productivity"
       }
     ]
   }
   ```

3. Install using the marketplace's actual name (the example uses `personal`):

   ```sh
   codex plugin add wiki-master@personal
   ```

4. Start a new Codex thread and select `wiki-health`, or ask “Use wiki-health
   to check my vault.” For a new vault, start with `wiki-init` instead.

The default personal marketplace is discovered implicitly. You can inspect
discovery with `codex plugin marketplace list`. This repository's existing
Claude and Copilot marketplace files belong to those hosts.

## Runtime and workflows

- Run Codex on the machine where Obsidian is open and its CLI is available.
  A remote environment cannot drive your local Obsidian instance automatically.
- Provide Node.js 18+ and the vault environment variables documented in the
  [README](../README.md#configuration-environment-variables) to the Codex process.
  Allow access to your vault directory when the chosen execution permissions
  require it. The default vault is `~/.wiki-master-vault`.
- Select skills by name or ask naturally, for example “Use wiki-search to find
  our deployment decisions.” The `/wiki-*` notation in the shared instructions
  identifies workflows; it does not require a Codex slash command.
- Helpers resolve from the installed skill directory, not the open workspace.
  Sibling skills are available as `../<skill-name>/SKILL.md`; `$ARGUMENTS` in
  a workflow means the accompanying user request.
- The optional session-start health hook remains disabled by default. Invoke
  `wiki-health` explicitly to check the vault.
- Semantic search and drift detection use your Ollama instance when configured.
  Confluence clipping additionally needs the separate authenticated
  `confluencer` plugin. Set `WIKI_MASTER_CONFLUENCER_SCRIPTS` to its absolute
  `scripts` directory for a Codex installation; automatic discovery currently
  searches Copilot installations only. Run the clip-confluence helper with
  `--doctor` to verify that dependency before clipping.

## Updating

Update the source checkout, refresh the copy under `~/plugins/wiki-master`,
then reinstall with `codex plugin add wiki-master@personal` and start a new
thread. Keep `.codex-plugin/plugin.json`'s version aligned with the other
plugin manifests when releasing changes.
