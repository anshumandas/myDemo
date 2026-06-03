/**
 * Windows-only helper (DPI-aware, so coordinates match gdigrab's desktop
 * framebuffer): maximize the app window, bring it to the foreground, and return
 * its client (web content) rectangle in PHYSICAL pixels, clamped to the screen.
 *
 * We maximize here via Win32 (SW_MAXIMIZE) rather than rely on Tauri's
 * maximize() — under WebDriver/WebView2 the latter doesn't reliably stick. We
 * capture the client rect — not the whole window — so the GIF shows just the
 * app UI (no OS title bar), and we grab a desktop region rather than ffmpeg's
 * `title=` source, which returns black frames for GPU-composited WebView2
 * content. The rect is clamped to the primary screen so ffmpeg never gets a
 * region that extends off-screen; the GIF encode then black-pads to a fixed
 * canvas for identical framing.
 */
import { spawn } from "node:child_process";
import type { Rect } from "../types.ts";

const PS_SCRIPT = (title: string) => `
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
$p = Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' } | Select-Object -First 1
if (-not $p) { Write-Error 'window not found'; exit 1 }
$h = $p.MainWindowHandle
[WinApi]::ShowWindow($h, 3) | Out-Null            # SW_MAXIMIZE
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

const even = (n: number) => n - (n % 2);

/** Maximize + foreground the window titled `title`; return its on-screen client rect (physical px, even-sized). */
export function focusMeasureClient(title: string): Promise<Rect> {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT(title)],
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
