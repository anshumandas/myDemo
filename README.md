# @mydemo/core

> A demo-capture toolkit. Drives the **real** built app — a **Tauri desktop app**
> or a **web app in a real headed browser** — through scripted scenarios and
> records polished, uniformly-framed GIFs / MP4s, then weaves them (and optional
> code-defined **Remotion** intros / feature cards) into a finished marketing
> video. The way a human would demo it, but unattended and repeatable, and
> authorable by an LLM agent for whatever project the package is added to.

Extracted from the `demo/` rig inside the **myFinance** Tauri app (its first
consumer); the **browser** driver targets web apps such as **Kahaniverse**
(Next.js). See [DESIGN.md](DESIGN.md) for the architecture and
[SKILL.md](SKILL.md) for the agent-facing authoring instructions.

## Two drivers

The recorder is driver-pluggable via a single `driver` discriminant in config
(default `"tauri"`, fully backward compatible):

| `driver` | drives | how | window served by |
|----------|--------|-----|------------------|
| `"tauri"` *(default)* | the built native binary | `tauri-driver` + `wry` | `vite preview` (dist/) |
| `"browser"` | a real headed Edge/Chrome window over a web URL | plain WebdriverIO + vendored `msedgedriver`/`chromedriver`, launched in app mode (`--app=<url>`) | the consumer's web server (optional lifecycle) or an already-running URL |

Both drivers hand scenarios the **same** `Helpers` surface — a scenario never
knows which driver runs it. Capture (ffmpeg gdigrab over the DPI-aware window
client rect) and the GIF/MP4 encode are shared.

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

### Browser consumer (web app)

A web app (e.g. **Kahaniverse**, Next.js) adds the package the same way and keeps
the same content files — only `demo/config.ts` differs (and scenarios use real
`/path` routes + the web app's `data-testid`s). **No engine edits.**

```ts
// demo/config.ts — browser driver
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "@mydemo/core";

const demoDir = dirname(fileURLToPath(import.meta.url));
export const config = defineConfig({
  rootDir: resolve(demoDir, ".."),       // the web/ dir
  demoDir,
  driver: "browser",
  navAnchor: "nav-home",                 // test-id proving the page booted
  browser: {
    name: "edge",                        // "edge" (default) | "chrome"
    url: "http://localhost:3000",        // base web URL
    routing: "path",                     // "path" (Next.js App Router) | "hash"
    // viewport: { width: 1440, height: 900 },  // omit → window is maximized
    // appMode: true,                            // default: chrome-free --app window
    webServer: {                         // OPTIONAL — omit if already running
      command: "npm run dev",            // string (shell) or ["npm","run","dev"]
      cwd: resolve(demoDir, ".."),
      readyUrl: "http://localhost:3000", // poll until it answers (else TCP probe)
      env: { NEXT_PUBLIC_DEMO_MODE: "1" }, // the web demo-mode flag (see DESIGN §5)
    },
  },
  // app.windowTitle is optional for the browser driver; if omitted the page's
  // document.title is used for the capture window. identifier/binName unused.
  resetFiles: [],                        // web state is owned by the server
});
```

`demo/record.ts` is identical to the Tauri example above (it just passes
`config`). The browser's `data-testid` selectors and `/routes` are consumer-side
content; vendor `msedgedriver.exe` (or `chromedriver.exe`) under `demo/.bin/`.

## Public API

```ts
import {
  defineConfig, defineScenario,
  runRecorderCli, record,                 // recorder (driver-agnostic)
  selectDriver, doctor,                   // driver selection + preflight tool check
  ensureBuilt, resetAppData,              // build (Tauri) / reset
  compose, renderTutorial, renderRemotion,// video edit + Remotion render
  startSession, startCapture, mp4ToGif, focusMeasureClient, // lower-level engine
  startFrontendServer, startWebServer,    // server lifecycles (Tauri / web)
} from "@mydemo/core";
```

Every engine function takes the resolved `config` as its first argument — there
is no module-level singleton, so one package serves many apps.

### Remotion (optional)

`renderRemotion(cfg, { entry, compositionId, props, outFile })` renders a
**consumer-owned** Remotion composition (in its own `demo/remotion/`) to an MP4
via `@remotion/bundler` + `@remotion/renderer`. Those are **optional peer
dependencies** — Tauri-only consumers needn't install them; calling
`renderRemotion` without them throws an actionable install hint. A montage EDL
can also source a segment directly from Remotion:

```ts
await compose(config, {
  id: "marketing",
  segments: [
    { kind: "remotion", entry, compositionId: "BrandIntro", props: { title: "Kahaniverse" } },
    { kind: "clip", source: clipPath, in: 0, out: 6, caption: "Create a story" },
    { kind: "card", title: "Try it free", duration: 2.5 },
  ],
  music: { file: musicPath },
});
```

Remotion runs its **own** webpack bundle and downloads a **headless Chromium** at
render time (separate from the screencast browser). Rendering is a runtime call —
it does not change the tsx / no-build authoring model. A tiny illustrative
composition lives under [`examples/remotion/`](examples/remotion/) (not shipped
in `src/`, not type-checked — the package provides only the render+compose
plumbing).

## What stays in the consuming app

- `demo/config.ts` — identity/driver, paths, the demo-mode flag, sample data.
- `demo/scenarios/*.ts` + `scenarios/index.ts` — the feature walkthroughs.
- `demo/edit/*.edl.ts` — marketing-montage edit lists.
- `demo/remotion/*` — the app's own brand compositions (browser/Remotion consumers).
- `demo/fixtures/`, `demo/assets/music/`, `demo/.bin/msedgedriver.exe` (or
  `chromedriver.exe`).
- **Demo-mode cooperation in app source** (auto-unlock, skip native dialogs;
  the web equivalent: seeded data, auth bypass, skip consent modals) so recording
  runs unattended. See the "demo-mode contract" in [DESIGN.md](DESIGN.md).

## Scope (honest)

- **Windows first.** Capture is ffmpeg `gdigrab` + a DPI-aware PowerShell window
  measurement. macOS (`avfoundation`) / Linux (`x11grab`) capture are future work.
- **Two drivers, shipped.** `"tauri"` (`wry` + `tauri:options`, default) and
  `"browser"` (headed Edge/Chrome in app mode via plain WebdriverIO). An Electron
  driver and a non-Windows capture backend are the remaining gaps.
- **External tools are not bundled** (`tauri-driver`, `ffmpeg`, `gifski`,
  `ffprobe`, the browser-driver binary; Remotion's Chromium too). The consuming
  app vendors `msedgedriver`/`chromedriver` under `demo/.bin/`; the rest live on
  `PATH` (the engine augments `PATH` with the WinGet and cargo bin dirs so
  freshly-installed tools resolve). `doctor(cfg)` reports what's missing for the
  configured driver before a recording fails deep in the engine.
- **Local-dev resolution note:** under a `file:` dependency npm symlinks the
  package, and Node resolves its imports from the symlink's *real* path. So
  `webdriverio` is installed into this package's own `node_modules` (a dev
  dependency here) as well as declared a `peerDependency` for the published case.
