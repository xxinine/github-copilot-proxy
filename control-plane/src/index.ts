import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import {
  createApiKey,
  createUser,
  deleteAccount,
  deleteUser,
  encryptSecret,
  generateApiKey,
  getAccountByUser,
  getUserById,
  getUserByName,
  listApiKeys,
  listAccounts,
  listUsers,
  revokeApiKey,
  setAccountStatus,
  setUserStatus,
  upsertAccount,
  type User,
} from '@cpx/shared';
import {
  fetchGithubLogin,
  pollForToken,
  requestDeviceCode,
  type DeviceCodeResponse,
} from './githubDeviceFlow.js';
import {
  containerNameFor,
  ensureImage,
  ensureNetwork,
  startAccountContainer,
  stopAccountContainer,
} from './docker.js';
import { startHealthMonitor } from './health.js';
import { adminPage, adminUserPage, connectPage, dashboardPage, loginPage } from './views.js';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
  }
}

const PORT = Number(process.env.CPX_CONTROL_PLANE_PORT || 8080);
const GATEWAY_PORT = Number(process.env.CPX_GATEWAY_PORT || 4000);

// In-memory device-flow state keyed by userId (transient, demo-grade).
interface FlowState extends DeviceCodeResponse {
  startedAt: number;
}
const flows = new Map<number, FlowState>();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.CPX_SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

function currentUser(req: Request): User | undefined {
  if (!req.session.userId) return undefined;
  return getUserById(req.session.userId);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const u = currentUser(req);
  if (!u) {
    res.redirect('/login');
    return;
  }
  if (u.status === 'disabled') {
    req.session.destroy(() => res.redirect('/login'));
    return;
  }
  (req as Request & { user: User }).user = u;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const u = (req as Request & { user: User }).user;
  if (!u?.is_admin) {
    res.status(403).send('forbidden');
    return;
  }
  next();
}

function gatewayBase(req: Request): string {
  const host = (req.headers.host || `localhost`).split(':')[0];
  return `http://${host}:${GATEWAY_PORT}`;
}

// --- auth ---
app.get('/login', (req, res) => {
  if (currentUser(req)) return res.redirect('/');
  res.send(loginPage());
});

app.post('/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const user = username ? getUserByName(username) : undefined;
  if (!user || !password || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).send(loginPage('Invalid credentials'));
  }
  if (user.status === 'disabled') {
    return res.status(403).send(loginPage('This account is disabled'));
  }
  req.session.userId = user.id;
  res.redirect('/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- dashboard ---
app.get('/', requireAuth, (req, res) => {
  const user = (req as Request & { user: User }).user;
  // Admins land on the admin console first; their own dashboard stays at /dashboard.
  if (user.is_admin) return res.redirect('/admin');
  return renderDashboard(req, res, user);
});

app.get('/dashboard', requireAuth, (req, res) => {
  const user = (req as Request & { user: User }).user;
  return renderDashboard(req, res, user);
});

function renderDashboard(req: Request, res: Response, user: User): void {
  const account = getAccountByUser(user.id);
  const keys = listApiKeys(user.id);
  const newKey = (req.session as session.Session & { newKey?: string }).newKey;
  if (newKey) delete (req.session as session.Session & { newKey?: string }).newKey;
  res.send(dashboardPage(user, account, keys, gatewayBase(req), { newKey }));
}

// --- api keys ---
app.post('/keys', requireAuth, (req, res) => {
  const user = (req as Request & { user: User }).user;
  const { key, hash, prefix } = generateApiKey();
  createApiKey(user.id, hash, prefix, String((req.body as { name?: string }).name || ''));
  (req.session as session.Session & { newKey?: string }).newKey = key;
  res.redirect('/dashboard');
});

app.post('/keys/:id/revoke', requireAuth, (req, res) => {
  const user = (req as Request & { user: User }).user;
  revokeApiKey(Number(req.params.id), user.id);
  res.redirect('/dashboard');
});

// --- device flow binding ---
app.post('/connect', requireAuth, async (req, res) => {
  const user = (req as Request & { user: User }).user;
  try {
    const code = await requestDeviceCode();
    flows.set(user.id, { ...code, startedAt: Date.now() });
    const html = connectPage(user, code.user_code, code.verification_uri).replaceAll(
      '%INTERVAL%',
      String(Math.max(2, code.interval) * 1000)
    );
    res.send(html);
  } catch (e) {
    res.status(502).send(`Failed to start device flow: ${(e as Error).message}`);
  }
});

app.get('/connect/status', requireAuth, async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const flow = flows.get(user.id);
  if (!flow) return res.json({ status: 'error', error: 'no active flow' });
  if (Date.now() - flow.startedAt > flow.expires_in * 1000) {
    flows.delete(user.id);
    return res.json({ status: 'error', error: 'code expired, retry' });
  }
  try {
    const result = await pollForToken(flow.device_code);
    if (result.status === 'pending' || result.status === 'slow_down') {
      return res.json({ status: 'pending' });
    }
    if (result.status === 'error') {
      if (result.error === 'authorization_pending') return res.json({ status: 'pending' });
      flows.delete(user.id);
      return res.json({ status: 'error', error: result.error });
    }
    // success
    flows.delete(user.id);
    await bindAccount(user.id, result.accessToken);
    return res.json({ status: 'success' });
  } catch (e) {
    return res.json({ status: 'error', error: (e as Error).message });
  }
});

async function bindAccount(userId: number, ghToken: string): Promise<void> {
  const login = await fetchGithubLogin(ghToken);
  const account = upsertAccount(userId, encryptSecret(ghToken), login, containerNameFor(0));
  // container name depends on account id, which we now have
  const containerName = containerNameFor(account.id);
  upsertAccount(userId, encryptSecret(ghToken), login, containerName);
  try {
    await ensureNetwork();
    await ensureImage();
    await startAccountContainer(account.id, ghToken);
    setAccountStatus(account.id, 'running');
  } catch (e) {
    setAccountStatus(account.id, 'error', (e as Error).message);
  }
}

app.post('/disconnect', requireAuth, async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const account = getAccountByUser(user.id);
  if (account) {
    await stopAccountContainer(account.id).catch(() => {});
    deleteAccount(user.id);
  }
  res.redirect('/dashboard');
});

app.post('/restart', requireAuth, async (req, res) => {
  const user = (req as Request & { user: User }).user;
  const account = getAccountByUser(user.id);
  if (!account) return res.redirect('/dashboard');
  try {
    const { decryptSecret } = await import('@cpx/shared');
    await ensureNetwork();
    await startAccountContainer(account.id, decryptSecret(account.gh_token_enc));
    setAccountStatus(account.id, 'running');
  } catch (e) {
    setAccountStatus(account.id, 'error', (e as Error).message);
  }
  res.redirect('/dashboard');
});

// --- admin ---
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const user = (req as Request & { user: User }).user;
  res.send(adminPage(user, listUsers(), listAccounts()));
});

app.post('/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, is_admin } = req.body as {
    username?: string;
    password?: string;
    is_admin?: string;
  };
  if (username && password && !getUserByName(username)) {
    createUser(username, bcrypt.hashSync(password, 10), is_admin === '1');
  }
  res.redirect('/admin');
});

app.post('/admin/users/:id/disable', requireAuth, requireAdmin, async (req, res) => {
  const admin = (req as Request & { user: User }).user;
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (target && target.id !== admin.id) {
    setUserStatus(id, 'disabled');
    // Stop the account container so the disabled user can't be proxied.
    const account = getAccountByUser(id);
    if (account) {
      await stopAccountContainer(account.id).catch(() => {});
      setAccountStatus(account.id, 'stopped', 'user disabled');
    }
  }
  res.redirect('/admin');
});

app.post('/admin/users/:id/enable', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (getUserById(id)) setUserStatus(id, 'active');
  res.redirect('/admin');
});

app.post('/admin/users/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  const admin = (req as Request & { user: User }).user;
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (target && target.id !== admin.id) {
    const account = getAccountByUser(id);
    if (account) await stopAccountContainer(account.id).catch(() => {});
    deleteUser(id); // api_keys + accounts cascade
  }
  res.redirect('/admin');
});

// --- admin: per-user key management ---
app.get('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const admin = (req as Request & { user: User }).user;
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) return res.redirect('/admin');
  const newKey = (req.session as session.Session & { adminNewKey?: string }).adminNewKey;
  if (newKey) delete (req.session as session.Session & { adminNewKey?: string }).adminNewKey;
  res.send(adminUserPage(admin, target, getAccountByUser(id), listApiKeys(id), { newKey }));
});

app.post('/admin/users/:id/keys', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (target) {
    const { key, hash, prefix } = generateApiKey();
    createApiKey(id, hash, prefix, String((req.body as { name?: string }).name || ''));
    (req.session as session.Session & { adminNewKey?: string }).adminNewKey = key;
  }
  res.redirect(`/admin/users/${id}`);
});

app.post('/admin/users/:id/keys/:keyId/revoke', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (getUserById(id)) revokeApiKey(Number(req.params.keyId), id);
  res.redirect(`/admin/users/${id}`);
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// --- bootstrap ---
function bootstrapAdmin(): void {
  if (listUsers().length > 0) return;
  const u = process.env.CPX_ADMIN_USER || 'admin';
  const p = process.env.CPX_ADMIN_PASS || 'admin';
  createUser(u, bcrypt.hashSync(p, 10), true);
  console.log(`[control-plane] bootstrapped admin user "${u}"`);
}

bootstrapAdmin();
app.listen(PORT, () => {
  console.log(`[control-plane] listening on http://localhost:${PORT}`);
});

startHealthMonitor();
