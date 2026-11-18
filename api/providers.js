const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!await requireAdmin(req, res)) return;
  try {
    const { data, error } = await getAdminClient().from('provider_registry').select('id,name,kind,enabled,mode,last_checked_at').order('created_at');
    if (error) throw error;
    return json(res, 200, { providers: data || [] });
  } catch (err) { return fail(res, err); }
};
