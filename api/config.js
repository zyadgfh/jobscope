const DEFAULT_URL = 'https://mtziqpyvgebthoynalbq.supabase.co';

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  res.setHeader('cache-control', 'no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || DEFAULT_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    ownerEmail: (process.env.OWNER_EMAIL || 'zyadgamal796@gmail.com').toLowerCase()
  });
};
