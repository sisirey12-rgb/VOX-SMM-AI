const { getAdminClient } = require('./supabase');
const { error } = require('./http');

function bearer(req) {
  const value = req.headers.authorization || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function requireUser(req, res) {
  const token = bearer(req);
  if (!token) {
    error(res, 401, 'Sign in to continue.', 'AUTH_REQUIRED');
    return null;
  }
  try {
    const client = getAdminClient();
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData?.user) {
      error(res, 401, 'Your session is invalid or expired.', 'INVALID_SESSION');
      return null;
    }
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id,email,full_name,role')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      error(res, 403, 'Account profile is unavailable.');
      return null;
    }
    return { user: authData.user, profile, token };
  } catch (err) {
    console.error('auth_error', { message: err.message });
    error(res, 503, 'Authentication service is unavailable.');
    return null;
  }
}

async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  if (auth.profile.role !== 'admin') {
    error(res, 403, 'Access denied. Administrator privileges required.', 'ADMIN_REQUIRED');
    return null;
  }
  return auth;
}

module.exports = { bearer, requireUser, requireAdmin };
