const { requireUser } = require('./_lib/auth');
const { getAdminClient } = require('./_lib/supabase');
const { json, method, body, error, fail } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'PUT'])) return;
  const db = getAdminClient();
  if (req.method === 'GET') {
    const auth = await requireUser(req, res);
    if (!auth) return;
    try {
      const [{ data: global }, { data: personal }] = await Promise.all([
        db.from('panel_settings').select('value').eq('key', 'bundles').maybeSingle(),
        db.from('user_bundles').select('bundle').eq('user_id', auth.user.id).order('updated_at', { ascending: false })
      ]);
      const defaults = Array.isArray(global?.value?.bundles) ? global.value.bundles : [];
      const saved = (personal || []).map(row => row.bundle);
      const bundles = [...saved, ...defaults.filter(item => !saved.some(entry => entry.id === item.id))];
      return json(res, 200, { bundles, activeBundleId: global?.value?.activeBundleId || bundles[0]?.id || null, deletedIds: [] });
    } catch (err) { return fail(res, err); }
  }
  const auth = await requireUser(req, res);
  if (!auth) return;
  const input = body(req);
  if (!input || typeof input.id !== 'string' || !input.id || JSON.stringify(input).length > 64000) return error(res, 400, 'A valid bundle is required.');
  try {
    const { data, error: dbError } = await db.from('user_bundles').upsert({ user_id: auth.user.id, bundle_id: input.id, bundle: input, updated_at: new Date().toISOString() }, { onConflict: 'user_id,bundle_id' }).select('bundle').single();
    if (dbError) throw dbError;
    return json(res, 200, { success: true, bundle: data.bundle });
  } catch (err) { return fail(res, err); }
};
