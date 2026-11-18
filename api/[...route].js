const { error } = require('../server-routes/_lib/http');

// One Vercel Function dispatches the API endpoints. This keeps the project
// within the Hobby plan's Serverless Function limit.
const routes = {
  '/api/config': require('../server-routes/config'),
  '/api/health': require('../server-routes/health'),
  '/api/orders': require('../server-routes/orders'),
  '/api/providers': require('../server-routes/providers'),
  '/api/providers/sync': require('../server-routes/providers/sync'),
  '/api/services': require('../server-routes/services'),
  '/api/admin/orders': require('../server-routes/admin/orders'),
  '/api/admin/orders/status': require('../server-routes/admin/orders/status'),
  '/api/admin/payment-settings': require('../server-routes/admin/payment-settings'),
  '/api/admin/payment-settings/test': require('../server-routes/admin/payment-settings/test'),
  '/api/admin/services': require('../server-routes/admin/services'),
  '/api/admin/users': require('../server-routes/admin/users'),
  '/api/admin/users/wallet-adjust': require('../server-routes/admin/users/wallet-adjust'),
  '/api/auth/config': require('../server-routes/auth/config'),
  '/api/auth/login': require('../server-routes/auth/login'),
  '/api/auth/logout': require('../server-routes/auth/logout'),
  '/api/auth/me': require('../server-routes/auth/me'),
  '/api/auth/refresh': require('../server-routes/auth/refresh'),
  '/api/auth/signup': require('../server-routes/auth/signup'),
  '/api/cron/dispatch': require('../server-routes/cron/dispatch'),
  '/api/support/tickets': require('../server-routes/support/tickets'),
  '/api/system/maintenance': require('../server-routes/system/maintenance'),
  '/api/wallet/balance': require('../server-routes/wallet/balance'),
  '/api/wallet/public-config': require('../server-routes/wallet/public-config'),
  '/api/wallet/verify-fampay': require('../server-routes/wallet/verify-fampay')
};

module.exports = async function handler(req, res) {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
  } catch {
    return error(res, 400, 'Invalid request path.');
  }

  if (pathname === '/api/orders' || !pathname.startsWith('/api/orders/')) {
    const route = routes[pathname];
    if (!route) return error(res, 404, 'API route not found.');
    return route(req, res);
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (!orderMatch) return error(res, 404, 'API route not found.');
  try {
    req.query = { ...(req.query || {}), id: decodeURIComponent(orderMatch[1]) };
  } catch {
    return error(res, 400, 'Invalid order id.');
  }
  return require('../server-routes/orders/[id].js')(req, res);
};
