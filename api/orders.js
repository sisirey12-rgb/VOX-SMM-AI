const { requireUser } = require('./_lib/auth');
const { getAdminClient } = require('./_lib/supabase');
const { json, method, body, error, fail } = require('./_lib/http');
const { randomUUID } = require('node:crypto');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  const db = getAdminClient();
  try {
    if (req.method === 'GET') {
      const { data, error: dbError } = await db.from('orders').select('id,service_id,service_name,quantity,brief,total_cents,status,created_at,updated_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(100);
      if (dbError) throw dbError;
      return json(res, 200, { orders: data || [] });
    }
    const input = body(req);
    const serviceId = typeof input?.serviceId === 'string' ? input.serviceId : '';
    const quantity = Number(input?.quantity);
    const brief = typeof input?.brief === 'string' ? input.brief.trim() : '';
    const idempotencyKey = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey : '';
    if (!serviceId || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) return error(res, 400, 'Choose a service and a valid quantity.');
    if (brief.length > 3000 || !idempotencyKey || idempotencyKey.length > 100) return error(res, 400, 'A short brief and request identifier are required.');
    const { data, error: dbError } = await db.rpc('create_order_with_debit', {
      p_user_id: auth.user.id,
      p_service_id: serviceId,
      p_quantity: quantity,
      p_brief: brief,
      p_idempotency_key: idempotencyKey
    });
    if (dbError) {
      const msg = String(dbError.message || '');
      if (msg.includes('Insufficient wallet balance')) return error(res, 409, 'Your wallet balance is too low for this request.', 'INSUFFICIENT_BALANCE');
      if (msg.includes('Service unavailable') || msg.includes('Quantity outside')) return error(res, 400, msg);
      throw dbError;
    }
    return json(res, 201, { order: data, requestId: randomUUID() });
  } catch (err) { return fail(res, err); }
};
