const { requireAdmin } = require('../_lib/auth');
const { json, method } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!await requireAdmin(req, res)) return;
  return json(res, 501, { error: 'External provider synchronization is disabled in this deployment. Configure an authorized, platform-compliant integration before enabling it.' });
};
