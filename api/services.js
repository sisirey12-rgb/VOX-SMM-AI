const { getAdminClient } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    const { data, error } = await getAdminClient().from('services').select('id,name,description,category,rate_per_1k_cents,min_quantity,max_quantity').eq('active', true).order('category').order('name');
    if (error) throw error;
    return json(res, 200, { services: data || [] });
  } catch (err) { return fail(res, err); }
};
