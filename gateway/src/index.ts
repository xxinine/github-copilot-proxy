// Multi-tenant data plane. Clients hit a single, shared endpoint and
// authenticate with their personal `cpx-...` key. The key resolves to a user,
// then to that user's bound account, then to the per-account copilot-proxy-api
// container, which we reverse-proxy to. The upstream Copilot token and the
// GitHub token never leave the server.

import http from 'node:http';
import { Readable } from 'node:stream';
import httpProxy from 'http-proxy';
import {
  findActiveKeyByHash,
  getAccountByUser,
  getUserById,
  hashApiKey,
  logUsage,
} from '@cpx/shared';

const PORT = Number(process.env.CPX_GATEWAY_PORT || 4000);
const PROXY_PORT = Number(process.env.CPX_PROXY_PORT || 4141);

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  // Long timeouts so streaming (SSE) responses aren't cut off.
  proxyTimeout: 0,
  timeout: 0,
});

proxy.on('error', (err, _req, res) => {
  // Never leak internal topology (container names, DNS errors) to clients.
  if (process.env.CPX_VERBOSE) {
    console.error('[gateway] upstream error:', err.message);
  }
  if (res instanceof http.ServerResponse && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'application/json' });
  }
  if (res instanceof http.ServerResponse) {
    res.end(
      JSON.stringify({
        error: {
          message: 'upstream proxy unavailable, please retry shortly',
          type: 'upstream_unavailable',
        },
      })
    );
  }
});

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function extractKey(req: http.IncomingMessage): string | undefined {
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const xkey = req.headers['x-api-key'];
  if (typeof xkey === 'string' && xkey) return xkey.trim();
  return undefined;
}

function extractModel(req: http.IncomingMessage, body: Buffer): string | null {
  if (!body.length) return null;
  try {
    const json = JSON.parse(body.toString('utf8')) as { model?: string };
    return json.model ?? null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    return sendJson(res, 200, { ok: true });
  }

  const key = extractKey(req);
  if (!key) {
    return sendJson(res, 401, { error: { message: 'missing API key' } });
  }
  const apiKey = findActiveKeyByHash(hashApiKey(key));
  if (!apiKey) {
    return sendJson(res, 401, { error: { message: 'invalid API key' } });
  }
  const user = getUserById(apiKey.user_id);
  if (!user || user.status === 'disabled') {
    return sendJson(res, 403, {
      error: { message: 'account is disabled', type: 'account_disabled' },
    });
  }
  const account = getAccountByUser(apiKey.user_id);
  if (!account || !account.container_name) {
    return sendJson(res, 403, { error: { message: 'no Copilot account bound to this key' } });
  }
  if (account.status !== 'running') {
    const reason: Record<string, string> = {
      pending: 'account is still being set up, retry shortly',
      stopped: 'account proxy is stopped',
      error: 'account proxy is unhealthy (GitHub Copilot may be logged out)',
    };
    return sendJson(res, 503, {
      error: {
        message: reason[account.status] || `account proxy not ready (${account.status})`,
        type: 'account_not_ready',
      },
    });
  }

  // Buffer the body so we can record the model, then replay it to the upstream.
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c as Buffer));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const model = extractModel(req, body);

    res.on('finish', () => {
      logUsage(apiKey.user_id, account.id, req.url || '', model, res.statusCode);
    });

    const target = `http://${account.container_name}:${PROXY_PORT}`;
    proxy.web(req, res, {
      target,
      buffer: bufferToStream(body),
    });
  });
});

function bufferToStream(buf: Buffer): Readable {
  return Readable.from(buf.length ? [buf] : []);
}

server.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
});
