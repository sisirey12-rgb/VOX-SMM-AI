const { requireUser } = require('../_lib/auth');
const { getAdminClient } = require('../_lib/supabase');
const { json, method, body, error, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  const db = getAdminClient();
  try {
    if (req.method === 'GET') {
      const ticketId = typeof req.query?.ticket_id === 'string' ? req.query.ticket_id : '';
      if (ticketId) {
        let query = db.from('support_tickets').select('id,user_id,subject,status,created_at,updated_at').eq('id', ticketId);
        if (auth.profile.role !== 'admin') query = query.eq('user_id', auth.user.id);
        const { data: ticket, error: ticketError } = await query.maybeSingle();
        if (ticketError) throw ticketError;
        if (!ticket) return error(res, 404, 'Support ticket not found.');
        const { data: messages, error: messageError } = await db.from('support_messages').select('id,user_id,message,staff_message,created_at').eq('ticket_id', ticketId).order('created_at');
        if (messageError) throw messageError;
        return json(res, 200, { ticket, messages: messages || [] });
      }
      const { data: tickets, error: ticketError } = await db.from('support_tickets').select('id,subject,status,created_at,updated_at').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(50);
      if (ticketError) throw ticketError;
      return json(res, 200, { tickets: tickets || [], ticket: tickets?.[0] || null, messages: [] });
    }
    if (req.method === 'PATCH') {
      const input = body(req) || {};
      if (input.action === 'mark_read') return json(res, 200, { success: true });
      if (input.action !== 'resolve' || typeof input.ticket_id !== 'string') return error(res, 400, 'A ticket_id and supported action are required.');
      let query = db.from('support_tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', input.ticket_id);
      if (auth.profile.role !== 'admin') query = query.eq('user_id', auth.user.id);
      const { data: ticket, error: updateError } = await query.select('id,status').maybeSingle();
      if (updateError) throw updateError;
      if (!ticket) return error(res, 404, 'Support ticket not found.');
      return json(res, 200, { success: true, ticket });
    }
    const input = body(req) || {};
    const subject = typeof input.subject === 'string' ? input.subject.trim().slice(0, 120) : '';
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 4000) : '';
    const ticketId = typeof input.ticket_id === 'string' ? input.ticket_id : '';
    if (!message) return error(res, 400, 'Message is required.');
    let ticket;
    if (ticketId) {
      const { data, error: ticketError } = await db.from('support_tickets').select('id,subject,status,created_at').eq('id', ticketId).eq('user_id', auth.user.id).maybeSingle();
      if (ticketError) throw ticketError;
      if (!data) return error(res, 404, 'Support ticket not found.');
      ticket = data;
    } else {
      const { data, error: ticketError } = await db.from('support_tickets').insert({ user_id: auth.user.id, subject: subject || 'Support conversation' }).select('id,subject,status,created_at').single();
      if (ticketError) throw ticketError;
      ticket = data;
    }
    const { error: messageError } = await db.from('support_messages').insert({ ticket_id: ticket.id, user_id: auth.user.id, message });
    if (messageError) throw messageError;
    return json(res, 201, { success: true, ticket });
  } catch (err) { return fail(res, err); }
};
