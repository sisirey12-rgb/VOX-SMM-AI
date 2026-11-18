const { getEnv } = require('../_lib/supabase');
const { json, method, fail } = require('../_lib/http');

module.exports = async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  try {
    return json(res, 200, {
      supabaseUrl: getEnv('SUPABASE_URL'),
      supabaseAnonKey: getEnv('SUPABASE_ANON_KEY')
    });
  } catch (err) { return fail(res, err); }
};
