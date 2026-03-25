/**
 * /api/upload.js — Vercel Serverless Function
 * ─────────────────────────────────────────────
 * Compatible with Vercel framework preset: "Other" (static site)
 * Uses CommonJS (module.exports) — NOT ES module export syntax.
 *
 * Required env variable (set in Vercel dashboard → Settings → Environment Variables):
 *   IMGBB_API_KEY = your_imgbb_key_here
 */

// ─── Body size limit (Vercel serverless config) ───────────────────────────────
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

// ─── Retry helper ─────────────────────────────────────────────────────────────
async function uploadToImgBB(base64, attempt) {
  attempt = attempt || 1;
  var MAX_ATTEMPTS = 3;

  var params = new URLSearchParams();
  params.append('key', process.env.IMGBB_API_KEY);
  params.append('image', base64);

  console.log('[upload] Sending to ImgBB, attempt', attempt);

  var res = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  console.log('[upload] ImgBB HTTP status:', res.status);

  if (!res.ok) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(function(r) { setTimeout(r, 800); });
      return uploadToImgBB(base64, attempt + 1);
    }
    throw new Error('ImgBB HTTP error: ' + res.status);
  }

  var json = await res.json();
  console.log('[upload] ImgBB success:', json.success);

  if (!json.success || !json.data || !json.data.url) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(function(r) { setTimeout(r, 800); });
      return uploadToImgBB(base64, attempt + 1);
    }
    throw new Error('ImgBB returned success=false');
  }

  return {
    url: json.data.url,
    thumb: (json.data.thumb && json.data.thumb.url) ? json.data.thumb.url : null,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // ── CORS headers (needed if you ever call from a different origin) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ── Preflight ──
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── GET: health-check so you can confirm the route is alive ──
  if (req.method === 'GET') {
    console.log('[upload] GET health-check hit');
    return res.status(200).json({
      message: 'API is working',
      hint: 'Send a POST request with { image: "data:image/jpeg;base64,..." }',
    });
  }

  // ── Only POST beyond this point ──
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('[upload] POST received');

  // ── Validate API key ──
  if (!process.env.IMGBB_API_KEY) {
    console.error('[upload] IMGBB_API_KEY is not set!');
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  // ── Parse body ──
  var body = req.body;
  if (!body || !body.image || typeof body.image !== 'string') {
    console.error('[upload] No image in request body');
    return res.status(400).json({ error: 'No image received' });
  }

  // ── Strip data-URL header ──
  var base64 = body.image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
  base64 = base64.replace(/ /g, '+'); // fix any space encoding

  // ── Validate base64 characters ──
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    console.error('[upload] Invalid base64 data');
    return res.status(400).json({ error: 'Invalid image data' });
  }

  // ── Size guard (~10 MB) ──
  var approxBytes = base64.length * 0.75;
  if (approxBytes > 10 * 1024 * 1024) {
    console.error('[upload] Image too large:', Math.round(approxBytes / 1024 / 1024), 'MB');
    return res.status(400).json({ error: 'Image too large (max ~10 MB)' });
  }

  console.log('[upload] Image size ~', Math.round(approxBytes / 1024), 'KB');

  // ── Upload to ImgBB ──
  try {
    var result = await uploadToImgBB(base64);
    console.log('[upload] Success! URL:', result.url);

    return res.status(200).json({
      success: true,
      url: result.url,
      thumb: result.thumb,
    });
  } catch (err) {
    console.error('[upload] Upload failed:', err.message);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
};
