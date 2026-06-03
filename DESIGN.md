# @mydemo/core — design (as built)

How the myFinance `demo/` rig was extracted into a reusable, LLM-authorable
package. This reflects the **shipped** code, not a proposal.

---

## 1. The boundary

Everything splits into **engine** (in the package) and **content** (in the
consuming app). The package never knows a test-id, a route, or a fixture; the
app never knows how to drive a webdriver or run ffmpeg.

```
@mydemo/core
├── src/index.ts            public API barrel
├── src/config.ts           defineConfig → resolved DemoConfig (paths, identity, tools)
├── src/types.ts            Helpers, Scenario, defineScenario, Mark, Rect
├── src/engine/
│   ├── win.ts              DPI-aware window measurement (win32)
│   ├── capture.ts          ffmpeg gdigrab → MP4, MP4 → GIF (gifski)
│   ├── server.ts           vite preview serving dist/
│   ├── wdio.ts             tauri-driver + WDIO session, Helpers impl
│   ├── build.ts            frontend (demo flag) + native build
│   ├── reset.ts            wipe app-data for a clean first-run
│   └── record.ts           record() + runRecorderCli() orchestrator
└── src/edit/
    ├── compose.ts          EDL → finished video (cards, clips, captions, music)
    └── tutorial.ts         caption + score a single-take tutorial recording

consuming-app/demo/
├── config.ts               defineConfig({...}) + SAMPLE/DIRS/VIDEO re-exports
├── scenarios/index.ts      ordered Scenario[] registry
├── scenarios/*.ts          feature walkthroughs (app test-ids + routes)
├── scenarios/types.ts      re-export shim → @mydemo/core
├── edit/marketing.edl.ts   the montage edit list
├── record.ts / build.ts / reset.ts / edit/render.ts / edit/tutorial.ts  (thin entries)
└── fixtures/ · assets/music/ · .bin/msedgedriver.exe
```

---

## 2. Dependency injection — the key change

The original rig used a module-level `config.ts` singleton. The package can't,
so **every engine function takes a resolved `DemoConfig` as its first argument**.
`defineConfig(input)` (pure: path math + defaults, no I/O) resolves the app's
input into the full config the engine consumes, including two derived methods:

- `config.appDataDir()` — per-OS app-data path from `app.identifier`.
- `config.augmentedEnv(extra?)` — `process.env` with WinGet + cargo bin dirs
  prepended to `PATH`, so freshly-installed tools resolve in a stale shell.

### `DemoConfigInput` (what the app passes)

| field | meaning |
|-------|---------|
| `rootDir` / `demoDir` | absolute paths (app supplies via `import.meta.url`) |
| `app.{windowTitle,identifier,binName}` | OS title (capture/focus), bundle id (app-data), cargo name (binary) |
| `devUrl` | URL the debug binary loads; vite preview serves dist/ here |
| `navAnchor` | test-id awaited after launch to prove the UI booted |
| `driverArgs` | args forwarded to the app binary (e.g. `["--demo"]`) |
| `build.frontendEnv` | env baked into the frontend build (the demo flag) |
| `resetFiles` | files wiped from app-data before each recording |
| `paths?` | override tauriDir / frontendDist / output / fixtures / bin / sampleData |
| `capture?` `video?` `tools?` | tuning + tool-path overrides (all defaulted) |

Derived automatically: `appBinary` (`<tauriDir>/target/debug/<binName>[.exe]`),
`tools.edgeDriver` (`<bin>/msedgedriver.exe`), `VITE_DEMO_OUTPUT_DIR` +
`TAURI_ENV_PLATFORM` (merged into `build.frontendEnv`), GIF/video canvas defaults
(1024×640 / 1920×1080), caption font (Segoe UI Bold on Windows).

---

## 3. The authoring SDK

`defineScenario({ id, title, shows, solo?, setup?, run })`. The `Helpers` handed
to `run`/`setup` is the entire surface an author (or LLM) touches:

`goto` · `click` · `type` · `uploadFile` · `waitFor` · `waitForText` · `textOf`
· `pause` · `log` · `mark` · `browser` (escape hatch).

Selectors are `data-testid` values. `mark(label)` drops a timeline marker; if a
scenario marks beats, `record()` writes `<id>.timeline.json`, which
`renderTutorial` turns into burned-in captions. `solo: true` excludes a scenario
from the `--all` montage set (used for the single-take full tutorial).

---

## 4. The recorder CLI

`runRecorderCli({ cfg, scenarios, entryScript, argv })` reproduces the original
flags: `<id>` / `--all` / `--gifs` / `--build` / `--worker`. To dodge the
tauri-driver wedge that happens after a few WebDriver sessions in one process,
the orchestrator **re-spawns the consumer's own `entryScript`** (passed in, since
the package can't know it) once per scenario with `--worker`. Each scenario thus
records in a fresh process with its own driver/Edge lifecycle.

`record(cfg, scenario)` is the single-recording primitive: reset → serve dist →
launch (tauri-driver, `wry`) → wait `navAnchor` → measure+focus window →
off-camera `setup()` → start ffmpeg over the client rect → on-camera `run()` →
stop ffmpeg → encode GIF normalized to the fixed canvas.

---

## 5. The demo-mode contract (app-side, documented not enforced)

Unattended recording needs the **app** to cooperate. The package can't provide
this — it specifies it. The consumer implements a flag (gated on
`build.frontendEnv`, e.g. `VITE_DEMO_MODE=1`) that **auto-unlocks** any
vault/lock screen and **skips native OS dialogs** (save/open → fixed dir), so the
WebDriver flow never blocks on something it can't click. In myFinance this is
`src/lib/demoMode.ts` + usages in `App.tsx`, `UnlockPanel.tsx`, `ExportButton.tsx`,
`Import.tsx`.

---

## 6. What's still hard (the abstraction tax)

1. **Driver is Tauri-only** — `wry` + `tauri:options` is hardcoded in `wdio.ts`.
   A pluggable `driver: "tauri" | "electron" | "browser"` is real work; deferred.
2. **Capture is Windows-only** — `gdigrab` + a PowerShell DPI rect. macOS
   (`avfoundation`) / Linux (`x11grab`) are new capture backends.
3. **External binaries aren't bundled** — `msedgedriver` is version-pinned to the
   local Edge; a `doctor`/PATH check is the mitigation.
4. **`file:` symlink resolution** — see README; resolved by installing
   `webdriverio` into this package locally + declaring it a peer for publish.
5. **No selector discovery yet** — scenarios/LLMs learn test-ids by reading app
   source. A generated `selectors.json` is a future quality lever.

---

## 7. Migration done in myFinance (boundary validation)

- `demo/lib/*` and `demo/edit/compose.ts` (engine) **deleted**.
- `demo/config.ts` rewritten as `defineConfig({...})` + `SAMPLE/DIRS/VIDEO`.
- `demo/scenarios/types.ts` → re-export shim; `scenarios/index.ts` added.
- `record.ts` / `build.ts` / `reset.ts` / `edit/render.ts` / `edit/tutorial.ts`
  reduced to thin entries that pass `config` into package functions.
- All 17 scenarios and the EDL unchanged except the EDL's type import.

Type-check (package + glue together) and tsx module-graph smoke tests pass; the
17 scenarios, the marketing EDL, and the tutorial renderer all resolve through
the `@mydemo/core` symlink. Recording itself needs a desktop session + the
external tools, so it's run by hand per the host rig's docs.
