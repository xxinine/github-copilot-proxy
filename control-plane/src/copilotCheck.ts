// Validates a GitHub OAuth token by attempting the Copilot token exchange, the
// same call the proxy makes per request. Used at bind time and by the health
// monitor to reconcile account.status without spawning any container.
const GITHUB_API = 'https://api.github.com';
const COPILOT_VERSION = '0.53.0';

export type CopilotCheck =
  | { ok: true }
  | { ok: false; loggedOut: boolean; error: string };

/** Returns ok if the GitHub token can currently mint a Copilot token. */
export async function checkCopilotAccess(
  ghToken: string,
  timeoutMs = 8000
): Promise<CopilotCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${GITHUB_API}/copilot_internal/v2/token`, {
      headers: {
        authorization: `token ${ghToken}`,
        'user-agent': `GitHubCopilotChat/${COPILOT_VERSION}`,
        'editor-version': 'vscode/1.128.0',
        'editor-plugin-version': `copilot-chat/${COPILOT_VERSION}`,
        'x-github-api-version': '2025-04-01',
      },
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        loggedOut: true,
        error: 'GitHub Copilot authentication failed (logged out or token revoked)',
      };
    }
    return { ok: false, loggedOut: false, error: `Copilot token exchange failed (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, loggedOut: false, error: `Copilot token exchange unreachable: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
