---
name: mydemo-author
description: Author and record a demo GIF/video for a Tauri desktop app OR a web app (browser driver) that uses the @mydemo/core rig, and optionally weave in Remotion-rendered intros/cards. Use when the user wants to create, add, or update a demo/screencast of an app feature, or regenerate marketing GIFs/video. Requires @mydemo/core installed and a demo/config.ts present.
---

# Authoring a demo with @mydemo/core

You are creating an unattended screen-recording of a real app feature. The rig
drives the built app through a script and records a uniformly-framed GIF/MP4. The
**same scenario API works on both drivers** — a Tauri desktop app (`driver:
"tauri"`, the default) or a web app in a real browser (`driver: "browser"`). Your
job is to write (or fix) one **scenario** and record it.

## First: which driver?

Read `demo/config.ts` and note the `driver`:
- **`"tauri"` (or absent):** desktop app. Routes are **hash** routes; selectors
  live in the Tauri frontend source (React/etc.).
- **`"browser"`:** web app (e.g. Next.js). Routes are usually **path** routes
  (`browser.routing: "path"`); selectors live in the web app's components. The
  base URL is `browser.url`.

The `Helpers` API and the rules below are identical either way — only *where you
look* for selectors/routes and *what shape* a route takes differ.

## The loop

1. **Orient.** Confirm the app has `demo/config.ts` (calls `defineConfig`) and a
   `demo/scenarios/index.ts` registry. Read an existing scenario in
   `demo/scenarios/` — match its style. Note the driver (above).

2. **Find the selectors you need.** Scenarios address elements by `data-testid`.
   Grep the relevant source for `data-testid=` and use the EXACT string. Never
   invent one. If the element you need has no stable test-id, STOP and tell the
   user which component needs one added — do not fall back to brittle CSS/XPath.
   - **Tauri:** grep the Tauri frontend (the feature's page/components).
   - **Browser:** grep the web app's source (e.g. Next.js `app/`/`components/`).
     The web consumer is responsible for ADDING `data-testid` attributes to its
     components — if they're missing, that's consumer-side work: list exactly
     which components/elements need a test-id added, with the proposed string.

3. **Find the route.**
   - **Tauri (hash routing):** `h.goto("/route")` sets the in-app hash. Read the
     app's router for the real path.
   - **Browser (path routing):** `h.goto("/route")` navigates to
     `<browser.url>/route`. Read the web app's router (e.g. Next.js `app/`
     directory segments) for the real path. (If the app uses a hash router,
     config sets `routing: "hash"` and `/route` becomes `#/route`.)

4. **Write the scenario** in `demo/scenarios/NN-name.ts` and register it in
   `demo/scenarios/index.ts` (in order). Use only the `Helpers` API below.

5. **Record and verify.** Run the app's recorder script (e.g.
   `npm run demo:single -- NN-name`). Then OPEN the produced
   `demo/output/NN-name.gif` (read it as an image) and confirm it shows the
   intended flow. If it's blank, too fast, or stops early, adjust waits/pacing
   and re-record. Recording needs an interactive desktop + the external tools
   (`tauri-driver`, `ffmpeg`, `gifski`) — if a tool is missing, report it; do
   not try to install it silently.

## The scenario shape

```ts
import { defineScenario } from "@mydemo/core";
import { SAMPLE } from "../config.ts";        // app's sample-data map

export default defineScenario({
  id: "NN-kebab-name",      // also the output filename; keep the NN ordering prefix
  title: "Human title",
  shows: "One sentence describing what the GIF demonstrates.",
  // solo: true,            // exclude from the `--all` montage (standalone artifacts only)
  async setup(h) { /* OPTIONAL off-camera prep — seed data; not recorded */ },
  async run(h) { /* ON-camera flow — recorded */ },
});
```

`Helpers` (identical on both drivers):
- `goto(route)` — navigate to `"/route"` (Tauri: hash route; browser: resolved
  against `browser.url` in the configured path/hash mode)
- `click(id)` / `type(id, text)` / `uploadFile(id, absPath)`
- `waitFor(id, timeoutMs?)` — wait until displayed (your main sync tool)
- `waitForText(id, substr, timeoutMs?)` / `textOf(id)`
- `pause(ms)` — dwell for the camera (pacing only — never to "wait for" the app)
- `log(msg)` — progress line
- `mark(label)` — drop a timeline caption marker (tutorial videos only)
- `browser` — raw WebdriverIO, escape hatch (rarely needed)

## Rules

- **Always `waitFor` before acting** on something that appears after a
  transition. Use `pause` ONLY for camera pacing — timing-based waits are flaky.
- **Put heavy data prep in `setup()`**, not `run()`. The camera shows the
  feature, not the seeding. Reuse `SAMPLE`/fixtures; don't invent new data
  unless asked.
- **One scenario = one coherent story.** Open → act → land on the payoff screen,
  then a final `pause(~2500)` so the GIF rests on the result.
- **Never** edit the engine, the build steps in `demo/config.ts`, or app source
  to make a recording pass. If the app blocks on something the script can't click,
  that's the app's **demo-mode contract** (DESIGN §5) — report it, don't hack around it:
  - **Tauri:** a native dialog or vault/lock screen (the `VITE_DEMO_MODE` flag
    should auto-unlock / fix dialog paths).
  - **Browser:** a login/auth wall, a cookie/consent or onboarding modal, or
    non-deterministic data (the web demo flag — e.g. `NEXT_PUBLIC_DEMO_MODE`,
    set via `browser.webServer.env` — should seed known data, bypass auth, and
    skip those modals). If the page blocks, name the modal/guard and the flag the
    app should gate it behind; don't try to click through it with brittle waits.
- After recording, tell the user the output path and one line on what the GIF shows.

## Authoring Remotion compositions (synthetic intros / feature cards)

For a code-defined brand intro/outro or animated feature card woven into the
marketing montage, the consumer keeps its compositions in `demo/remotion/` and
the EDL references them with a `kind: "remotion"` segment. Your job when asked:

1. **Confirm the optional peers are installed** in the consuming app:
   `remotion`, `@remotion/bundler`, `@remotion/renderer` (+ `react`/`react-dom`).
   If missing, tell the user to `npm i -D` them — `renderRemotion` throws an
   actionable hint otherwise. (Remotion also downloads a headless Chromium on
   first render.)

2. **Match the master canvas.** Define the `<Composition>` at the same
   dimensions/fps as `config.video.canvas` (default **1920×1080 @ 30fps**) so the
   segment joins without rescaling. See `examples/remotion/` in the package for a
   minimal, working shape (`index.ts` → `registerRoot`, `Root.tsx` →
   `<Composition>`, a component using `useCurrentFrame`/`spring`).

3. **Pass content via `props`** — keep text/brand strings in the EDL or render
   call (`renderRemotion(cfg, { entry, compositionId, props })`), not hard-coded
   in the composition, so the same composition serves multiple cuts.

4. **Reference it from the EDL** alongside clips/cards:
   ```ts
   { kind: "remotion", entry: REMOTION_ENTRY, compositionId: "BrandIntro",
     props: { title: "…" }, caption: "optional lower-third" }
   ```
   `compose()` renders it and normalizes it through the same canvas/caption
   pipeline as a screencast clip — no special handling needed.

Keep brand compositions in the consuming app; never add compositions to
`@mydemo/core` itself.
