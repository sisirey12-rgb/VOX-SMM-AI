const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!await requireAdmin(req, res)) return;
  try {
    const { data, error } = await getAdminClient().from('wallet_ledger').select('entry_type,amount_cents,created_at').order('created_at', { ascending: false }).limit(5000);
    if (error) throw error;
    const entries = data || [];
    const totalDepositsInr = entries.filter(x => x.entry_type === 'admin_adjustment' && x.amount_cents > 0).reduce((sum, x) => sum + x.amount_cents, 0) / 100;
    const totalDebitsInr = entries.filter(x => x.amount_cents < 0).reduce((sum, x) => sum + Math.abs(x.amount_cents), 0) / 100;
    return json(res, 200, { kpis: { totalDepositsInr, totalDebitsInr, ledgerEntries: entries.length }, source: 'database' });
  } catch (err) { return fail(res, err); }
};
