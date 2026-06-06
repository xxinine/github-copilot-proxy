// GitHub OAuth device-flow helper. Mirrors what copilot-proxy-api's `auth`
// command does: obtain a long-lived GitHub OAuth token (ghu_...) that can be
// handed to a per-account copilot-proxy-api container via GH_TOKEN.

const CLIENT_ID = () => process.env.CPX_GITHUB_CLIENT_ID || 'Iv1.b507a08c87ecfe98';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID(), scope: 'read:user' }),
  });
  if (!res.ok) {
    throw new Error(`device code request failed: ${res.status}`);
  }
  return (await res.json()) as DeviceCodeResponse;
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'success'; accessToken: string }
  | { status: 'error'; error: string };

export async function pollForToken(deviceCode: string): Promise<PollResult> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = (await res.json()) as Record<string, string>;
  if (data.access_token) {
    return { status: 'success', accessToken: data.access_token };
  }
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down', interval: Number(data.interval) || 5 };
    default:
      return { status: 'error', error: data.error || 'unknown_error' };
  }
}

/** Best-effort lookup of the GitHub login name for display purposes. */
export async function fetchGithubLogin(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'copilot-proxy-multitenant',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return data.login ?? null;
  } catch {
    return null;
  }
}
