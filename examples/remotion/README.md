# Example Remotion composition

This folder is **illustrative only** — it is NOT part of the published `src/` and
is not type-checked by the package. A consuming app keeps its real brand
compositions in its own `demo/remotion/` folder; the package only provides the
render + compose plumbing (`renderRemotion`, the `"remotion"` EDL clip kind).

To use Remotion you must install the optional peers in the consuming app:

```bash
npm i -D remotion @remotion/bundler @remotion/renderer react react-dom
```

Remotion runs its own webpack bundle and downloads a headless Chromium on first
render (separate from the screencast browser). Rendering is a runtime call — it
does not change the tsx / no-build authoring model.

## Wiring it up

```ts
// demo/edit/render.ts (consumer)
import { renderRemotion, compose } from "@mydemo/core";
import { config } from "../config.ts";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../remotion/index.ts"); // the consumer's Remotion entry

// (a) Render a standalone brand intro:
await renderRemotion(config, {
  entry,
  compositionId: "BrandIntro",
  props: { title: "Kahaniverse", subtitle: "Stories, woven." },
  outFile: resolve(config.video.outDir, "intro.mp4"),
});

// (b) Or weave it into a montage via the EDL:
await compose(config, {
  id: "marketing",
  segments: [
    { kind: "remotion", entry, compositionId: "BrandIntro", props: { title: "Kahaniverse" } },
    { kind: "clip", source: resolve(config.dirs.output, "01-create-story.mp4"), in: 0, out: 6, caption: "Create a story" },
    { kind: "remotion", entry, compositionId: "Outro", props: { cta: "Try it free" } },
  ],
  music: { file: resolve(config.video.musicDir, "upbeat.mp3") },
});
```
