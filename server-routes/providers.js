const { requireAdmin } = require('./_lib/auth');
const { getAdminClient } = require('./_lib/supabase');
const { json, method, body, error, fail } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const db = getAdminClient();
  try {
    if (req.method === 'GET') {
      const { data, error: dbError } = await db.from('provider_registry').select('id,name,kind,enabled,mode,api_base_url,secret_env_var,priority,service_map,last_checked_at').order('priority').order('created_at');
      if (dbError) throw dbError;
      return json(res, 200, { providers: data || [] });
    }
    const input = body(req) || {};
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
    const kind = ['manual', 'mock', 'api'].includes(input.kind) ? input.kind : 'api';
    const mode = ['manual', 'mock', 'live'].includes(input.mode) ? input.mode : 'manual';
    const secretEnvVar = typeof input.secretEnvVar === 'string' ? input.secretEnvVar.trim() : '';
    const baseUrl = typeof input.apiBaseUrl === 'string' ? input.apiBaseUrl.trim() : '';
    if (!name) return error(res, 400, 'Provider name is required.');
    if (secretEnvVar && !/^PROVIDER_[A-Z0-9_]+_API_KEY$/.test(secretEnvVar)) return error(res, 400, 'Use an environment variable name like PROVIDER_MAIN_API_KEY.');
    if (baseUrl) {
      try { if (new URL(baseUrl).protocol !== 'https:') return error(res, 400, 'Provider URL must use HTTPS.'); }
      catch { return error(res, 400, 'Provider URL is invalid.'); }
    }
    const record = { name, kind, mode, enabled: input.enabled === true, api_base_url: baseUrl || null, secret_env_var: secretEnvVar || null, priority: Number.isInteger(input.priority) ? input.priority : 100, service_map: input.serviceMap && typeof input.serviceMap === 'object' ? input.serviceMap : {} };
    let query;
    if (req.method === 'POST') query = db.from('provider_registry').insert(record).select('id,name,kind,enabled,mode,api_base_url,secret_env_var,priority,service_map').single();
    else {
      if (typeof input.id !== 'string') return error(res, 400, 'Provider id is required for updates.');
      query = db.from('provider_registry').update(record).eq('id', input.id).select('id,name,kind,enabled,mode,api_base_url,secret_env_var,priority,service_map').maybeSingle();
    }
    const { data, error: dbError } = await query;
    if (dbError) throw dbError;
    if (!data) return error(res, 404, 'Provider not found.');
    return json(res, req.method === 'POST' ? 201 : 200, { success: true, provider: data });
  } catch (err) { return fail(res, err); }
};
