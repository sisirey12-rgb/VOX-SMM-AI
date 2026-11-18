const { json, method, body, error, fail } = require('../_lib/http');
const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'PATCH'])) return;
  const db = getAdminClient();
  if (req.method === 'GET') {
    try {
      const { data, error: dbError } = await db.from('panel_settings').select('value').eq('key', 'maintenance').maybeSingle();
      if (dbError) throw dbError;
      return json(res, 200, data?.value || { maintenance_mode: false, maintenance: false, message: null });
    } catch (err) { return fail(res, err); }
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const input = body(req) || {};
  const enabled = typeof input.maintenance_mode === 'boolean' ? input.maintenance_mode : input.maintenance;
  if (typeof enabled !== 'boolean') return error(res, 400, 'maintenance_mode must be a boolean.');
  try {
    const value = { maintenance_mode: enabled, maintenance: enabled, message: enabled ? String(input.message || 'Temporarily unavailable.').slice(0, 180) : null };
    const { error: dbError } = await db.from('panel_settings').upsert({ key: 'maintenance', value, updated_by: auth.user.id, updated_at: new Date().toISOString() });
    if (dbError) throw dbError;
    return json(res, 200, value);
  } catch (err) { return fail(res, err); }
};
