/* global process */
import crypto from 'crypto';

/**
 * Generates ImageKit client-side upload authentication parameters.
 * ImageKit expects:
 * - token: unique string per upload
 * - expire: UNIX timestamp (seconds) when this token expires
 * - signature: HMAC-SHA1(token + expire, privateKey)
 */
export function getImageKitAuth(env = process.env) {
  const privateKey = env.IMAGEKIT_PRIVATE_KEY;
  const publicKey = env.IMAGEKIT_PUBLIC_KEY;
  const urlEndpoint = env.IMAGEKIT_URL_ENDPOINT;

  if (!privateKey || !publicKey || !urlEndpoint) {
    const err = new Error('IMAGEKIT credentials (IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY, IMAGEKIT_URL_ENDPOINT) are not set in environment variables.');
    err.status = 500;
    throw err;
  }

  const token = 'ik_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
  const expire = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
  const signature = crypto.createHmac('sha1', privateKey).update(token + expire).digest('hex');

  return {
    token,
    expire,
    signature,
    publicKey,
    urlEndpoint,
  };
}

export default async function handler(req, res) {
  // Netlify Functions (Standard Web Request/Response)
  if (!res || typeof res.status !== 'function') {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Use GET' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Allow': 'GET' },
      });
    }
    try {
      const auth = getImageKitAuth();
      return Response.json(auth, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      return Response.json(
        { error: err.message || 'ImageKit auth failed' },
        { status: err.status || 500 }
      );
    }
  }

  // Node.js / Vercel / Vite dev middleware
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  try {
    const auth = getImageKitAuth();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(auth);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'ImageKit auth failed' });
  }
}
