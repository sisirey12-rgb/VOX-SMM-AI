function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(status).json(payload);
}

function method(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    json(res, 405, { error: 'Method not allowed.' });
    return false;
  }
  return true;
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function error(res, status, message, code) {
  const result = { error: message };
  if (code) result.code = code;
  return json(res, status, result);
}

function fail(res, err) {
  const message = String(err?.message || 'Request failed.');
  console.error('api_error', { message, code: err?.code || null });
  return error(res, 500, 'The request could not be completed.');
}

module.exports = { json, method, body, error, fail };
