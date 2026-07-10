// Background health monitor. Periodically re-validates every bound account's
// GitHub token (via the Copilot token exchange) and reconciles account.status:
//   - token mints a Copilot token       -> status 'running'
//   - token logged out / revoked (401/403) -> status 'error' (needs re-bind)
//   - transient failure (429/5xx/network)  -> status left UNCHANGED (retry next tick)
//
// In the single-process multi-tenant design there are no per-account containers;
// a logged-out account surfaces as a clean 403 (account_not_ready) from the proxy
// at call time, and shows as 'error' in the dashboard between checks. Transient
// upstream blips must NOT flip a healthy account to 'error' (avoids status
// flapping and spurious 503s for the user).

import {
  decryptSecret,
  getAccountById,
  listAccounts,
  setAccountStatus,
  type Account,
} from '@cpx/shared';
import { checkCopilotAccess } from './copilotCheck.js';

const INTERVAL_MS = Number(process.env.CPX_HEALTH_INTERVAL_MS || 60_000);
const PROBE_TIMEOUT_MS = Number(process.env.CPX_HEALTH_TIMEOUT_MS || 8_000);

type ProbeResult =
  | { kind: 'running' }
  | { kind: 'error'; error: string }
  | { kind: 'transient'; error: string };

async function probeAccount(account: Account): Promise<ProbeResult> {
  let ghToken: string;
  try {
    ghToken = decryptSecret(account.gh_token_enc);
  } catch {
    // A token we can't decrypt is a hard, permanent failure.
    return { kind: 'error', error: 'account token could not be decrypted' };
  }
  const check = await checkCopilotAccess(ghToken, PROBE_TIMEOUT_MS);
  if (check.ok) return { kind: 'running' };
  // loggedOut === true only for 401/403 (revoked / logged out). Everything else
  // (5xx, 429, network) is treated as transient and does not change status.
  if (check.loggedOut) return { kind: 'error', error: check.error };
  return { kind: 'transient', error: check.error };
}

async function tick(): Promise<void> {
  const accounts = listAccounts();
  for (const account of accounts) {
    if (account.status === 'pending') continue;
    try {
      const health = await probeAccount(account);
      const fresh = getAccountById(account.id);
      if (!fresh || fresh.status === 'pending') continue; // a bind raced us
      if (health.kind === 'transient') {
        // Leave status untouched; retry on the next tick.
        continue;
      }
      if (health.kind === 'running') {
        if (fresh.status !== 'running') setAccountStatus(account.id, 'running');
      } else if (fresh.status !== 'error' || fresh.last_error !== health.error) {
        setAccountStatus(account.id, 'error', health.error);
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
  setTimeout(() => void tick(), 5_000);
  console.log(`[control-plane] token health monitor started (every ${INTERVAL_MS}ms)`);
}
