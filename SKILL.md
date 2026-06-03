---
name: mydemo-author
description: Author and record a demo GIF/video for a Tauri app that uses the @mydemo/core rig. Use when the user wants to create, add, or update a demo/screencast of an app feature, or regenerate marketing GIFs. Requires @mydemo/core installed and a demo/config.ts present.
---

# Authoring a demo with @mydemo/core

You are creating an unattended screen-recording of a real Tauri app feature. The
rig drives the built app through a script and records a uniformly-framed GIF/MP4.
Your job is to write (or fix) one **scenario** and record it.

## The loop

1. **Orient.** Confirm the app has `demo/config.ts` (calls `defineConfig`) and a
   `demo/scenarios/index.ts` registry. Read an existing scenario in
   `demo/scenarios/` — match its style.

2. **Find the selectors you need.** Scenarios address elements by `data-testid`.
   Grep the app source (the page/components for the feature) for `data-testid=`
   and use the EXACT string. Never invent one. If the element you need has no
   stable test-id, STOP and tell the user which component needs one added — do
   not fall back to brittle CSS/XPath.

3. **Find the route.** Scenarios navigate with `h.goto("/route")` (hash routing).
   Read the app's router for the real path.

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

`Helpers`:
- `goto(route)` — navigate (hash route, e.g. `"/import"`)
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
  to make a recording pass. If the app blocks on a native dialog or lock screen,
  that's the app's demo-mode contract (DESIGN §5) — report it, don't hack around it.
- After recording, tell the user the output path and one line on what the GIF shows.
