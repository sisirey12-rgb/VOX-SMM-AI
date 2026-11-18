const { json, method, fail } = require('./_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    return json(res, 200, { name: process.env.APP_NAME || 'Vox Nexus', mode: 'provider-configuration-required', version: '1.0.0' });
  } catch (err) { return fail(res, err); }
};
