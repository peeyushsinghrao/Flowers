/* ===========================================================
   Grow & Bloom — configuration
   =========================================================== */
const CONFIG = {
  SUPABASE_URL: 'https://dtsahvqpikvecgqkstnb.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_DOYROAIl-h8aQqFoANG0Rw_6kLLmFW2',
  SUPABASE_BUCKET: 'flower-sessions',

  // Recording
  RECORD_MAX_MS: 10 * 60 * 60 * 1000,   // 10 hour safety ceiling
  RECORD_CHUNK_MS: 10 * 60 * 1000,      // upload a chunk every 10 minutes
  RECORD_MIME_CANDIDATES: [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ],

  // Onboarding
  ONBOARDING_STORAGE_KEY: 'growbloom_onboarded_v1',

  // Gesture thresholds (normalized landmark distances)
  FIST_HOLD_MS: 900,
  PINCH_DIST: 0.045,
  PINCH_HOLD_MS: 120,
  CUP_HOLD_MS: 1000,
  CUP_MAX_HAND_DIST: 0.22,
};

// Lazily-created Supabase client (created in main.js once the SDK script has loaded)
let supabaseClient = null;
function getSupabaseClient(){
  if (!supabaseClient && window.supabase){
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}
