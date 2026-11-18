const { requireAdmin } = require('./_lib/auth');
const { getAdminClient } = require('./_lib/supabase');
const { json, method, body, error, fail } = require('./_lib/http');
const DEFAULT_RATIOS = { views: 10000, likes: 35, comments: 8, shares: 5 };

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  const db = getAdminClient();
  if (req.method === 'GET') {
    try {
      const { data, error: dbError } = await db.from('panel_settings').select('value').eq('key', 'ratios').maybeSingle();
      if (dbError) throw dbError;
      return json(res, 200, { ratios: data?.value || DEFAULT_RATIOS, source: data ? 'database' : 'default' });
    } catch (err) { return fail(res, err); }
  }
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const ratios = body(req);
  if (!ratios || typeof ratios !== 'object' || Array.isArray(ratios) || JSON.stringify(ratios).length > 16000) return error(res, 400, 'A valid ratio object is required.');
  try {
    const { error: dbError } = await db.from('panel_settings').upsert({ key: 'ratios', value: ratios, updated_by: auth.user.id, updated_at: new Date().toISOString() });
    if (dbError) throw dbError;
    return json(res, 200, { success: true });
  } catch (err) { return fail(res, err); }
};
