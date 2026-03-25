/**
 * /api/upload.js — Vercel Serverless Function
 * Receives a base64 image from the photobooth frontend,
 * uploads it to ImgBB, and returns the public image URL.
 *
 * Environment variable required (set in Vercel dashboard):
 *   IMGBB_API_KEY = your_key_here
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb', // cap incoming payload (~10 MB image + overhead)
    },
  },
};

// ─── Retry helper ────────────────────────────────────────────────────────────
async function uploadToImgBB(base64, attempt = 1) {
  const MAX_ATTEMPTS = 3;

  const body = new URLSearchParams();
  body.append('key', process.env.IMGBB_API_KEY);
  body.append('image', base64);

  const res = await fetch('https://api.imgbb.com/1/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    if (attempt < MAX_ATTEMPTS) {
      // Wait 800 ms before retrying
      await new Promise(r => setTimeout(r, 800));
      return uploadToImgBB(base64, attempt + 1);
    }
    throw new Error(`ImgBB responded with HTTP ${res.status}`);
  }

  const json = await res.json();

  if (!json.success || !json.data?.url) {
    if (attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 800));
      return uploadToImgBB(base64, attempt + 1);
    }
    throw new Error('ImgBB returned success=false');
  }

  return {
    url: json.data.url,
    thumb: json.data.thumb?.url ?? null, // bonus thumbnail
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate API key is configured
  if (!process.env.IMGBB_API_KEY) {
    console.error('IMGBB_API_KEY is not set in environment variables.');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Parse body
  const { image } = req.body ?? {};

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'No image received' });
  }

  // Strip the data-URL prefix (handles jpeg, png, webp)
  const base64 = image.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

  // Basic sanity check — valid base64 chars only
  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return res.status(400).json({ error: 'Invalid image data' });
  }

  // Rough size guard: base64 chars × 0.75 ≈ bytes
  const approxBytes = base64.length * 0.75;
  if (approxBytes > 10 * 1024 * 1024) {
    return res.status(400).json({ error: 'Image too large (max ~10 MB)' });
  }

  try {
    const result = await uploadToImgBB(base64);

    return res.status(200).json({
      success: true,
      url: result.url,
      thumb: result.thumb, // may be null; frontend ignores it gracefully
    });
  } catch (err) {
    console.error('ImgBB upload failed:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
