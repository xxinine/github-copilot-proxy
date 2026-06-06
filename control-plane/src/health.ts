// Background health monitor. Periodically checks every bound account's upstream
// proxy and reconciles account.status in the DB so the gateway can return
// predictable error codes:
//   - container not running           -> status 'stopped'
//   - container up but /v1/models 401 -> status 'error' (GitHub token logged out / invalid)
//   - container up but unreachable    -> status 'error'
//   - healthy                         -> status 'running'
//
// With this, a logged-out account surfaces as a clean 503 from the gateway
// instead of an intermittent 502/401.

import {
  getAccountById,
  listAccounts,
  setAccountStatus,
  type Account,
} from '@cpx/shared';
import { containerNameFor, containerRunning } from './docker.js';

const PROXY_PORT = Number(process.env.CPX_PROXY_PORT || 4141);
const INTERVAL_MS = Number(process.env.CPX_HEALTH_INTERVAL_MS || 60_000);
const PROBE_TIMEOUT_MS = Number(process.env.CPX_HEALTH_TIMEOUT_MS || 8_000);

type Health =
  | { status: 'running' }
  | { status: 'stopped'; error: string }
  | { status: 'error'; error: string };

async function probeAccount(account: Account): Promise<Health> {
  const running = await containerRunning(account.id);
  if (!running) {
    return { status: 'stopped', error: 'proxy container is not running' };
  }
  // Probe the upstream from inside the shared network. The control-plane joins
  // cpx-net, so it can reach the container by name just like the gateway.
  const url = `http://${containerNameFor(account.id)}:${PROXY_PORT}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 401 || res.status === 403) {
      return { status: 'error', error: 'GitHub Copilot authentication failed (logged out or token revoked)' };
    }
    if (!res.ok) {
      return { status: 'error', error: `upstream unhealthy (HTTP ${res.status})` };
    }
    return { status: 'running' };
  } catch (e) {
    return { status: 'error', error: `upstream unreachable: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function tick(): Promise<void> {
  const accounts = listAccounts();
  for (const account of accounts) {
    // Skip accounts that are still being set up.
    if (account.status === 'pending') continue;
    try {
      const health = await probeAccount(account);
      const fresh = getAccountById(account.id);
      if (!fresh || fresh.status === 'pending') continue; // a bind raced us
      if (health.status === 'running') {
        if (fresh.status !== 'running') setAccountStatus(account.id, 'running');
      } else if (fresh.status !== health.status || fresh.last_error !== health.error) {
        setAccountStatus(account.id, health.status, health.error);
      }
    } catch {
      // never let one account break the loop
    }
  }
}

export function startHealthMonitor(): void {
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  // Run an initial pass shortly after boot.
  setTimeout(() => void tick(), 5_000);
  console.log(`[control-plane] health monitor started (every ${INTERVAL_MS}ms)`);
}
