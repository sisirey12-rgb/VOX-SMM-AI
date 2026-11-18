const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!await requireAdmin(req, res)) return;
  try {
    const { data, error } = await getAdminClient().from('orders').select('id,user_id,service_name,quantity,total_cents,status,created_at,updated_at').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return json(res, 200, { orders: data || [] });
  } catch (err) { return fail(res, err); }
};
