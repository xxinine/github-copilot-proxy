import type { Account, ApiKey, User } from '@cpx/shared';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

function layout(title: string, body: string, user?: User): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #8884; padding-bottom: .5rem; margin-bottom: 1.5rem; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
  code, pre { background: #8881; padding: .15rem .35rem; border-radius: 4px; font-size: .9em; }
  pre { padding: .75rem; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; font-size: .92rem; }
  input, button { font: inherit; padding: .45rem .6rem; border-radius: 6px; border: 1px solid #8886; }
  button { cursor: pointer; background: #2563eb; color: #fff; border-color: #2563eb; }
  button.secondary { background: transparent; color: inherit; }
  .card { border: 1px solid #8884; border-radius: 10px; padding: 1rem; margin: 1rem 0; }
  .pill { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-size: .8rem; }
  .ok { background: #16a34a22; color: #16a34a; } .warn { background: #d9770622; color: #d97706; }
  .err { background: #dc262622; color: #dc2626; } .muted { color: #8889; }
  form.inline { display: inline; }
  a { color: #2563eb; }
</style>
</head>
<body>
<header>
  <h1>Copilot Proxy · Control Plane</h1>
  <div>${user ? `${esc(user.username)}${user.is_admin ? ' (admin)' : ''} · <a href="/logout">Logout</a>` : ''}</div>
</header>
${body}
</body>
</html>`;
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
        <form class="inline" method="post" action="/restart"><button class="secondary">Restart container</button></form>
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
        <td>${k.status === 'active' ? `<form class="inline" method="post" action="/keys/${k.id}/revoke"><button class="secondary">Revoke</button></form>` : ''}</td>
      </tr>`
    )
    .join('');

  const newKeyBanner = flash?.newKey
    ? `<div class="card" style="border-color:#16a34a">
        <strong>New API key (copy now — shown once):</strong>
        <pre>${esc(flash.newKey)}</pre>
      </div>`
    : '';

  return layout(
    'Dashboard',
    `${user.is_admin ? '<p><a href="/admin">← Admin · manage users</a></p>' : ''}
    ${bindingCard}
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
    </div>
    <div class="card">
      <h2 style="margin-top:0">How to use</h2>
      <p>Unified endpoint (same for everyone):</p>
      <pre>${esc(gatewayBase)}/v1/chat/completions</pre>
      <p>Authenticate with <em>your</em> key:</p>
      <pre>curl ${esc(gatewayBase)}/v1/models \\
  -H "Authorization: Bearer YOUR_CPX_KEY"</pre>
    </div>`,
    user
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
    user
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
    `<p><a href="/dashboard">← My dashboard</a></p>
    <div class="card">
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
    user
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
            : ''
        }</td>
      </tr>`
    )
    .join('');
  const newKeyBanner = flash?.newKey
    ? `<div class="card" style="border-color:#16a34a">
        <strong>New API key for ${esc(target.username)} (copy now — shown once, then hand it to the user securely):</strong>
        <pre>${esc(flash.newKey)}</pre>
      </div>`
    : '';
  return layout(
    'Manage user',
    `<p><a href="/admin">← Back to users</a></p>
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
    </div>`,
    admin
  );
}
