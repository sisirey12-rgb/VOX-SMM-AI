const { json, method } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  return json(res, 200, { depositsEnabled: false, minimumDepositCents: 0, currency: 'USD', mode: 'manual-wallet' });
};
