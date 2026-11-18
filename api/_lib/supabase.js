const { createClient } = require('@supabase/supabase-js');

let adminClient;
let publicClient;

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
  }
  return adminClient;
}

function getPublicClient() {
  if (!publicClient) {
    publicClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
  }
  return publicClient;
}

module.exports = { getEnv, getAdminClient, getPublicClient };
