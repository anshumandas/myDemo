/**
 * Windows-only helper (DPI-aware, so coordinates match gdigrab's desktop
 * framebuffer): bring a window to the foreground, size it for capture, and
 * return its client (web content) rectangle in PHYSICAL pixels, clamped to the
 * screen.
 *
 * The window is targeted by title — the Tauri app's title, or (for the browser
 * driver) the browser app-mode window's page title. Matching is `exact` by
 * default; the browser driver uses `contains` since an app-mode window's OS
 * title is just the page `<title>` and can carry a suffix.
 *
 * By default we maximize (SW_MAXIMIZE) — under WebDriver/WebView2 Tauri's own
 * maximize() doesn't reliably stick, and a maximized window gives a stable,
 * chrome-free frame. With `window: "asis"` (used when a fixed browser viewport
 * is configured) we leave the window at its launched size and just measure it.
 *
 * We capture the client rect — not the whole window — so the recording shows
 * just the app UI (no OS title bar), and we grab a desktop region rather than
 * ffmpeg's `title=` source, which returns black frames for GPU-composited
 * WebView2/Chromium content. The rect is clamped to the primary screen so
 * ffmpeg never gets an off-screen region; the encode then black-pads to a fixed
 * canvas for identical framing.
 */
import { spawn } from "node:child_process";
import type { Rect } from "../types.ts";

/** How the target window is matched, sized, and (optionally) resized. */
export interface MeasureOptions {
  /** Title match: exact equality (default) or substring. */
  match?: "exact" | "contains";
  /** "maximize" (default) or "asis" (leave at launched size, just measure). */
  window?: "maximize" | "asis";
}

/** PowerShell to focus + size + measure the matched window's client rect. */
function script(title: string, opts: Required<MeasureOptions>): string {
  const safe = title.replace(/'/g, "''");
  const where =
    opts.match === "contains"
      ? `$_.MainWindowTitle -like '*${safe}*'`
      : `$_.MainWindowTitle -eq '${safe}'`;
  // SW_MAXIMIZE (3) vs SW_SHOW (5) — show-as-is without changing the size.
  const showCmd = opts.window === "maximize" ? "[WinApi]::ShowWindow($h, 3)" : "[WinApi]::ShowWindow($h, 5)";
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr hAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public struct POINT { public int X, Y; }
}
"@
[WinApi]::SetProcessDPIAware() | Out-Null
$p = Get-Process | Where-Object { ${where} -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Error 'window not found'; exit 1 }
$h = $p.MainWindowHandle
${showCmd} | Out-Null
[WinApi]::SetForegroundWindow($h) | Out-Null
# Pin topmost so nothing on a shared/active desktop (Explorer, chat apps, toasts)
# can draw over the captured region mid-scenario. HWND_TOPMOST=-1, NOMOVE|NOSIZE=0x3.
[WinApi]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003) | Out-Null
Start-Sleep -Milliseconds 450
$c = New-Object WinApi+RECT
[WinApi]::GetClientRect($h, [ref]$c) | Out-Null
$tl = New-Object WinApi+POINT
$tl.X = 0; $tl.Y = 0
[WinApi]::ClientToScreen($h, [ref]$tl) | Out-Null
$sw = [WinApi]::GetSystemMetrics(0)               # SM_CXSCREEN (primary, physical)
$sh = [WinApi]::GetSystemMetrics(1)               # SM_CYSCREEN
# Clamp the client rect to the primary screen so the capture region is valid.
$x0 = [Math]::Max(0, $tl.X)
$y0 = [Math]::Max(0, $tl.Y)
$x1 = [Math]::Min($sw, $tl.X + ($c.Right - $c.Left))
$y1 = [Math]::Min($sh, $tl.Y + ($c.Bottom - $c.Top))
@{ x=$x0; y=$y0; w=($x1-$x0); h=($y1-$y0) } | ConvertTo-Json -Compress
`;
}

const even = (n: number) => n - (n % 2);

/**
 * Focus + size the window titled `title` and return its on-screen client rect
 * (physical px, even-sized). Tauri uses the defaults (exact match, maximize);
 * the browser driver passes `{ match: "contains", window }`.
 */
export function focusMeasureClient(title: string, opts: MeasureOptions = {}): Promise<Rect> {
  const resolved: Required<MeasureOptions> = {
    match: opts.match ?? "exact",
    window: opts.window ?? "maximize",
  };
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script(title, resolved)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", reject);
    ps.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`focusMeasureClient failed: ${err.trim() || code}`));
      try {
        const r = JSON.parse(out.trim()) as Rect;
        resolve({ x: r.x, y: r.y, w: even(r.w), h: even(r.h) });
      } catch {
        reject(new Error(`could not parse window rect from: ${out}`));
      }
    });
  });
}
