const { getAdminClient } = require('./_lib/supabase');
const { json, method } = require('./_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const { error } = await getAdminClient().from('services').select('id').limit(1);
    if (error) throw error;
    return json(res, 200, { ok: true, database: 'connected', mode: 'manual-fulfillment' });
  } catch {
    return json(res, 503, { ok: false, database: 'unavailable' });
  }
};
