const { requireAdmin } = require('../../_lib/auth');
const { getAdminClient } = require('../../_lib/supabase');
const { json, method, body, error, fail } = require('../../_lib/http');
const allowed = ['pending', 'in_review', 'in_progress', 'completed', 'cancelled'];
module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const input = body(req);
  if (typeof input?.orderId !== 'string' || !allowed.includes(input?.status)) return error(res, 400, 'A valid orderId and status are required.');
  try {
    const { data, error: dbError } = await getAdminClient().rpc('admin_set_order_status', {
      p_admin_id: auth.user.id,
      p_order_id: input.orderId,
      p_status: input.status,
      p_note: typeof input.note === 'string' ? input.note.trim().slice(0, 250) : null
    });
    if (dbError) throw dbError;
    return json(res, 200, { order: data });
  } catch (err) { return fail(res, err); }
};
