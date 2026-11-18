const { randomUUID } = require('node:crypto');
const { requireUser } = require('./_lib/auth');
const { getAdminClient } = require('./_lib/supabase');
const { json, method, body, error, fail } = require('./_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  const db = getAdminClient();
  const query = req.query || {};

  if (req.method === 'GET') {
    try {
      if (query.action === 'latency') return json(res, 200, { calibratedPreWarmLeadMin: 0, source: 'default' });
      if (query.id) {
        let request = db.from('missions').select('*').eq('id', String(query.id));
        if (query.view_all === 'true') {
          if (auth.profile.role !== 'admin') return error(res, 403, 'Administrator privileges required.');
        } else request = request.eq('user_id', auth.user.id);
        const { data, error: dbError } = await request.maybeSingle();
        if (dbError) throw dbError;
        if (!data) return error(res, 404, 'Mission not found.');
        return json(res, 200, { mission: data });
      }
      let request = db.from('missions').select('id,user_id,status,campaign,cost_inr,created_at,updated_at,last_error').order('created_at', { ascending: false }).limit(100);
      if (query.view_all === 'true') {
        if (auth.profile.role !== 'admin') return error(res, 403, 'Administrator privileges required.');
      } else request = request.eq('user_id', auth.user.id);
      const { data, error: dbError } = await request;
      if (dbError) throw dbError;
      return json(res, 200, { missions: data || [], invalidCount: 0 });
    } catch (err) { return fail(res, err); }
  }

  if (req.method === 'POST') {
    const input = body(req);
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 128000) return error(res, 400, 'A valid campaign payload is required.');
    if (input.userId && input.userId !== auth.user.id) return error(res, 403, 'Campaign owner does not match the signed-in account.');
    const missionId = randomUUID();
    const campaign = input.campaign && typeof input.campaign === 'object'
      ? input.campaign
      : input;
    try {
      const { data, error: dbError } = await db.from('missions').insert({ id: missionId, user_id: auth.user.id, campaign, status: 'awaiting_provider', cost_inr: Math.max(0, Number(input.estimatedCostInr || input.estimatedCost) || 0) }).select('*').single();
      if (dbError) throw dbError;
      return json(res, 201, { success: true, missionId: data.id, mission: data, wallet_balance_inr: null, dispatch: 'awaiting_provider_configuration' });
    } catch (err) { return fail(res, err); }
  }

  const input = body(req) || {};
  const id = typeof input.missionId === 'string' ? input.missionId : typeof query.id === 'string' ? query.id : '';
  if (!id) return error(res, 400, 'Mission id is required.');
  const isAdmin = auth.profile.role === 'admin';
  try {
    if (req.method === 'DELETE') {
      let request = db.from('missions').delete().eq('id', id);
      if (!isAdmin) request = request.eq('user_id', auth.user.id);
      const { error: dbError } = await request;
      if (dbError) throw dbError;
      return json(res, 200, { success: true, missionId: id });
    }
    const action = typeof input.action === 'string' ? input.action : '';
    const status = action === 'pause' ? 'paused' : action === 'resume' ? 'scheduled' : action === 'cancel' ? 'cancelled' : '';
    if (!status) return error(res, 400, 'Supported actions are pause, resume, and cancel.');
    let request = db.from('missions').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (!isAdmin) request = request.eq('user_id', auth.user.id);
    const { data, error: dbError } = await request.select('id,status').maybeSingle();
    if (dbError) throw dbError;
    if (!data) return error(res, 404, 'Mission not found.');
    return json(res, 200, { success: true, missionId: data.id, status: data.status });
  } catch (err) { return fail(res, err); }
};
