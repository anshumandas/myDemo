# @mydemo/core

> A Tauri demo-capture toolkit. Drives the **real** built app through scripted
> scenarios and records polished, uniformly-framed GIFs / MP4s — the way a human
> would demo it, but unattended and repeatable. Designed so an LLM agent can
> author new demos for whatever Tauri project the package is added to.

Extracted from the `demo/` rig inside the **myFinance** Tauri app, which is its
first consumer. See [DESIGN.md](DESIGN.md) for the architecture and
[SKILL.md](SKILL.md) for the agent-facing authoring instructions.

## How it's consumed

The package ships **raw TypeScript** and is run by **tsx** (matching the host
rig — no build step). A consuming app adds it as a path/dev dependency and keeps
its app-specific content (config, scenarios, fixtures, EDLs) in its own `demo/`
folder:

```jsonc
// consuming app package.json
"devDependencies": { "@mydemo/core": "file:../myDemo" }
```

```ts
// demo/config.ts — the single app-specific injection point
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "@mydemo/core";

const demoDir = dirname(fileURLToPath(import.meta.url));
export const config = defineConfig({
  rootDir: resolve(demoDir, ".."),
  demoDir,
  app: { windowTitle: "myFinance", identifier: "com.myfinance.app", binName: "myfinance" },
  devUrl: "http://localhost:1420/",
  navAnchor: "nav-dashboard",                       // test-id proving the UI booted
  driverArgs: ["--demo"],
  build: { frontendEnv: { VITE_DEMO_MODE: "1" } },  // the demo-mode contract (§ DESIGN 5)
  resetFiles: ["app.db", "app.db-wal", "vault.stronghold"],
});
```

```ts
// demo/record.ts — thin entry the app's npm script calls
import { fileURLToPath } from "node:url";
import { runRecorderCli } from "@mydemo/core";
import { config } from "./config.ts";
import { SCENARIOS } from "./scenarios/index.ts";

runRecorderCli({
  cfg: config,
  scenarios: SCENARIOS,
  entryScript: fileURLToPath(import.meta.url),  // re-spawned per scenario
  argv: process.argv.slice(2),
});
```

```ts
// demo/scenarios/01-basic-import.ts
import { defineScenario } from "@mydemo/core";
export default defineScenario({
  id: "01-basic-import",
  title: "Basic import",
  shows: "Import a workbook → land on the dashboard with deltas.",
  async run(h) {
    await h.click("nav-accounts");
    await h.goto("/import");
    await h.uploadFile("import-file-input", "/abs/path/sample.xlsx");
    await h.click("import-preview-button");
    await h.click("import-commit-button");
    await h.waitFor("import-done");
    await h.pause(2000);
  },
});
```

## Public API

```ts
import {
  defineConfig, defineScenario,
  runRecorderCli, record,        // recorder
  ensureBuilt, resetAppData,     // build / reset
  compose, renderTutorial,       // video edit
  startSession, startCapture, mp4ToGif, focusMeasureClient, // lower-level engine
} from "@mydemo/core";
```

Every engine function takes the resolved `config` as its first argument — there
is no module-level singleton, so one package serves many apps.

## What stays in the consuming app

- `demo/config.ts` — identity, paths, the demo-mode build flag, sample data.
- `demo/scenarios/*.ts` + `scenarios/index.ts` — the feature walkthroughs.
- `demo/edit/*.edl.ts` — marketing-montage edit lists.
- `demo/fixtures/`, `demo/assets/music/`, `demo/.bin/msedgedriver.exe`.
- **Demo-mode cooperation in app source** (auto-unlock, skip native dialogs) so
  recording runs unattended. See the "demo-mode contract" in [DESIGN.md](DESIGN.md).

## Scope (honest)

- **Tauri + Windows first.** The driver is `wry` + `tauri:options`; capture is
  ffmpeg `gdigrab` + a DPI-aware PowerShell window measurement. macOS/Linux
  capture and an Electron/browser driver are explicit future work.
- **External tools are not bundled** (`tauri-driver`, `ffmpeg`, `gifski`,
  `ffprobe`, `msedgedriver`). The consuming app vendors `msedgedriver` under
  `demo/.bin/`; the rest live on `PATH` (the engine augments `PATH` with the
  WinGet and cargo bin dirs so freshly-installed tools resolve).
- **Local-dev resolution note:** under a `file:` dependency npm symlinks the
  package, and Node resolves its imports from the symlink's *real* path. So
  `webdriverio` is installed into this package's own `node_modules` (a dev
  dependency here) as well as declared a `peerDependency` for the published case.
