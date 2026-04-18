/* Vercel Serverless Function: 이미지 업로드 (Vercel Blob)
 *
 * POST /api/upload   body: binary (이미지 파일)
 *   → { url: 'https://...' }
 *
 * 프론트에서: fetch('/api/upload', { method: 'POST', body: file })
 */

import { put } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: false,
  },
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: '이미지 파일만 가능합니다' });
    }

    // 크기 제한 (10MB) — 바이트 읽으면서 체크
    const chunks = [];
    let total = 0;
    const MAX = 10 * 1024 * 1024;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > MAX) return res.status(413).json({ error: '파일이 너무 큽니다 (10MB 이하)' });
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (!body.length) return res.status(400).json({ error: '빈 파일' });

    const ext = contentType.split('/')[1]?.split(';')[0] || 'bin';
    const filename = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { url } = await put(filename, body, {
      access: 'public',
      contentType,
    });

    return res.status(200).json({ url });
  } catch (err) {
    console.error('[api/upload]', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
