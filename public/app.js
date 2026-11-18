(() => {
  const $ = (selector) => document.querySelector(selector);
  const state = { accessToken: sessionStorage.getItem('vox_nexus_access') || '', refreshToken: sessionStorage.getItem('vox_nexus_refresh') || '', profile: null, services: [], view: 'overview', authMode: 'login', toastTimer: null };
  const titles = { overview: 'Overview', services: 'Services', orders: 'My requests', wallet: 'Wallet', support: 'Support', providers: 'Providers' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function money(cents) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
  }
  function toast(message, isError = false) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }
  function setSession(session) {
    state.accessToken = session?.access_token || '';
    state.refreshToken = session?.refresh_token || '';
    if (state.accessToken) sessionStorage.setItem('vox_nexus_access', state.accessToken); else sessionStorage.removeItem('vox_nexus_access');
    if (state.refreshToken) sessionStorage.setItem('vox_nexus_refresh', state.refreshToken); else sessionStorage.removeItem('vox_nexus_refresh');
  }
  async function refreshSession() {
    if (!state.refreshToken) return false;
    const response = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: state.refreshToken }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.session?.access_token) { setSession(null); return false; }
    setSession(payload.session);
    return true;
  }
  async function api(path, options = {}, retried = false) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (state.accessToken) headers.set('Authorization', `Bearer ${state.accessToken}`);
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
    if (response.status === 401 && !retried && state.refreshToken && !path.startsWith('/api/auth/')) {
      if (await refreshSession()) return api(path, options, true);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }
  function showAuth() {
    $('#auth-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
    $('#logout').classList.add('hidden');
    setSession(null);
  }
  function showApp() {
    $('#auth-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#logout').classList.remove('hidden');
    const profile = state.profile || {};
    const name = profile.full_name || profile.email?.split('@')[0] || 'there';
    $('#user-name').textContent = name;
    $('#user-email').textContent = profile.email || '';
    $('#welcome-name').textContent = name;
    $('#avatar').textContent = name.charAt(0).toUpperCase();
    $('#providers-nav').classList.toggle('hidden', profile.role !== 'admin');
    switchView(state.view || 'overview');
    loadOverview();
  }
  function switchView(view) {
    if (!titles[view] || (view === 'providers' && state.profile?.role !== 'admin')) return;
    state.view = view;
    document.querySelectorAll('.view-section').forEach((section) => section.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    $('#page-title').textContent = titles[view];
    $('#crumb').textContent = titles[view].toUpperCase();
    $('#notice').classList.add('hidden');
    if (view === 'services') loadServices();
    if (view === 'orders') { loadServices(); loadOrders(); }
    if (view === 'wallet') loadWallet();
    if (view === 'support') loadTickets();
    if (view === 'providers') loadProviders();
  }
  function displayError(message) {
    $('#notice').textContent = message;
    $('#notice').classList.remove('hidden');
  }
  async function loadServices() {
    try {
      const result = await api('/api/services');
      state.services = result.services || [];
      $('#stat-services').textContent = String(state.services.length);
      $('#services-list').innerHTML = state.services.length ? state.services.map((service) => `<article class="service-card"><span class="category">${escapeHtml(service.category)}</span><h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p><div class="service-meta"><span>Request size ${service.min_quantity}–${service.max_quantity}</span><strong>${money(service.rate_per_1k_cents)} / 1k</strong></div></article>`).join('') : '<div class="empty-state">No services are available yet.</div>';
      const select = $('#service-select');
      const selected = select.value;
      select.innerHTML = '<option value="">Choose a service</option>' + state.services.map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)} · ${money(service.rate_per_1k_cents)} / 1k</option>`).join('');
      if (selected) select.value = selected;
      updateEstimate();
    } catch (err) { displayError(err.message); }
  }
  async function loadOrders() {
    try {
      const result = await api('/api/orders');
      const orders = result.orders || [];
      $('#stat-open').textContent = String(orders.filter((order) => !['completed', 'cancelled'].includes(order.status)).length);
      $('#orders-list').innerHTML = orders.length ? orders.slice(0, 12).map((order) => `<div class="list-row"><div><strong>${escapeHtml(order.service_name)}</strong><small>${Number(order.quantity)} units · ${new Date(order.created_at).toLocaleDateString()}</small></div><span class="status-pill">${escapeHtml(order.status.replaceAll('_', ' '))}</span></div>`).join('') : '<div class="empty-state">No requests yet. Choose a service and submit a brief to get started.</div>';
    } catch (err) { displayError(err.message); }
  }
  async function loadWallet() {
    try {
      const result = await api('/api/wallet/balance');
      $('#wallet-balance').textContent = money(result.balanceCents);
      $('#stat-balance').textContent = money(result.balanceCents);
      $('#ledger-list').innerHTML = result.ledger?.length ? result.ledger.map((entry) => `<div class="list-row"><div><strong>${escapeHtml(entry.description)}</strong><small>${new Date(entry.created_at).toLocaleString()}</small></div><span class="status-pill">${money(entry.amount_cents)}</span></div>`).join('') : '<div class="empty-state">No wallet activity. Your administrator can add a verified adjustment.</div>';
    } catch (err) { displayError(err.message); }
  }
  async function loadTickets() {
    try {
      const result = await api('/api/support/tickets');
      $('#tickets-list').innerHTML = result.tickets?.length ? result.tickets.map((ticket) => `<div class="list-row"><div><strong>${escapeHtml(ticket.subject)}</strong><small>${new Date(ticket.created_at).toLocaleDateString()}</small></div><span class="status-pill">${escapeHtml(ticket.status)}</span></div>`).join('') : '<div class="empty-state">No support conversations yet.</div>';
    } catch (err) { displayError(err.message); }
  }
  async function loadProviders() {
    try {
      const result = await api('/api/providers');
      $('#providers-list').innerHTML = result.providers?.length ? result.providers.map((provider) => `<div class="list-row"><div><strong>${escapeHtml(provider.name)}</strong><small>${escapeHtml(provider.mode)} · ${escapeHtml(provider.kind)}</small></div><span class="status-pill">${provider.enabled ? 'enabled' : 'disabled'}</span></div>`).join('') : '<div class="empty-state">No provider is configured.</div>';
    } catch (err) { displayError(err.message); }
  }
  async function loadOverview() {
    try {
      const [wallet, orders, services] = await Promise.all([api('/api/wallet/balance'), api('/api/orders'), api('/api/services')]);
      $('#stat-balance').textContent = money(wallet.balanceCents);
      $('#stat-open').textContent = String((orders.orders || []).filter((order) => !['completed', 'cancelled'].includes(order.status)).length);
      $('#stat-services').textContent = String((services.services || []).length);
    } catch (err) { displayError(err.message); }
  }
  function updateEstimate() {
    const service = state.services.find((item) => item.id === $('#service-select').value);
    const quantity = Math.max(0, Number($('#quantity').value) || 0);
    $('#estimate').textContent = service ? money(Math.ceil(quantity * Number(service.rate_per_1k_cents) / 1000)) : '$0.00';
  }
  async function bootstrap() {
    if (!state.accessToken && state.refreshToken) await refreshSession();
    if (!state.accessToken) return;
    try {
      const result = await api('/api/auth/me');
      state.profile = result.profile;
      showApp();
    } catch { showAuth(); }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = state.authMode === 'signup';
    $('#auth-title').textContent = signup ? 'Create account' : 'Sign in';
    $('#auth-copy').textContent = signup ? 'Start your private marketing workspace.' : 'Use your account to open your workspace.';
    $('#full-name-wrap').classList.toggle('hidden', !signup);
    $('#password').autocomplete = signup ? 'new-password' : 'current-password';
    $('#auth-submit').innerHTML = signup ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
    $('#switch-copy').textContent = signup ? 'Already registered?' : 'New to Vox Nexus?';
    $('#switch-mode').textContent = signup ? 'Sign in' : 'Create an account';
  }
  $('#switch-mode').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'signup' : 'login'));
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const signup = state.authMode === 'signup';
    const button = $('#auth-submit');
    button.disabled = true;
    try {
      const result = await api(signup ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value, fullName: $('#full-name').value }) });
      if (result.session?.access_token) {
        setSession(result.session);
        const me = await api('/api/auth/me');
        state.profile = me.profile;
        state.view = 'overview';
        showApp();
        toast(signup ? 'Your workspace is ready.' : 'Signed in successfully.');
      } else if (result.confirmationRequired) {
        toast('Check your email to confirm your account, then sign in.');
        setAuthMode('login');
      } else {
        toast('Account created. Sign in to continue.');
        setAuthMode('login');
      }
    } catch (err) { toast(err.message, true); }
    finally { button.disabled = false; }
  });
  $('#logout').addEventListener('click', async () => {
    try { if (state.accessToken) await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setSession(null); state.profile = null; state.view = 'overview'; showAuth(); toast('You are signed out.');
  });
  $('#nav').addEventListener('click', (event) => {
    const item = event.target.closest('[data-view]');
    if (item) switchView(item.dataset.view);
  });
  document.body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-go]');
    if (target) switchView(target.dataset.go);
  });
  $('#service-select').addEventListener('change', updateEstimate);
  $('#quantity').addEventListener('input', updateEstimate);
  $('#order-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const service = state.services.find((item) => item.id === $('#service-select').value);
    if (!service) return toast('Choose a service first.', true);
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify({ serviceId: service.id, quantity: Number($('#quantity').value), brief: $('#brief').value, idempotencyKey: crypto.randomUUID() }) });
      $('#brief').value = '';
      await Promise.all([loadOrders(), loadWallet(), loadOverview()]);
      toast('Request submitted for manual review.');
    } catch (err) { toast(err.message, true); }
    finally { button.disabled = false; }
  });
  $('#ticket-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await api('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject: $('#ticket-subject').value, message: $('#ticket-message').value }) });
      $('#ticket-subject').value = ''; $('#ticket-message').value = '';
      await loadTickets(); toast('Support ticket opened.');
    } catch (err) { toast(err.message, true); }
    finally { button.disabled = false; }
  });
  bootstrap();
})();
