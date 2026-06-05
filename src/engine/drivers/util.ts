/** Small shared helpers used by both drivers. */
import { createConnection } from "node:net";

/** Resolve once a TCP port accepts connections, or reject after `timeoutMs`. */
export function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not open after ${timeoutMs}ms`));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}
