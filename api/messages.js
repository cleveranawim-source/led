/* Vercel Serverless Function: 메시지 조회/추가/삭제
 *
 * GET    /api/messages                  → { messages: [...] }
 * POST   /api/messages  body: {name, message, image?}  → { ok, message }
 * DELETE /api/messages?id=xxx&key=ADMIN → { ok }
 */

import { kv } from '@vercel/kv';

const KEY = 'messages';           // KV 리스트 키
const MAX_MESSAGES = 500;         // 보관할 최대 개수

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function badReq(res, msg) {
  return res.status(400).json({ error: msg });
}

function clean(s, max = 500) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      // 최신순. lrange 0..N-1 = 앞에서부터 N개 (unshift 로 넣었으니 최신이 앞)
      const raw = await kv.lrange(KEY, 0, MAX_MESSAGES - 1);
      const messages = (raw || []).map(parseItem).filter(Boolean);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).json({ messages });
    }

    if (req.method === 'POST') {
      const body = req.body || (await readJson(req));
      const name = clean(body.name, 40) || '익명';
      const message = clean(body.message, 500);
      const image = clean(body.image, 2000);
      if (!message) return badReq(res, '메시지를 입력해주세요');

      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      const entry = { id, name, message, image: image || '', ts: Date.now() };

      await kv.lpush(KEY, JSON.stringify(entry));
      await kv.ltrim(KEY, 0, MAX_MESSAGES - 1);

      return res.status(200).json({ ok: true, message: entry });
    }

    if (req.method === 'DELETE') {
      const { id, key } = req.query || {};
      const adminKey = process.env.ADMIN_KEY || '';
      if (!adminKey) return res.status(500).json({ error: '서버에 ADMIN_KEY 설정 필요' });
      if (key !== adminKey) return res.status(401).json({ error: '잘못된 관리자 키' });
      if (!id) return badReq(res, 'id 필요');

      // 전부 가져와서 필터 후 리셋 (KV 리스트에는 remove-by-id 가 없음)
      const raw = await kv.lrange(KEY, 0, -1);
      const remaining = (raw || [])
        .map(parseItem)
        .filter(m => m && m.id !== id)
        .map(m => JSON.stringify(m));

      // atomic 재구성
      await kv.del(KEY);
      if (remaining.length) await kv.rpush(KEY, ...remaining);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[api/messages]', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

function parseItem(x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return null; }
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
