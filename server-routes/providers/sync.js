const { requireAdmin } = require('../_lib/auth');
const { json, method } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!await requireAdmin(req, res)) return;
  return json(res, 501, { error: 'Provider credentials and API protocol are not included. Configure an authorized provider adapter before syncing.' });
};
