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
├── src/config.ts           defineConfig → resolved DemoConfig (paths, identity, driver, tools)
├── src/types.ts            Helpers, Scenario, defineScenario, Mark, Rect
├── src/engine/
│   ├── win.ts              DPI-aware window measurement (win32; match + maximize/asis)
│   ├── capture.ts          ffmpeg gdigrab → MP4, MP4 → GIF (gifski)
│   ├── server.ts           startFrontendServer (vite preview) + startWebServer (web app)
│   ├── wdio.ts             startSession(cfg) → dispatches to the selected driver
│   ├── drivers/
│   │   ├── types.ts        Driver + Session contract
│   │   ├── helpers.ts      shared Helpers impl (only goto/navigate is driver-specific)
│   │   ├── tauri.ts        tauri-driver + wry (default; extracted verbatim)
│   │   ├── browser.ts      headed Edge/Chrome in app mode (plain WebdriverIO)
│   │   └── index.ts        selectDriver(cfg)
│   ├── doctor.ts           preflight tool check, per driver
│   ├── build.ts            frontend (demo flag) + native build (Tauri; no-op for browser)
│   ├── reset.ts            wipe app-data for a clean first-run
│   └── record.ts           record() + runRecorderCli() orchestrator (driver-agnostic)
├── src/edit/
│   ├── compose.ts          EDL → finished video (cards, clips, REMOTION, captions, music)
│   ├── remotion.ts         renderRemotion(cfg, {entry, compositionId, props, outFile})
│   ├── remotion-peers.d.ts ambient types for the optional @remotion/* peers
│   └── tutorial.ts         caption + score a single-take tutorial recording
└── examples/remotion/      tiny illustrative composition (NOT shipped in src/)

consuming-app/demo/
├── config.ts               defineConfig({...}) + SAMPLE/DIRS/VIDEO re-exports
├── scenarios/index.ts      ordered Scenario[] registry
├── scenarios/*.ts          feature walkthroughs (app test-ids + routes)
├── scenarios/types.ts      re-export shim → @mydemo/core
├── edit/marketing.edl.ts   the montage edit list (may reference remotion segments)
├── remotion/*              the app's own brand compositions (browser/Remotion consumers)
├── record.ts / build.ts / reset.ts / edit/render.ts / edit/tutorial.ts  (thin entries)
└── fixtures/ · assets/music/ · .bin/msedgedriver.exe (or chromedriver.exe)
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
| `driver?` | `"tauri"` (default) or `"browser"` — the discriminant |
| `navAnchor` | test-id awaited after launch to prove the UI booted (both drivers) |
| `app?.{windowTitle,identifier,binName}` | **Tauri:** OS title (capture/focus), bundle id (app-data), cargo name (binary). **Browser:** only `windowTitle` (optional; falls back to `document.title`) |
| `devUrl?` | **Tauri:** URL the debug binary loads; vite preview serves dist/ here |
| `browser?` | **Browser:** `{ name, url, routing, viewport?, appMode?, webServer? }` |
| `driverArgs` | **Tauri:** args forwarded to the app binary (e.g. `["--demo"]`) |
| `build.frontendEnv` | **Tauri:** env baked into the frontend build (the demo flag) |
| `resetFiles?` | files wiped from app-data before each recording (default `[]`) |
| `paths?` | override tauriDir / frontendDist / output / fixtures / bin / sampleData |
| `capture?` `video?` `tools?` | tuning + tool-path overrides (all defaulted) |

**Discriminated, validated, pure.** `defineConfig` stays I/O-free; it just does
path math + defaults and **throws a clear error on a driver/field mismatch**:
`driver:"tauri"` requires `app.{windowTitle,identifier,binName}` + `devUrl` and
rejects a `browser` block; `driver:"browser"` requires `browser.url`. Tauri-only
fields are unused when `driver:"browser"` and vice-versa, so a browser consumer
provides only content + a thin entry — **no engine edits**.

Derived automatically: `appBinary` (`<tauriDir>/target/debug/<binName>[.exe]`,
Tauri only), `tools.edgeDriver`/`tools.chromeDriver` (`<bin>/<driver>.exe`),
resolved `browser` (trailing slash trimmed, `name:"edge"`, `routing:"path"`,
`appMode:true`, `webServer.cwd:rootDir`, `startupTimeoutMs:120000`),
`VITE_DEMO_OUTPUT_DIR` + `TAURI_ENV_PLATFORM` (merged into `build.frontendEnv`),
GIF/video canvas defaults (1024×640 / 1920×1080), caption font (Segoe UI Bold).

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

`record(cfg, scenario)` is the single-recording, **driver-agnostic** primitive:
reset → **serve** (Tauri: `vite preview` dist/; browser: `startWebServer`, or
skip if already running) → **launch** via `startSession` (which dispatches to the
selected driver) → navigate to the base URL → wait `navAnchor` →
`session.focusMeasure()` (the driver picks maximize vs. fixed-viewport) → off-camera
`setup()` → start ffmpeg over the client rect → on-camera `run()` → stop ffmpeg →
encode GIF normalized to the fixed canvas. `ensureBuilt` is a no-op for the
browser driver (the web server owns building/serving); `killStragglers` targets
the browser + its driver instead of the app binary.

### The driver abstraction (DESIGN §6.1, now shipped)

`Driver.start(cfg)` returns a `Session` — `{ browser, helpers, marks,
captureTitle, focusMeasure(), teardown() }` — a connected WebdriverIO session
plus the shared Helpers and a way to focus+measure its window. Two drivers
satisfy it:

- **tauri** (default): today's behavior verbatim — `tauri-driver` bridged to the
  native WebView2 driver, a `wry` session against the built binary, hash routing
  (`window.location.hash`). Measures by maximizing the titled window.
- **browser**: a real **headed** Edge (default) or Chrome window over a web URL
  through **plain** WebdriverIO (no tauri-driver). We spawn the vendored
  `msedgedriver`/`chromedriver` ourselves (same `.bin` vendoring + PATH
  augmentation) and connect to it, launching in **app mode** (`--app=<url>`) so
  the captured frame is chrome-free. `h.goto("/route")` resolves against the
  base `url` in `"path"` (Next.js App Router) or `"hash"` mode. Measures the
  app-mode window by `document.title` (substring match), maximized — or left at a
  configured `viewport` and measured as-is.

The **Helpers impl is shared** (`drivers/helpers.ts`); the *only* driver-specific
behavior is how `goto` navigates, injected as a one-line `navigate` callback. So
a scenario — `click`/`type`/`uploadFile`/`waitFor`/… — runs **unchanged** on
either driver.

---

## 5. The demo-mode contract (app-side, documented not enforced)

Unattended recording needs the **app** to cooperate. The package can't provide
this — it specifies it. The consumer implements a flag that puts the app into a
deterministic, non-blocking state, so the WebDriver flow never blocks on
something it can't click. **The engine documents this contract; it does not
enforce it.**

**Tauri (desktop).** A flag gated on `build.frontendEnv` (e.g. `VITE_DEMO_MODE=1`)
that **auto-unlocks** any vault/lock screen and **skips native OS dialogs**
(save/open → fixed dir). In myFinance this is `src/lib/demoMode.ts` + usages in
`App.tsx`, `UnlockPanel.tsx`, `ExportButton.tsx`, `Import.tsx`.

**Browser (web).** The equivalent flag travels via the web server's environment
(e.g. `browser.webServer.env = { NEXT_PUBLIC_DEMO_MODE: "1" }`, or a `?demo=1`
query the app reads). When set, the web app should:

- **seed known/deterministic data** (a fixed demo dataset, frozen "now", stable
  ordering) so every recording looks identical;
- **bypass auth** or boot with a **pre-set session** so no login screen blocks
  the run (and the `navAnchor` is reachable immediately);
- **skip cookie/consent/onboarding modals** and any "new here?" interstitials;
- **disable animations-that-never-settle / network spinners** that would defeat
  `waitFor`.

These are app-side responsibilities (e.g. a `demo/` data fixture + a
`DEMO_MODE`-gated provider in Kahaniverse), exactly mirroring the Tauri contract.

---

## 6. Remotion (synthetic video), as built

`renderRemotion(cfg, { entry, compositionId, props, outFile })` (in
`src/edit/remotion.ts`) renders a **consumer-owned** Remotion composition to an
MP4 via `@remotion/bundler` (`bundle()`) + `@remotion/renderer`
(`selectComposition()` + `renderMedia()`, codec `h264`, `crf` from `cfg.video`).

- **Optional peers.** `@remotion/bundler`, `@remotion/renderer`, `remotion` are
  declared **optional** peer dependencies — Tauri-only consumers don't install
  them. The module imports them **lazily** (`await import(...)`) and throws a
  clear, actionable install hint if absent. Typecheck without the packages
  installed is satisfied by ambient declarations in `remotion-peers.d.ts` (no
  `any`).
- **Content stays out of the package.** Compositions/components live in the
  consumer's `demo/remotion/`; the package ships only the render+compose
  plumbing plus a tiny illustrative `examples/remotion/` (not in `src/`, not
  type-checked).
- **Compose integration.** The EDL gains a `kind: "remotion"` segment (alongside
  `clip`/`card`). `compose()` renders it to a temp MP4, then runs it through the
  **same** normalize-to-canvas + caption pipeline as a recorded clip, so
  synthetic intros/outros/feature cards concatenate seamlessly with gdigrab
  screencasts into one master (consistent 1920×1080, shared captions/music).
- **Honest runtime note.** Remotion runs its **own** webpack bundle and downloads
  a **headless Chromium** at render time — separate from the screencast browser.
  Rendering is a runtime call; it does not change the tsx / no-build authoring
  model.

## 7. What's still hard (the abstraction tax)

1. ~~Driver is Tauri-only~~ **Done.** A pluggable `driver: "tauri" | "browser"`
   ships (§4). An **Electron** driver and richer browser/window strategies remain
   future work.
2. **Capture is Windows-only** — `gdigrab` + a PowerShell DPI rect. macOS
   (`avfoundation`) / Linux (`x11grab`) are new capture backends.
3. **External binaries aren't bundled** — `msedgedriver`/`chromedriver` are
   version-pinned to the local browser; Remotion's Chromium downloads at render
   time. `doctor(cfg)` (per-driver) + PATH augmentation are the mitigation.
4. **`file:` symlink resolution** — see README; resolved by installing
   `webdriverio` into this package locally + declaring it a peer for publish.
5. **No selector discovery yet** — scenarios/LLMs learn test-ids by reading app
   source. A generated `selectors.json` is a future quality lever.

---

## 8. Migration done in myFinance (boundary validation)

- `demo/lib/*` and `demo/edit/compose.ts` (engine) **deleted**.
- `demo/config.ts` rewritten as `defineConfig({...})` + `SAMPLE/DIRS/VIDEO`.
- `demo/scenarios/types.ts` → re-export shim; `scenarios/index.ts` added.
- `record.ts` / `build.ts` / `reset.ts` / `edit/render.ts` / `edit/tutorial.ts`
  reduced to thin entries that pass `config` into package functions.
- All 17 scenarios and the EDL unchanged except the EDL's type import.

Type-check (package + glue together) and the tsx module-graph smoke test
(`npm run smoke`, `scripts/smoke.ts`) pass; the smoke test additionally resolves
the new driver/doctor/remotion modules and asserts `defineConfig` for **both**
drivers (plus per-driver validation). The 17 scenarios, the marketing EDL, and
the tutorial renderer all resolve through the `@mydemo/core` symlink unchanged,
with `driver` defaulting to `"tauri"`. Recording itself needs a desktop session +
the external tools, so it's run by hand per the host rig's docs.

### Browser-consumer boundary (Kahaniverse)

A Next.js consumer provides **only** content + a thin entry — no engine edits:
`demo/config.ts` with `driver:"browser"` + `browser.{url,routing,webServer}`,
`scenarios/*` (web `data-testid`s + real `/routes`), `edit/*.edl.ts`,
`remotion/*`, and the same `record.ts`/`edit/render.ts` entries the Tauri
consumer uses. It vendors `msedgedriver.exe` (or `chromedriver.exe`) under
`demo/.bin/` and cooperates with the web demo-mode contract (§5).
