const { requireAdmin } = require('../_lib/auth');
const { json, method } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!await requireAdmin(req, res)) return;
  return json(res, 200, { paymentsEnabled: false, processor: null, note: 'Payment processing is not configured.' });
};
