'use strict';

const SUPABASE_URL = 'https://sisoekcscazcxrsryfqn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x72DWSb73-zA4owIF_AqDQ_EE55ayZs';

if (window.supabase && typeof window.supabase.createClient === 'function') {
  const createClient = (persistSession, autoRefreshToken, detectSessionInUrl) =>
    window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken,
        detectSessionInUrl,
        flowType: 'pkce',
        persistSession,
      },
    });

  window.supabaseLoginClient = createClient(false, false, false);
  window.supabaseRecoveryClient = createClient(true, true, true);
} else {
  window.supabaseLoginClient = null;
  window.supabaseRecoveryClient = null;
}
