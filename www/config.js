// ─────────────────────────────────────────────────────────────
//  Horse Cargo — connection settings
//  Supabase → Project Settings → API → copy "Project URL" and
//  the "anon public" key. The anon key is safe to ship in the
//  app: every table is protected by Row Level Security.
// ─────────────────────────────────────────────────────────────
window.HC_CONFIG = {
  SUPABASE_URL: 'https://kaigvimoufrdfhjsaska.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_pASg3SGGWxGxrzJVb9m_zQ_rOM1gEJR',
  // Public tracking page link printed on documents / shared on WhatsApp
  PUBLIC_TRACK_URL: 'https://app.horsecargoltd.com/track.html',
  // Storage bucket for GRN photos (see supabase/storage.sql). Leave '' to disable photos.
  PHOTO_BUCKET: 'cargo-photos',
};
