(() => {
  const path = location.pathname.split('/').filter(Boolean)[0] || 'home';
  const $ = (s, root = document) => root.querySelector(s);
  const api = async (url, options = {}, retried = false) => {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const token = sessionStorage.getItem('vox_nexus_access');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response = await fetch(url, { ...options, headers, cache: 'no-store' });
    if (response.status === 401 && !retried && !url.startsWith('/api/auth/')) {
      const refreshToken = sessionStorage.getItem('vox_nexus_refresh');
      if (refreshToken) {
        const refresh = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
        const session = await refresh.json().catch(() => ({}));
        if (refresh.ok && session.session?.access_token) { setSession(session.session); return api(url, options, true); }
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  };
  const message = (form, text, error = false) => {
    const note = $('.form-note', form) || $('.notice', form);
    if (note) { note.textContent = text; note.classList.toggle('error', error); note.classList.add('show'); }
  };
  const setSession = session => {
    if (session?.access_token) sessionStorage.setItem('vox_nexus_access', session.access_token);
    if (session?.refresh_token) sessionStorage.setItem('vox_nexus_refresh', session.refresh_token);
  };

  if (path === 'login' || path === 'signup') {
    const form = $('.auth-box');
    if (form) form.addEventListener('submit', async event => {
      event.preventDefault();
      const signup = path === 'signup';
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      try {
        const data = await api(`/api/auth/${signup ? 'signup' : 'login'}`, { method: 'POST', body: JSON.stringify({ email: $('#email', form).value, password: $('#password', form).value, fullName: $('#name', form)?.value || '' }) });
        if (data.session?.access_token) { setSession(data.session); location.href = '/panel/'; }
        else if (data.confirmationRequired) message(form, 'Check your email to confirm your account, then sign in.');
        else message(form, 'Account created. Sign in to continue.');
      } catch (err) { message(form, err.message, true); }
      finally { submit.disabled = false; }
    });
    return;
  }

  if (path === 'home') return;
  api('/api/auth/me').then(result => {
    const name = result.user?.name || result.user?.email || 'Workspace member';
    const workspace = $('.workspace-switch b');
    if (workspace) workspace.textContent = name;
    const user = $('.user-card b');
    if (user) user.textContent = name;
  }).catch(() => { location.href = '/login/'; });

  if (path === 'panel') {
    Promise.all([api('/api/wallet/balance'), api('/api/missions?view=summary'), api('/api/auth/me')]).then(async ([wallet, missions, profile]) => {
      const stats = [...document.querySelectorAll('.stat-card')];
      if (stats[0]) $('b', stats[0]).textContent = String((missions.missions || []).filter(x => ['active', 'scheduled'].includes(x.status)).length).padStart(2, '0');
      if (stats[1] && profile.isAdmin) {
        try { const providers = await api('/api/providers'); $('b', stats[1]).textContent = String((providers.providers || []).length).padStart(2, '0'); } catch {}
      }
      if (stats[2]) $('b', stats[2]).textContent = `₹${Number(wallet.balance_inr || 0).toFixed(2)}`;
    }).catch(() => {});
  }

  if (path === 'orders') {
    const host = $('.table-card');
    if (host) {
      const form = document.createElement('form');
      form.className = 'panel-card form-card';
      form.innerHTML = '<div class="card-head"><div><small>CAMPAIGN WORKSPACE</small><h2>Save a campaign brief</h2></div></div><label>Campaign name<input name="name" required maxlength="120" placeholder="Campaign name"></label><label>Platform<input name="platform" required maxlength="80" placeholder="Instagram, YouTube, etc."></label><label>Campaign goal<input name="goal" required maxlength="300" placeholder="What are you promoting?"></label><label>Target URL<input name="targetUrl" type="url" maxlength="2000" placeholder="https://..."></label><button class="button" type="submit">Save campaign brief ↗</button><p class="form-note">Campaigns are saved to your workspace. Provider delivery requires an authorized provider configuration.</p>';
      host.after(form);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const f = new FormData(form);
        try { await api('/api/missions', { method: 'POST', body: JSON.stringify({ campaign: { name: f.get('name'), platform: f.get('platform'), goal: f.get('goal'), targetUrl: f.get('targetUrl') }, estimatedCostInr: 0 }) }); message(form, 'Campaign brief saved. It is awaiting provider configuration.'); form.reset(); }
        catch (err) { message(form, err.message, true); }
      });
    }
    api('/api/missions?view=summary').then(data => {
      const empty = $('.empty-state', $('.table-card') || document);
      if (!empty || !data.missions?.length) return;
      empty.innerHTML = `<span>▤</span><h3>Your campaign briefs</h3><div class="tracker-rows">${data.missions.map(m => `<div><b>${String(m.campaign?.name || 'Campaign').replace(/[&<>"']/g, '')}</b><span>${String(m.campaign?.platform || '').replace(/[&<>"']/g, '')}</span><span class="status-pill amber">${m.status}</span></div>`).join('')}</div>`;
    }).catch(() => {});
  }

  if (path === 'wallet') api('/api/wallet/balance').then(data => {
    const balance = $('.balance-card b'); if (balance) balance.textContent = `₹${Number(data.balance_inr || 0).toFixed(2)}`;
    const note = $('.balance-card span'); if (note) note.textContent = 'Current workspace balance';
  }).catch(() => {});

  if (path === 'support') document.querySelectorAll('.local-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const inputs = [...form.querySelectorAll('input, textarea')];
    try { await api('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: inputs[0]?.value || 'Support request', message: inputs[1]?.value || '' }) }); message(form, 'Support ticket created.'); form.reset(); }
    catch (err) { message(form, err.message, true); }
  }));

  if (path === 'ratios') api('/api/ratios').then(data => {
    const values = data.ratios || {};
    for (const [id, key] of [['views-input', 'views'], ['likes-rate', 'likes'], ['comments-rate', 'comments'], ['shares-rate', 'shares']]) if ($(`#${id}`) && Number.isFinite(Number(values[key]))) $(`#${id}`).value = values[key];
    $('#recalc-ratios')?.click();
  }).catch(() => {});

  if (path === 'tracker') api('/api/missions?view=summary').then(data => {
    const rows = $('.tracker-rows'); const empty = $('.tracker-empty');
    if (!rows || !data.missions?.length) return;
    if (empty) empty.hidden = true;
    rows.hidden = false;
    rows.innerHTML = data.missions.map((m, i) => `<div><span>${String(m.id).slice(0, 8)}</span><b>${String(m.campaign?.name || `Campaign ${i + 1}`).replace(/[&<>"']/g, '')}</b><span class="status-pill amber">${m.status}</span><span>${String(m.campaign?.platform || '').replace(/[&<>"']/g, '')}</span></div>`).join('');
  }).catch(() => {});

  if (path === 'providers') api('/api/providers').then(data => {
    const grid = $('.provider-grid');
    if (!grid) return;
    const providers = data.providers || [];
    grid.replaceChildren();
    if (!providers.length) { grid.innerHTML = '<div class="empty-state"><h3>No providers are configured</h3><p>Add an authorized provider configuration on the server before dispatch can be enabled.</p></div>'; return; }
    for (const provider of providers) {
      const card = document.createElement('article'); card.className = 'provider-card';
      const name = document.createElement('h2'); name.textContent = provider.name || 'Provider';
      const status = document.createElement('p'); status.textContent = `${provider.mode || 'manual'} · ${provider.enabled ? 'enabled' : 'disabled'}`;
      const note = document.createElement('p'); note.textContent = 'Only provider metadata is shown. Secrets are never returned to the browser.';
      card.append(name, status, note); grid.append(card);
    }
  }).catch(() => {});
})();
