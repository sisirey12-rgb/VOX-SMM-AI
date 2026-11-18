const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!await requireAdmin(req, res)) return;
  try {
    const db = getAdminClient();
    const { data, error } = await db.from('profiles').select('id,email,full_name,role,created_at,wallet_accounts(balance_cents)').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    const users = (data || []).map(({ wallet_accounts, ...profile }) => ({ ...profile, balanceCents: wallet_accounts?.[0]?.balance_cents || 0 }));
    return json(res, 200, { users });
  } catch (err) { return fail(res, err); }
};
