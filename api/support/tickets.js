const { requireUser } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  const db = getAdminClient();
  try {
    if (req.method === 'GET') {
      const { data, error: dbError } = await db.from('support_tickets').select('id,subject,status,created_at,updated_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(50);
      if (dbError) throw dbError;
      return json(res, 200, { tickets: data || [] });
    }
    const input = body(req);
    const subject = typeof input?.subject === 'string' ? input.subject.trim().slice(0, 120) : '';
    const message = typeof input?.message === 'string' ? input.message.trim().slice(0, 4000) : '';
    if (!subject || !message) return error(res, 400, 'Subject and message are required.');
    const { data: ticket, error: ticketError } = await db.from('support_tickets').insert({ user_id: auth.user.id, subject }).select('id,subject,status,created_at').single();
    if (ticketError) throw ticketError;
    const { error: messageError } = await db.from('support_messages').insert({ ticket_id: ticket.id, user_id: auth.user.id, message });
    if (messageError) throw messageError;
    return json(res, 201, { ticket });
  } catch (err) { return fail(res, err); }
};
