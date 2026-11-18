const { getEnv } = require('../_lib/supabase');
const { method, json, error, fail } = require('../_lib/http');
const { bearer } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const token = bearer(req);
  if (!token) return error(res, 401, 'Sign in to continue.');
  try {
    const response = await fetch(`${getEnv('SUPABASE_URL').replace(/\/$/, '')}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: getEnv('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return error(res, 401, 'The session is already expired.');
    return json(res, 200, { ok: true });
  } catch (err) { return fail(res, err); }
};
