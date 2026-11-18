const { requireAdmin } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');
function validate(input) {
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0,120) : '';
  const description = typeof input?.description === 'string' ? input.description.trim().slice(0,1000) : '';
  const category = typeof input?.category === 'string' ? input.category.trim().slice(0,80) : 'Marketing';
  const rate = Number(input?.ratePer1kCents);
  const min = Number(input?.minQuantity);
  const max = Number(input?.maxQuantity);
  if (!name || !Number.isSafeInteger(rate) || rate < 0 || !Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 1000000) return null;
  return { name, description, category, rate_per_1k_cents: rate, min_quantity: min, max_quantity: max, active: input.active !== false };
}
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET','POST','PATCH'])) return;
  if (!await requireAdmin(req, res)) return;
  const db = getAdminClient();
  try {
    if (req.method === 'GET') {
      const { data, error } = await db.from('services').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return json(res, 200, { services: data || [] });
    }
    const input = body(req);
    const values = validate(input);
    if (!values) return error(res, 400, 'Provide a name, non-negative rate, and valid quantity limits.');
    if (req.method === 'POST') {
      const { data, error } = await db.from('services').insert(values).select('*').single();
      if (error) throw error;
      return json(res, 201, { service: data });
    }
    if (typeof input.serviceId !== 'string') return error(res, 400, 'serviceId is required.');
    const { data, error } = await db.from('services').update({ ...values, updated_at: new Date().toISOString() }).eq('id', input.serviceId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return error(res, 404, 'Service not found.');
    return json(res, 200, { service: data });
  } catch (err) { return fail(res, err); }
};
