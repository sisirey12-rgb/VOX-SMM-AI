const { getEnv } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const input = body(req);
  if (!input || typeof input.refreshToken !== 'string' || input.refreshToken.length > 4096) return error(res, 400, 'A refresh token is required.');
  try {
    const url = getEnv('SUPABASE_URL').replace(/\/$/, '');
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: getEnv('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: input.refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return error(res, 401, 'The session could not be refreshed. Sign in again.');
    return json(res, 200, { user: data.user, session: { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, token_type: data.token_type } });
  } catch (err) { return fail(res, err); }
};
