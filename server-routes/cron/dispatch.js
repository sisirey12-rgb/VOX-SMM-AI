const { json, method, error } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  const secret = process.env.CRON_SECRET;
  if (!secret) return error(res, 503, 'Scheduled dispatch is not configured.');
  if (req.headers.authorization !== `Bearer ${secret}`) return error(res, 401, 'Unauthorized.');
  // The original dispatch integration is private; never report successful delivery here.
  return json(res, 200, { mode: 'awaiting_provider_configuration', dispatched: 0, message: 'No authorized provider adapter is configured.' });
};
