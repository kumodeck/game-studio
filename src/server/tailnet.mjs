// --tailnet: find this machine's Tailscale address and MagicDNS name, so the editor can be opened
// from the person's other devices on their tailnet (2026-10-16: so the studio running on one Mac
// can be tried from another computer or phone, anywhere).
//
// WHY ask the tailscale CLI instead of scanning os.networkInterfaces() for a 100.x address:
// 100.64.0.0/10 is also used by carrier-grade NAT, so a 100.x interface is not proof of a tailnet,
// and the MagicDNS name (the address people actually type) is only known to Tailscale.
//
// Security stays the same as --lan (see server.mjs): we listen on the one tailnet address (never
// 0.0.0.0), the Host header must be that address:port or the MagicDNS name:port, and the one-time
// pass is still required. Plain HTTP is fine inside the tailnet: WireGuard encrypts the traffic.

import { execFile } from 'node:child_process';

// Where the CLI usually is. The Mac app (App Store / standalone) ships it inside the app bundle and
// does not always put it on PATH.
const TAILSCALE_CMDS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];

/** Run one command, resolve { code, stdout } (code 'ENOENT' when the program is not there). */
function runTailscaleCmd(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err && err.code === 'ENOENT') return resolve({ code: 'ENOENT', stdout: '' });
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
}

/** True for 100.64.0.0/10 (the range Tailscale gives out). */
export function isTailnetIPv4(ip) {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  return a >= 64 && a <= 127 && b <= 255 && c <= 255;
}

/**
 * Read the tailnet address and MagicDNS name.
 * @param {(cmd: string, args: string[]) => Promise<{ code: number | 'ENOENT', stdout: string }>} [run]
 *   injectable for tests (default: run the real CLI)
 * @returns {Promise<{ ok: true, ip: string, name: string } | { ok: false, error: string }>}
 *   `error` is one plain sentence for the person (printed as "studio: <error>")
 */
export async function readTailnet(run = runTailscaleCmd) {
  let cmd = null;
  let ipOut = null;
  for (const c of TAILSCALE_CMDS) {
    const r = await run(c, ['ip', '-4']);
    if (r.code === 'ENOENT') continue;
    cmd = c;
    ipOut = r;
    break;
  }
  if (!cmd) return { ok: false, error: '--tailnet needs Tailscale, but the tailscale command was not found. Install Tailscale (https://tailscale.com/download) or use --lan.' };
  if (ipOut.code !== 0) return { ok: false, error: '--tailnet: Tailscale is not connected (tailscale ip -4 failed). Open Tailscale, sign in, and try again.' };
  // Only stdout is read: the CLI prints warnings (for example a client/daemon version mismatch) on stderr.
  const ip = ipOut.stdout.split(/\s+/).find(isTailnetIPv4);
  if (!ip) return { ok: false, error: '--tailnet: Tailscale gave no 100.x address for this computer. Is Tailscale connected?' };

  const st = await run(cmd, ['status', '--json']);
  let status = null;
  try {
    status = st.code === 0 ? JSON.parse(st.stdout) : null;
  } catch {
    status = null;
  }
  if (!status) return { ok: false, error: '--tailnet: could not read tailscale status --json.' };
  if (status.BackendState && status.BackendState !== 'Running') return { ok: false, error: `--tailnet: Tailscale is not running (state: ${status.BackendState}). Open Tailscale and connect.` };
  // "box.tail1234.ts.net." -> "box.tail1234.ts.net" (browsers send the Host without the final dot).
  const name = String((status.Self && status.Self.DNSName) || '').replace(/\.$/, '').toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)) {
    return { ok: false, error: '--tailnet: this computer has no MagicDNS name. Turn on MagicDNS in the Tailscale admin console (DNS page), or use --lan.' };
  }
  return { ok: true, ip, name };
}
