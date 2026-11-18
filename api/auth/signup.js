const { getEnv } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const input = body(req);
  if (!input || typeof input.email !== 'string' || typeof input.password !== 'string') return error(res, 400, 'Email and password are required.');
  if (input.password.length < 8 || input.password.length > 128) return error(res, 400, 'Password must be 8–128 characters.');
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim().slice(0, 80) : '';
  try {
    const url = getEnv('SUPABASE_URL').replace(/\/$/, '');
    const response = await fetch(`${url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: getEnv('SUPABASE_ANON_KEY'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.email.trim().toLowerCase(), password: input.password, data: { full_name: fullName } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return error(res, response.status, data.msg || data.message || data.error_description || 'Sign-up was rejected.');
    return json(res, 201, { user: data.user || null, session: data.session || null, confirmationRequired: !data.session });
  } catch (err) { return fail(res, err); }
};
