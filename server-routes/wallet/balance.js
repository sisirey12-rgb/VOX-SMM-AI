const { requireUser } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    const { data: wallet, error: walletError } = await getAdminClient().from('wallet_accounts').select('balance_cents,updated_at').eq('user_id', auth.user.id).maybeSingle();
    if (walletError) throw walletError;
    const { data: ledger, error: ledgerError } = await getAdminClient().from('wallet_ledger').select('id,entry_type,amount_cents,description,created_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(25);
    if (ledgerError) throw ledgerError;
    const balanceCents = wallet?.balance_cents || 0;
    return json(res, 200, { balanceCents, balance_inr: balanceCents / 100, updatedAt: wallet?.updated_at || null, ledger: ledger || [] });
  } catch (err) { return fail(res, err); }
};
