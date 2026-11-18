const { requireUser } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  if (!id) return error(res, 400, 'Order id is required.');
  try {
    const { data, error: dbError } = await getAdminClient().from('orders').select('id,service_id,service_name,quantity,brief,total_cents,status,created_at,updated_at').eq('id', id).eq('user_id', auth.user.id).maybeSingle();
    if (dbError) throw dbError;
    if (!data) return error(res, 404, 'Order not found.');
    return json(res, 200, { order: data });
  } catch (err) { return fail(res, err); }
};
