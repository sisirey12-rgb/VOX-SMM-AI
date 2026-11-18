const { json, method } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  return json(res, 200, { maintenance: false, message: null });
};
