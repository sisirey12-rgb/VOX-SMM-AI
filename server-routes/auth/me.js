const { requireUser } = require('../_lib/auth');
const { json, method } = require('../_lib/http');
module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  const auth = await requireUser(req, res);
  if (!auth) return;
  return json(res, 200, {
    profile: auth.profile,
    user: { id: auth.user.id, email: auth.user.email || auth.profile.email, name: auth.profile.full_name, role: auth.profile.role },
    isAdmin: auth.profile.role === 'admin'
  });
};
