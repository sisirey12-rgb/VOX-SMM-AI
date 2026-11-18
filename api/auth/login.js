const { getEnv } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const input = body(req);
  if (!input || typeof input.email !== 'string' || typeof input.password !== 'string') return error(res, 400, 'Email and password are required.');
  try {
    const url = getEnv('SUPABASE_URL').replace(/\/$/, '');
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: getEnv('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return error(res, response.status, data.msg || data.message || data.error_description || 'Email or password is incorrect.');
    return json(res, 200, { user: data.user, session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, token_type: data.token_type } });
  } catch (err) { return fail(res, err); }
};
