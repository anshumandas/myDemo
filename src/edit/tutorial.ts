/**
 * Tutorial renderer — turns a single-take tutorial recording
 * (<output>/<id>.mp4 + its <id>.timeline.json of marks) into a captioned,
 * scored tutorial video.
 *
 * Each timeline mark becomes a lower-third caption shown from its timestamp
 * until the next mark (the last runs to the end). Captions are generated as an
 * ASS subtitle file and burned in with libass, then a calm music bed is mixed
 * under the whole thing. Reuses the ffmpeg helpers from compose.ts.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DemoConfig } from "../config.ts";
import { run, probeDuration, addMusic, escPath, normalizeFilter } from "./compose.ts";

interface TimelineMark {
  label: string;
  t: number;
}

/** Format seconds as an ASS timestamp H:MM:SS.cs (centiseconds). */
function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p2(m)}:${p2(s)}.${p2(c)}`;
}

/** Escape text for an ASS Dialogue line. */
function assText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, "\\N");
}

/**
 * Build an ASS subtitle file: one caption per mark, shown until the next mark.
 * A translucent lower-third box (BorderStyle=3) with a short fade, sized to the
 * master canvas.
 */
function buildAss(marks: TimelineMark[], total: number, canvas: { w: number; h: number }): string {
  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${canvas.w}`,
    `PlayResY: ${canvas.h}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // White text, translucent dark box (OutlineColour with BorderStyle=3), bottom-centre.
    "Style: Default,Segoe UI Semibold,52,&H00FFFFFF,&H00FFFFFF,&H64101010,&H64101010,-1,0,0,0,100,100,0,0,3,14,0,2,120,120,90,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text",
  ];
  const events = marks.map((mk, i) => {
    const start = mk.t;
    const end = i + 1 < marks.length ? marks[i + 1].t : total;
    // \fad(in,out) ms — soft appear/disappear.
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,,{\\fad(220,220)}${assText(mk.label)}`;
  });
  return [...head, ...events].join("\n") + "\n";
}

/**
 * Render the captioned, scored tutorial video for a solo single-take scenario.
 * Requires the scenario's MP4 and its `.timeline.json` (emitted when the
 * scenario calls `h.mark()`).
 *
 * @param tutorialId  scenario id of the single-take tutorial (e.g. "20-full-tutorial")
 * @param musicName   filename under cfg.video.musicDir to score with (default "tutorial.mp3")
 */
export async function renderTutorial(
  cfg: DemoConfig,
  tutorialId: string,
  musicName = "tutorial.mp3",
): Promise<string> {
  const env = cfg.augmentedEnv();
  const mp4 = join(cfg.dirs.output, `${tutorialId}.mp4`);
  const timelinePath = join(cfg.dirs.output, `${tutorialId}.timeline.json`);

  if (!existsSync(mp4)) {
    throw new Error(`No tutorial recording at ${mp4}. Record it first (e.g. <recorder> ${tutorialId}).`);
  }
  if (!existsSync(timelinePath)) {
    throw new Error(`No timeline at ${timelinePath}. Re-record ${tutorialId} (it emits marks via h.mark()).`);
  }

  await mkdir(cfg.video.outDir, { recursive: true });
  const tmpDir = join(cfg.video.outDir, `.tmp-${tutorialId}`);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  try {
    const total = await probeDuration(mp4, env);
    const { marks } = JSON.parse(await readFile(timelinePath, "utf8")) as { marks: TimelineMark[] };
    if (!marks?.length) throw new Error("timeline has no marks");
    console.log(`• ${marks.length} caption(s) over ${total.toFixed(1)}s`);

    const assPath = join(tmpDir, "captions.ass");
    await writeFile(assPath, buildAss(marks, total, cfg.video.canvas), "utf8");

    // Normalize to the master canvas + burn captions. fontsdir points at the
    // directory holding the configured caption font so libass can resolve it.
    const fontsDir = escPath(dirname(cfg.video.fontFile));
    const vf =
      `${normalizeFilter(cfg)},fps=${cfg.video.fps},` +
      `subtitles=filename='${escPath(assPath)}':fontsdir='${fontsDir}'`;
    const burned = join(tmpDir, "burned.mp4");
    console.log("• normalizing + burning captions…");
    await run(
      cfg.tools.ffmpeg,
      [
        "-y", "-i", mp4,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", String(cfg.video.crf),
        "-pix_fmt", "yuv420p", "-r", String(cfg.video.fps),
        burned,
      ],
      env,
    );

    // Mix a calm music bed; silent if absent.
    const musicFile = join(cfg.video.musicDir, musicName);
    const music = existsSync(musicFile)
      ? { file: musicFile, volume: 0.4, fadeIn: 2, fadeOut: 3 }
      : undefined;
    if (!music) console.log(`• no music at ${musicFile} — rendering silent`);

    const final = join(cfg.video.outDir, "tutorial.mp4");
    console.log(music ? "• scoring (music bed)…" : "• finalizing…");
    await addMusic(cfg, burned, music, final);

    const dur = await probeDuration(final, env);
    console.log(`✔ tutorial — ${dur.toFixed(1)}s → ${final}`);
    return final;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
