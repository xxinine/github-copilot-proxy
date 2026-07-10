// Background health monitor. Periodically re-validates every bound account's
// GitHub token (via the Copilot token exchange) and reconciles account.status:
//   - token mints a Copilot token -> status 'running'
//   - token logged out / revoked  -> status 'error'
//   - transient failure           -> status 'error'
//
// In the single-process multi-tenant design there are no per-account containers;
// a logged-out account surfaces as a clean 403 (account_not_ready) from the proxy
// at call time, and shows as 'error' in the dashboard between checks.

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

async function probeAccount(
  account: Account
): Promise<{ status: 'running' } | { status: 'error'; error: string }> {
  let ghToken: string;
  try {
    ghToken = decryptSecret(account.gh_token_enc);
  } catch {
    return { status: 'error', error: 'account token could not be decrypted' };
  }
  const check = await checkCopilotAccess(ghToken, PROBE_TIMEOUT_MS);
  if (check.ok) return { status: 'running' };
  return { status: 'error', error: check.error };
}

async function tick(): Promise<void> {
  const accounts = listAccounts();
  for (const account of accounts) {
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
  setTimeout(() => void tick(), 5_000);
  console.log(`[control-plane] token health monitor started (every ${INTERVAL_MS}ms)`);
}
