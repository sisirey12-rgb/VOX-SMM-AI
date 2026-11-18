const { json, method } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  return json(res, 501, { error: 'Online deposits are not configured. Add a verified payment processor before accepting payments.' });
};
