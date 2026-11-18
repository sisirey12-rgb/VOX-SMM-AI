const { getEnv } = require('../_lib/supabase');
const { json, method, error } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const secret = process.env.CRON_SECRET;
  if (!secret) return error(res, 503, 'Scheduled dispatch is not configured.');
  if (req.headers.authorization !== `Bearer ${secret}`) return error(res, 401, 'Unauthorized.');
  // Deliberate no-op: this clean-room deployment only queues work for manual fulfillment.
  return json(res, 200, { mode: 'manual-review', dispatched: 0, message: 'No external provider is configured.' });
};
