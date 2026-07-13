import type {
  Account,
  ApiKey,
  RecentUsage,
  UsageByModel,
  UsageByUser,
  UsageDay,
  UsageSummary,
  User,
} from '@cpx/shared';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

type NavKey =
  | 'dashboard'
  | 'usage'
  | 'examples'
  | 'admin-users'
  | 'admin-usage'
  | 'admin-settings';

function sidebar(user: User, active?: NavKey): string {
  const link = (href: string, key: NavKey, label: string): string =>
    `<a href="${href}"${active === key ? ' class="active"' : ''}>${label}</a>`;
  const adminLinks = user.is_admin
    ? `<div class="navgroup">Admin</div>
      ${link('/admin', 'admin-users', 'Users')}
      ${link('/admin/usage', 'admin-usage', 'All usage')}
      ${link('/admin/settings', 'admin-settings', 'Settings')}`
    : '';
  return `<aside class="sidebar">
    <div class="brand">Copilot Proxy</div>
    <nav>
      ${link('/dashboard', 'dashboard', 'Dashboard')}
      ${link('/dashboard/usage', 'usage', 'My usage')}
      ${link('/examples', 'examples', 'Client examples')}
      ${adminLinks}
    </nav>
    <div class="sidebar-foot">
      <div class="muted" style="font-size:.85rem;margin-bottom:.35rem">${esc(user.username)}${user.is_admin ? ' · admin' : ''}</div>
      <a href="/logout">Logout</a>
    </div>
  </aside>`;
}

function layout(title: string, body: string, user?: User, active?: NavKey): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; line-height: 1.5; }
  body.app { display: flex; min-height: 100vh; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  code, pre { background: #8881; padding: .15rem .35rem; border-radius: 4px; font-size: .9em; }
  pre { padding: .75rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; font-size: .92rem; white-space: nowrap; }
  input, button, select, textarea { font: inherit; padding: .45rem .6rem; border-radius: 6px; border: 1px solid #8886; }
  button { cursor: pointer; background: #2563eb; color: #fff; border-color: #2563eb; }
  button.secondary { background: transparent; color: inherit; }
  button.iconbtn { padding: .35rem .45rem; line-height: 0; vertical-align: middle; }
  button.iconbtn svg { display: block; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem; margin: 1rem 0; }
  .pill { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; }
  .ok { background: #16a34a22; color: #16a34a; } .warn { background: #d9770622; color: #d97706; }
  .err { background: #dc262622; color: #dc2626; } .muted { color: #8889; }
  form.inline { display: inline; }
  a { color: #2563eb; }
  /* Left navigation sidebar */
  .sidebar { width: 220px; flex-shrink: 0; border-right: 1px solid #8884; padding: 1.25rem 1rem; display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; }
  .sidebar .brand { font-weight: 700; font-size: 1.05rem; margin-bottom: 1.5rem; }
  .sidebar nav { display: flex; flex-direction: column; gap: .1rem; }
  .sidebar nav a { display: block; padding: .45rem .6rem; border-radius: 6px; text-decoration: none; color: inherit; }
  .sidebar nav a:hover { background: #8881; }
  .sidebar nav a.active { background: #2563eb22; color: #2563eb; font-weight: 600; }
  .sidebar .navgroup { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #8889; margin: 1rem 0 .35rem; padding: 0 .6rem; }
  .sidebar-foot { margin-top: auto; padding-top: 1rem; border-top: 1px solid #8884; font-size: .9rem; }
  /* Main content area uses the remaining width */
  main { flex: 1 1 auto; min-width: 0; padding: 1.75rem 2rem; }
  body.app main { max-width: 1600px; }
  body:not(.app) main { max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
  /* The scrollable wrapper keeps wide usage tables from overflowing the page */
  .tablewrap { overflow-x: auto; }
  /* Shared fixed column layout so By day / By model / Top users line up */
  .utable { table-layout: fixed; min-width: 640px; }
  .utable th, .utable td { overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 720px) {
    body.app { flex-direction: column; }
    .sidebar { width: auto; height: auto; position: static; border-right: none; border-bottom: 1px solid #8884; flex-direction: row; align-items: center; flex-wrap: wrap; gap: .35rem; }
    .sidebar .brand { margin: 0 1rem 0 0; }
    .sidebar nav { flex-direction: row; flex-wrap: wrap; }
    .sidebar .navgroup { display: none; }
    .sidebar-foot { margin: 0 0 0 auto; border-top: none; padding-top: 0; }
    main { padding: 1rem; }
  }
</style>
</head>
<body${user ? ' class="app"' : ''}>
${user ? sidebar(user, active) : ''}
<main>
${body}
</main>
<script>
  function cpxCopy(id, btn){
    var el=document.getElementById(id); if(!el) return;
    var txt=el.textContent||'';
    function done(){ var old=btn.getAttribute('data-label')||btn.innerHTML; btn.setAttribute('data-label', old); btn.innerHTML='✓'; setTimeout(function(){ btn.innerHTML=btn.getAttribute('data-label'); }, 1200); }
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done).catch(function(){}); }
    else { try{ var t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t); done(); }catch(e){} }
  }
</script>
</body>
</html>`;
}

const COPY_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

/** A small icon-only button that copies the text content of `targetId`. */
function copyIconBtn(targetId: string): string {
  return `<button type="button" class="secondary iconbtn" title="Copy" aria-label="Copy" onclick="cpxCopy('${targetId}', this)">${COPY_SVG}</button>`;
}

export function loginPage(error?: string): string {
  return layout(
    'Login',
    `<div class="card" style="max-width:380px;margin:3rem auto;">
      <h2 style="margin-top:0">Sign in</h2>
      ${error ? `<p class="pill err">${esc(error)}</p>` : ''}
      <form method="post" action="/login">
        <p><input name="username" placeholder="Username" autofocus style="width:100%"></p>
        <p><input name="password" type="password" placeholder="Password" style="width:100%"></p>
        <button type="submit">Login</button>
      </form>
    </div>`
  );
}

function statusPill(s: Account['status']): string {
  const map: Record<Account['status'], string> = {
    running: 'ok',
    pending: 'warn',
    stopped: 'muted',
    error: 'err',
  };
  return `<span class="pill ${map[s]}">${s}</span>`;
}

export function dashboardPage(
  user: User,
  account: Account | undefined,
  keys: ApiKey[],
  gatewayBase: string,
  flash?: { newKey?: string }
): string {
  const bindingCard = account
    ? `<div class="card">
        <h2 style="margin-top:0">GitHub Copilot binding ${statusPill(account.status)}</h2>
        <p>Bound account: <code>${esc(account.gh_login || 'unknown')}</code></p>
        ${account.last_error ? `<p class="pill err">${esc(account.last_error)}</p>` : ''}
        <form class="inline" method="post" action="/connect"><button class="secondary">Re-bind</button></form>
        <form class="inline" method="post" action="/disconnect"><button class="secondary">Disconnect</button></form>
        <form class="inline" method="post" action="/restart"><button class="secondary">Re-check</button></form>
      </div>`
    : `<div class="card">
        <h2 style="margin-top:0">GitHub Copilot binding</h2>
        <p class="muted">Not connected yet. Authorize your GitHub Copilot account to start proxying.</p>
        <form method="post" action="/connect"><button>Connect GitHub Copilot</button></form>
      </div>`;

  const keyRows = keys
    .map(
      (k) => `<tr>
        <td><code>${esc(k.key_prefix)}…</code></td>
        <td>${esc(k.name || '-')}</td>
        <td>${k.status === 'active' ? '<span class="pill ok">active</span>' : '<span class="pill muted">revoked</span>'}</td>
        <td>${esc(k.created_at)}</td>
        <td>${
          k.status === 'active'
            ? `<form class="inline" method="post" action="/keys/${k.id}/revoke"><button class="secondary">Revoke</button></form>`
            : `<form class="inline" method="post" action="/keys/${k.id}/delete"><button class="secondary" style="border-color:#dc2626;color:#dc2626">Delete</button></form>`
        }</td>
      </tr>`
    )
    .join('');

  const hasRevoked = keys.some((k) => k.status === 'revoked');
  const deleteRevokedBtn = hasRevoked
    ? `<form class="inline" method="post" action="/keys/delete-revoked" onsubmit="return confirm('Permanently delete all revoked keys?');"><button class="secondary" style="border-color:#dc2626;color:#dc2626">Delete all revoked</button></form>`
    : '';

  const newKeyBanner = flash?.newKey
    ? `<div class="card" style="border-color:#16a34a">
        <strong>New API key (copy now — shown once):</strong>
        <div style="display:flex;gap:.5rem;align-items:center">
          <pre id="newkey" style="flex:1;margin:0">${esc(flash.newKey)}</pre>
          ${copyIconBtn('newkey')}
        </div>
      </div>`
    : '';

  return layout(
    'Dashboard',
    `${bindingCard}
    ${newKeyBanner}
    <div class="card">
      <h2 style="margin-top:0">API keys</h2>
      <table>
        <thead><tr><th>Key</th><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${keyRows || '<tr><td colspan="5" class="muted">No keys yet.</td></tr>'}</tbody>
      </table>
      <form method="post" action="/keys">
        <input name="name" placeholder="Key name (optional)">
        <button type="submit">Create API key</button>
      </form>
      ${deleteRevokedBtn ? `<p>${deleteRevokedBtn}</p>` : ''}
    </div>
    <div class="card">
      <h2 style="margin-top:0">How to use</h2>
      <p>Unified endpoint (same for everyone):</p>
      <pre>${esc(gatewayBase)}/v1/chat/completions</pre>
      <p>Authenticate with <em>your</em> key:</p>
      <pre>curl ${esc(gatewayBase)}/v1/models \\
  -H "Authorization: Bearer YOUR_CPX_KEY"</pre>
    </div>`,
    user,
    'dashboard'
  );
}

export function connectPage(
  user: User,
  userCode: string,
  verificationUri: string
): string {
  return layout(
    'Connect GitHub Copilot',
    `<div class="card">
      <h2 style="margin-top:0">Authorize GitHub Copilot</h2>
      <ol>
        <li>Open <a href="${esc(verificationUri)}" target="_blank" rel="noopener">${esc(verificationUri)}</a></li>
        <li>Enter this code: <pre style="font-size:1.4rem;letter-spacing:.2em">${esc(userCode)}</pre></li>
        <li>Approve access. This page updates automatically.</li>
      </ol>
      <p id="status" class="pill warn">Waiting for authorization…</p>
    </div>
    <script>
      async function poll() {
        try {
          const r = await fetch('/connect/status');
          const d = await r.json();
          const el = document.getElementById('status');
          if (d.status === 'success') { el.className='pill ok'; el.textContent='Connected! Redirecting…'; location.href='/'; return; }
          if (d.status === 'error') { el.className='pill err'; el.textContent='Error: ' + d.error; return; }
          el.textContent = 'Waiting for authorization…';
        } catch (e) {}
        setTimeout(poll, ${'%INTERVAL%'});
      }
      setTimeout(poll, ${'%INTERVAL%'});
    </script>`,
    user,
    'dashboard'
  );
}

export function adminPage(user: User, users: User[], accounts: Account[]): string {
  const accByUser = new Map(accounts.map((a) => [a.user_id, a]));
  const rows = users
    .map((u) => {
      const a = accByUser.get(u.id);
      const isSelf = u.id === user.id;
      const userCell = `${esc(u.username)}${u.is_admin ? ' <span class="pill ok">admin</span>' : ''}${
        u.status === 'disabled' ? ' <span class="pill err">disabled</span>' : ''
      }`;
      let actions: string;
      const manage = `<a href="/admin/users/${u.id}">Manage →</a>`;
      if (isSelf) {
        actions = `${manage} <span class="muted">(you)</span>`;
      } else {
        const toggle =
          u.status === 'disabled'
            ? `<form class="inline" method="post" action="/admin/users/${u.id}/enable"><button class="secondary">Enable</button></form>`
            : `<form class="inline" method="post" action="/admin/users/${u.id}/disable"><button class="secondary">Disable</button></form>`;
        const del = `<form class="inline" method="post" action="/admin/users/${u.id}/delete" onsubmit="return confirm('Delete user ${esc(
          u.username
        )} and all their keys/binding? This cannot be undone.');"><button class="secondary" style="border-color:#dc2626;color:#dc2626">Delete</button></form>`;
        actions = `${manage} ${toggle} ${del}`;
      }
      return `<tr>
        <td>${u.id}</td>
        <td>${userCell}</td>
        <td>${a ? `${esc(a.gh_login || '-')} ${statusPill(a.status)}` : '<span class="muted">unbound</span>'}</td>
        <td>${esc(u.created_at)}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');
  return layout(
    'Admin',
    `<div class="card">
      <h2 style="margin-top:0">Users</h2>
      <table>
        <thead><tr><th>ID</th><th>User</th><th>Copilot binding</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h2>Create user</h2>
      <form method="post" action="/admin/users">
        <input name="username" placeholder="username" required>
        <input name="password" type="password" placeholder="password" required>
        <label><input type="checkbox" name="is_admin" value="1"> admin</label>
        <button type="submit">Create</button>
      </form>
    </div>`,
    user,
    'admin-users'
  );
}

export function adminSettingsPage(
  user: User,
  settings: { webSearchConfigured: boolean; webSearchEnabled: boolean }
): string {
  const { webSearchConfigured, webSearchEnabled } = settings;
  let pill: string;
  if (!webSearchConfigured) {
    pill = '<span class="pill err">unavailable</span>';
  } else if (webSearchEnabled) {
    pill = '<span class="pill ok">on</span>';
  } else {
    pill = '<span class="pill err">off</span>';
  }
  const toggle = webSearchEnabled
    ? `<form class="inline" method="post" action="/admin/settings/web-search"><input type="hidden" name="enabled" value="0"><button class="secondary">Disable</button></form>`
    : `<form class="inline" method="post" action="/admin/settings/web-search"><input type="hidden" name="enabled" value="1"><button class="secondary">Enable</button></form>`;
  const note = webSearchConfigured
    ? ''
    : `<p class="muted" style="margin:.4rem 0 0">Set <code>WEBIQ_X_APIKEY</code> in the proxy environment to activate. The toggle sets policy but has no effect until a search provider is configured.</p>`;
  return layout(
    'Settings',
    `<div class="card">
      <h2 style="margin-top:0">Claude web search</h2>
      <p style="margin:0 0 .5rem">Serve the Anthropic <code>web_search</code> tool via the proxy <span style="margin-left:.5rem">${pill}</span></p>
      ${toggle}
      ${note}
    </div>`,
    user,
    'admin-settings'
  );
}

export function adminUserPage(
  admin: User,
  target: User,
  account: Account | undefined,
  keys: ApiKey[],
  flash?: { newKey?: string }
): string {
  const keyRows = keys
    .map(
      (k) => `<tr>
        <td><code>${esc(k.key_prefix)}…</code></td>
        <td>${esc(k.name || '-')}</td>
        <td>${k.status === 'active' ? '<span class="pill ok">active</span>' : '<span class="pill muted">revoked</span>'}</td>
        <td>${esc(k.created_at)}</td>
        <td>${
          k.status === 'active'
            ? `<form class="inline" method="post" action="/admin/users/${target.id}/keys/${k.id}/revoke"><button class="secondary">Revoke</button></form>`
            : `<form class="inline" method="post" action="/admin/users/${target.id}/keys/${k.id}/delete"><button class="secondary" style="border-color:#dc2626;color:#dc2626">Delete</button></form>`
        }</td>
      </tr>`
    )
    .join('');
  const hasRevoked = keys.some((k) => k.status === 'revoked');
  const deleteRevokedBtn = hasRevoked
    ? `<form class="inline" method="post" action="/admin/users/${target.id}/keys/delete-revoked" onsubmit="return confirm('Permanently delete all revoked keys for this user?');"><button class="secondary" style="border-color:#dc2626;color:#dc2626">Delete all revoked</button></form>`
    : '';
  const newKeyBanner = flash?.newKey
    ? `<div class="card" style="border-color:#16a34a">
        <strong>New API key for ${esc(target.username)} (copy now — shown once, then hand it to the user securely):</strong>
        <div style="display:flex;gap:.5rem;align-items:center">
          <pre id="newkey" style="flex:1;margin:0">${esc(flash.newKey)}</pre>
          ${copyIconBtn('newkey')}
        </div>
      </div>`
    : '';
  return layout(
    'Manage user',
    `<p><a href="/admin/users/${target.id}/usage">Usage &amp; stats →</a></p>
    <div class="card">
      <h2 style="margin-top:0">${esc(target.username)}${
        target.is_admin ? ' <span class="pill ok">admin</span>' : ''
      }${target.status === 'disabled' ? ' <span class="pill err">disabled</span>' : ''}</h2>
      <p class="muted">User #${target.id} · created ${esc(target.created_at)}</p>
      <p>Copilot binding: ${
        account
          ? `<code>${esc(account.gh_login || 'unknown')}</code> ${statusPill(account.status)}`
          : '<span class="muted">unbound</span>'
      }</p>
    </div>
    ${newKeyBanner}
    <div class="card">
      <h2 style="margin-top:0">API keys</h2>
      <table>
        <thead><tr><th>Key</th><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>${keyRows || '<tr><td colspan="5" class="muted">No keys yet.</td></tr>'}</tbody>
      </table>
      <h2>Create key for this user</h2>
      <p class="muted">The key is shown once. You'll need to pass it to the user out-of-band (e.g. a secure channel).</p>
      <form method="post" action="/admin/users/${target.id}/keys">
        <input name="name" placeholder="Key name (optional)">
        <button type="submit">Create API key</button>
      </form>
      ${deleteRevokedBtn ? `<p>${deleteRevokedBtn}</p>` : ''}
    </div>`,
    admin,
    'admin-users'
  );
}

// ---- usage dashboards (Phase 2) ----

function fmtNum(n: number): string {
  return (n || 0).toLocaleString('en-US');
}

function fmtPct(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

// Cache rate = cached-read share of total input. The proxy normalizes usage at
// ingestion so cached reads are always a subset of `prompt_tokens`
// (cached ⊆ input) for both OpenAI (native) and Anthropic (cache_read folded in)
// shapes, so the denominator is simply the input tokens.
function cacheRatePct(cached: number, input: number): string {
  if (!input) return '—';
  const pct = Math.round(((cached || 0) / input) * 100);
  // Clamp to guard against legacy rows written before ingestion normalization,
  // where Anthropic input excluded cache reads (cached could exceed input).
  return `${Math.min(100, Math.max(0, pct))}%`;
}

function windowSelector(base: string, since: number): string {
  const opts = [7, 30, 90];
  return `<div class="muted" style="font-size:.85rem">Window: ${opts
    .map((d) =>
      d === since
        ? `<strong>${d}d</strong>`
        : `<a href="${base}?days=${d}">${d}d</a>`
    )
    .join(' · ')}</div>`;
}

function usageCards(s: UsageSummary): string {
  const card = (label: string, value: string, sub = ''): string =>
    `<div class="card" style="flex:1;min-width:140px;margin:0">
      <div class="muted" style="font-size:.8rem">${label}</div>
      <div style="font-size:1.5rem;font-weight:600">${value}</div>
      ${sub ? `<div class="muted" style="font-size:.8rem">${sub}</div>` : ''}
    </div>`;
  const cacheRate = cacheRatePct(s.cached_tokens, s.prompt_tokens);
  return `<div style="display:flex;gap:.75rem;flex-wrap:wrap">
    ${card('Requests', fmtNum(s.requests), s.errors ? `${fmtNum(s.errors)} errors` : 'no errors')}
    ${card('Input tokens', fmtNum(s.prompt_tokens), `cache rate ${cacheRate}`)}
    ${card('Cached input', fmtNum(s.cached_tokens), `cache write ${fmtNum(s.cache_write_tokens)}`)}
    ${card('Output tokens', fmtNum(s.completion_tokens))}
    ${card('Total tokens', fmtNum(s.total_tokens))}
  </div>`;
}

// Zero-dependency inline SVG bar chart of a daily series.
function svgBars(days: UsageDay[], pick: (d: UsageDay) => number, title: string): string {
  if (days.length === 0) {
    return `<p class="muted">No data in this window yet.</p>`;
  }
  const W = 780;
  const H = 120;
  const pad = 4;
  const max = Math.max(1, ...days.map(pick));
  const bw = (W - pad * 2) / days.length;
  const bars = days
    .map((d, i) => {
      const v = pick(d);
      const h = Math.round((v / max) * (H - 24));
      const x = pad + i * bw;
      const y = H - h - 16;
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h}" fill="#2563eb" rx="1"><title>${esc(d.day)}: ${fmtNum(v)}</title></rect>`;
    })
    .join('');
  const first = esc(days[0].day);
  const last = esc(days[days.length - 1].day);
  return `<div class="muted" style="font-size:.8rem">${esc(title)} · peak ${fmtNum(max)}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}">
      ${bars}
    </svg>
    <div class="muted" style="display:flex;justify-content:space-between;font-size:.75rem">
      <span>${first}</span><span>${last}</span>
    </div>`;
}

// Shared column layout for the By day / By model / Top users tables so their
// columns line up vertically across cards: label + 7 numeric columns.
const UCOLS = `<colgroup>
    <col style="width:20%">
    <col style="width:9%">
    <col style="width:11%">
    <col style="width:11%">
    <col style="width:11%">
    <col style="width:11%">
    <col style="width:11%">
    <col style="width:16%">
  </colgroup>`;

function modelTable(rows: UsageByModel[], totalTokens: number): string {
  if (rows.length === 0) return '<p class="muted">No model usage yet.</p>';
  const body = rows
    .map(
      (m) => `<tr>
        <td><code>${esc(m.model)}</code></td>
        <td>${fmtNum(m.requests)}</td>
        <td>${fmtNum(m.prompt_tokens)}</td>
        <td>${fmtNum(m.cached_tokens)}</td>
        <td>${fmtNum(m.cache_write_tokens)}</td>
        <td>${fmtNum(m.completion_tokens)}</td>
        <td>${cacheRatePct(m.cached_tokens, m.prompt_tokens)}</td>
        <td>${fmtNum(m.total_tokens)} <span class="muted">(${fmtPct(m.total_tokens, totalTokens)})</span></td>
      </tr>`
    )
    .join('');
  return `<div class="tablewrap"><table class="utable">
    ${UCOLS}
    <thead><tr><th>Model</th><th>Reqs</th><th>Input</th><th>Cached</th><th>Cache&nbsp;wr</th><th>Output</th><th>Cache&nbsp;rate</th><th>Total</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function byDayTable(rows: UsageDay[]): string {
  // Only show days that actually had traffic (the chart already covers the full
  // zero-filled window); newest first.
  const active = rows.filter((d) => d.requests > 0).reverse();
  if (active.length === 0) return '<p class="muted">No requests in this window yet.</p>';
  const body = active
    .map(
      (d) => `<tr>
        <td class="muted">${esc(d.day)}</td>
        <td>${fmtNum(d.requests)}</td>
        <td>${fmtNum(d.prompt_tokens)}</td>
        <td>${fmtNum(d.cached_tokens)}</td>
        <td>${fmtNum(d.cache_write_tokens)}</td>
        <td>${fmtNum(d.completion_tokens)}</td>
        <td>${cacheRatePct(d.cached_tokens, d.prompt_tokens)}</td>
        <td>${fmtNum(d.total_tokens)}</td>
      </tr>`
    )
    .join('');
  return `<div class="tablewrap"><table class="utable">
    ${UCOLS}
    <thead><tr><th>Day</th><th>Reqs</th><th>Input</th><th>Cached</th><th>Cache&nbsp;wr</th><th>Output</th><th>Cache&nbsp;rate</th><th>Total</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function recentTable(rows: RecentUsage[]): string {
  if (rows.length === 0) return '<p class="muted">No requests yet.</p>';
  const body = rows
    .map((r) => {
      const okPill =
        r.status_code && r.status_code >= 400
          ? `<span class="pill err">${r.status_code}</span>`
          : `<span class="pill ok">${r.status_code ?? '-'}</span>`;
      return `<tr>
        <td class="muted">${esc(r.created_at)}</td>
        <td>${esc(r.endpoint_kind || '-')}${r.stream ? ' <span class="muted">(stream)</span>' : ''}</td>
        <td><code>${esc(r.model || '-')}</code></td>
        <td>${okPill}</td>
        <td>${r.prompt_tokens == null ? '-' : fmtNum(r.prompt_tokens)}</td>
        <td>${r.cached_tokens == null ? '-' : fmtNum(r.cached_tokens)}</td>
        <td>${r.cache_write_tokens == null ? '-' : fmtNum(r.cache_write_tokens)}</td>
        <td>${r.completion_tokens == null ? '-' : fmtNum(r.completion_tokens)}</td>
        <td>${r.duration_ms == null ? '-' : `${fmtNum(r.duration_ms)}ms`}</td>
      </tr>`;
    })
    .join('');
  return `<div class="tablewrap"><table>
    <thead><tr><th>Time</th><th>Endpoint</th><th>Model</th><th>Status</th><th>Input</th><th>Cached</th><th>Cache&nbsp;wr</th><th>Output</th><th>Latency</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

export function usagePage(
  user: User,
  summary: UsageSummary,
  days: UsageDay[],
  byModel: UsageByModel[],
  recent: RecentUsage[],
  since: number
): string {
  return layout(
    'My usage',
    `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">My usage</h2>
        ${windowSelector('/dashboard/usage', since)}
      </div>
      ${usageCards(summary)}
      <div style="margin-top:1rem">${svgBars(days, (d) => d.requests, 'Requests per day')}</div>
      <div style="margin-top:1rem">${svgBars(days, (d) => d.total_tokens, 'Total tokens per day')}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">By day</h2>
      ${byDayTable(days)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">By model</h2>
      ${modelTable(byModel, summary.total_tokens)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">Recent requests</h2>
      ${recentTable(recent)}
    </div>`,
    user,
    'usage'
  );
}

function byUserTable(rows: UsageByUser[]): string {
  if (rows.length === 0) return '<p class="muted">No usage yet.</p>';
  const body = rows
    .map(
      (u) => `<tr>
        <td><a href="/admin/users/${u.user_id}/usage">${esc(u.username)}</a></td>
        <td>${fmtNum(u.requests)}</td>
        <td>${fmtNum(u.prompt_tokens)}</td>
        <td>${fmtNum(u.cached_tokens)}</td>
        <td>${fmtNum(u.cache_write_tokens)}</td>
        <td>${fmtNum(u.completion_tokens)}</td>
        <td>${cacheRatePct(u.cached_tokens, u.prompt_tokens)}</td>
        <td>${fmtNum(u.total_tokens)}</td>
      </tr>`
    )
    .join('');
  return `<div class="tablewrap"><table class="utable">
    ${UCOLS}
    <thead><tr><th>User</th><th>Reqs</th><th>Input</th><th>Cached</th><th>Cache&nbsp;wr</th><th>Output</th><th>Cache&nbsp;rate</th><th>Total</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

export function adminUsagePage(
  admin: User,
  summary: UsageSummary,
  days: UsageDay[],
  byModel: UsageByModel[],
  byUser: UsageByUser[],
  recent: RecentUsage[],
  since: number
): string {
  return layout(
    'Usage · admin',
    `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">Usage (all users)</h2>
        <div>${windowSelector('/admin/usage', since)} <a href="/admin/usage.csv?days=${since}">Export CSV</a></div>
      </div>
      ${usageCards(summary)}
      <div style="margin-top:1rem">${svgBars(days, (d) => d.requests, 'Requests per day')}</div>
      <div style="margin-top:1rem">${svgBars(days, (d) => d.total_tokens, 'Total tokens per day')}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">By day</h2>
      ${byDayTable(days)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">Top users</h2>
      ${byUserTable(byUser)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">By model</h2>
      ${modelTable(byModel, summary.total_tokens)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">Recent requests (all users)</h2>
      ${recentTable(recent)}
    </div>`,
    admin,
    'admin-usage'
  );
}

export function adminUserUsagePage(
  admin: User,
  target: User,
  summary: UsageSummary,
  days: UsageDay[],
  byModel: UsageByModel[],
  recent: RecentUsage[],
  since: number
): string {
  return layout(
    `Usage · ${target.username}`,
    `<p><a href="/admin/users/${target.id}">← Manage ${esc(target.username)}</a></p>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">${esc(target.username)}'s usage</h2>
        ${windowSelector(`/admin/users/${target.id}/usage`, since)}
      </div>
      ${usageCards(summary)}
      <div style="margin-top:1rem">${svgBars(days, (d) => d.requests, 'Requests per day')}</div>
      <div style="margin-top:1rem">${svgBars(days, (d) => d.total_tokens, 'Total tokens per day')}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">By day</h2>
      ${byDayTable(days)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">By model</h2>
      ${modelTable(byModel, summary.total_tokens)}
    </div>
    <div class="card">
      <h2 style="margin-top:0">Recent requests</h2>
      ${recentTable(recent)}
    </div>`,
    admin,
    'admin-usage'
  );
}

export function examplesPage(user: User, gatewayBase: string): string {
  const key = 'YOUR_CPX_KEY';
  const openai = `curl ${gatewayBase}/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'`;
  const responses = `curl ${gatewayBase}/v1/responses \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.5",
    "input": "Say hello in one sentence."
  }'`;
  const anthropic = `curl ${gatewayBase}/v1/messages \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-opus-4.8",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'`;
  const claudeCode = `{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": {
    "ANTHROPIC_BASE_URL": "${gatewayBase}",
    "ANTHROPIC_AUTH_TOKEN": "${key}",
    "ANTHROPIC_MODEL": "claude-opus-4.8"
  }
}`;
  const codex = `[model_providers.copilot-proxy]
name = "copilot-proxy"
base_url = "${gatewayBase}/v1"
wire_api = "responses"
env_key = "CPX_KEY"`;
  return layout(
    'Examples',
    `<div class="card">
      <h2 style="margin-top:0">Client examples</h2>
      <p class="muted">Replace <code>${key}</code> with one of your API keys from the dashboard. The endpoint is the same for everyone.</p>
      <p>Endpoint: <code>${esc(gatewayBase)}</code></p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Try it in your browser</h2>
      <p class="muted">Pick a model and send a real request straight from this page. Your API key stays in the browser — it's sent only to the proxy at <code>${esc(gatewayBase)}</code>, never to the control-plane. (The proxy allows these cross-origin browser calls via CORS.)</p>
      <p><input id="cpxkey" type="password" placeholder="cpx-… (paste one of your keys)" style="width:100%"></p>
      <p style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <select id="surface">
          <option value="chat">chat/completions</option>
          <option value="responses">responses (gpt-5.x)</option>
          <option value="messages">messages (Anthropic)</option>
        </select>
        <select id="model" style="flex:1;min-width:200px">
          <option value="">— Load models, or pick a default —</option>
          <option value="gpt-4o">gpt-4o</option>
          <option value="gpt-5.4">gpt-5.4</option>
          <option value="claude-opus-4.8">claude-opus-4.8</option>
          <option value="claude-sonnet-4.6">claude-sonnet-4.6</option>
        </select>
        <button type="button" onclick="cpxLoadModels()" class="secondary">Load models</button>
      </p>
      <p><textarea id="prompt" style="width:100%;height:3.5rem">Say hello in one sentence.</textarea></p>
      <p><button type="button" onclick="cpxSend()">Send test request</button> <span id="teststatus" class="pill muted">idle</span></p>
      <pre id="out" class="muted">Response will appear here.</pre>
    </div>
    <div class="card">
      <h2 style="margin-top:0">OpenAI · chat/completions</h2>
      <pre>${esc(openai)}</pre>
    </div>
    <div class="card">
      <h2 style="margin-top:0">OpenAI · responses (gpt-5.x reasoning models)</h2>
      <p class="muted">gpt-5.x reasoning models require <code>/v1/responses</code>, not chat/completions.</p>
      <pre>${esc(responses)}</pre>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Anthropic · messages</h2>
      <pre>${esc(anthropic)}</pre>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Claude Code · ~/.claude/settings.json</h2>
      <pre>${esc(claudeCode)}</pre>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Codex · ~/.codex/config.toml</h2>
      <pre>${esc(codex)}</pre>
    </div>
    <script>
      const CPX_PROXY = ${JSON.stringify(gatewayBase)};
      function cpxEl(id){ return document.getElementById(id); }
      function cpxStatus(msg, cls){ var el=cpxEl('teststatus'); el.className='pill '+cls; el.textContent=msg; }
      async function cpxLoadModels(){
        var key=cpxEl('cpxkey').value.trim();
        if(!key){ cpxStatus('Enter your API key first','err'); return; }
        cpxStatus('Loading models…','warn');
        try{
          var r=await fetch(CPX_PROXY+'/v1/models',{headers:{Authorization:'Bearer '+key}});
          var d=await r.json();
          var list=(d&&d.data)||[];
          var sel=cpxEl('model');
          var prev=sel.value;
          sel.innerHTML='';
          list.map(function(m){ return (m&&m.id)||m; })
            .sort()
            .forEach(function(id){ var o=document.createElement('option'); o.value=id; o.textContent=id; sel.appendChild(o); });
          if(prev && list.some(function(m){ return ((m&&m.id)||m)===prev; })){ sel.value=prev; }
          cpxStatus('Loaded '+list.length+' models','ok');
        }catch(e){ cpxStatus('Failed to load models: '+e.message,'err'); }
      }
      async function cpxSend(){
        var key=cpxEl('cpxkey').value.trim();
        var model=cpxEl('model').value.trim();
        var surface=cpxEl('surface').value;
        var prompt=cpxEl('prompt').value;
        if(!key||!model){ cpxStatus('Need an API key and a model','err'); return; }
        var url, body, headers={'Content-Type':'application/json'};
        if(surface==='messages'){
          url=CPX_PROXY+'/v1/messages';
          headers['x-api-key']=key; headers['anthropic-version']='2023-06-01';
          body={model:model,max_tokens:256,messages:[{role:'user',content:prompt}]};
        } else if(surface==='responses'){
          url=CPX_PROXY+'/v1/responses';
          headers['Authorization']='Bearer '+key;
          body={model:model,input:prompt};
        } else {
          url=CPX_PROXY+'/v1/chat/completions';
          headers['Authorization']='Bearer '+key;
          body={model:model,messages:[{role:'user',content:prompt}]};
        }
        cpxStatus('Sending…','warn');
        cpxEl('out').textContent='';
        try{
          var r=await fetch(url,{method:'POST',headers:headers,body:JSON.stringify(body)});
          var text=await r.text();
          var pretty=text; try{ pretty=JSON.stringify(JSON.parse(text),null,2); }catch(_e){}
          cpxEl('out').textContent=pretty;
          cpxStatus('HTTP '+r.status,r.ok?'ok':'err');
        }catch(e){ cpxStatus('Request failed: '+e.message,'err'); cpxEl('out').textContent=String(e); }
      }
    </script>`,
    user,
    'examples'
  );
}
