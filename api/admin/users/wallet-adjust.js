const { requireAdmin } = require('../../_lib/auth');
const { getAdminClient } = require('../../_lib/supabase');
const { json, method, body, error, fail } = require('../../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const input = body(req);
  const userId = typeof input?.userId === 'string' ? input.userId : '';
  const amountCents = Number(input?.amountCents);
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 250) : '';
  const idempotencyKey = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey : '';
  if (!userId || !Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 100000000 || !reason || !idempotencyKey) return error(res, 400, 'userId, a non-zero amountCents, reason, and idempotencyKey are required.');
  try {
    const { data, error: dbError } = await getAdminClient().rpc('adjust_wallet_balance', {
      p_admin_id: auth.user.id,
      p_user_id: userId,
      p_amount_cents: amountCents,
      p_reason: reason,
      p_idempotency_key: idempotencyKey
    });
    if (dbError) {
      if (String(dbError.message).includes('Wallet cannot be negative')) return error(res, 409, 'The adjustment would make the wallet balance negative.');
      throw dbError;
    }
    return json(res, 200, { adjustment: data });
  } catch (err) { return fail(res, err); }
};
