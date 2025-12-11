// netlify/functions/verify-token.js  (CommonJS)
const crypto = require('crypto');

exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: "method not allowed" };

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch(e){ body = {}; }

    const token = body.t || body.token;
    const turnstileResp = body['cf-turnstile-response'] || body.turnstile_response;
    if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'missing token' }) };
    if (!turnstileResp) return { statusCode: 400, body: JSON.stringify({ error: 'missing turnstile response' }) };

    // verify Turnstile
    const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    const params = new URLSearchParams();
    params.append('secret', process.env.TURNSTILE_SECRET || '');
    params.append('response', turnstileResp);
    const remoteip = event.headers && (event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'])?.split(',')[0]?.trim() || (event.headers && event.headers['cf-connecting-ip']);
    if (remoteip) params.append('remoteip', remoteip);

    const vRes = await fetch(verifyUrl, { method:'POST', body: params });
    const vJson = await vRes.json();
    if (!vJson.success) {
      return { statusCode: 401, body: JSON.stringify({ ok:false, detail: 'turnstile failed', verify: vJson }) };
    }

    const UPSTASH_REST_URL = process.env.UPSTASH_REST_URL;
    const UPSTASH_REST_TOKEN = process.env.UPSTASH_REST_TOKEN;
    if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) return { statusCode: 500, body: JSON.stringify({ error: 'upstash not configured' }) };

    const key = `token:${token}`;
    const getRes = await fetch(`${UPSTASH_REST_URL}/get/${encodeURIComponent(key)}`, {
      headers: { 'Authorization': `Bearer ${UPSTASH_REST_TOKEN}` }
    });
    const gotJson = await getRes.json();
    if (!gotJson || gotJson.result == null) {
      return { statusCode: 404, body: JSON.stringify({ ok:false, error: 'token not found or expired' }) };
    }

    let meta;
    try { meta = JSON.parse(gotJson.result); } catch(e) { meta = { redirectUrl: String(gotJson.result), createdAt: Date.now(), ttlSeconds: parseInt(process.env.DEFAULT_TTL_SECONDS||'300',10), uses:0 }; }

    // rate-limit per IP (basic)
    const RATE_LIMIT_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN || '60', 10);
    if (remoteip) {
      const minuteKey = `rl:ip:${remoteip}:${Math.floor(Date.now()/60000)}`;
      const g = await (await fetch(`${UPSTASH_REST_URL}/get/${encodeURIComponent(minuteKey)}`, { headers:{ 'Authorization':`Bearer ${UPSTASH_REST_TOKEN}` } })).json();
      let cnt = 0;
      try { cnt = g.result ? parseInt(g.result,10) : 0; } catch(e){ cnt = 0; }
      if (cnt >= RATE_LIMIT_PER_MIN) return { statusCode: 429, body: JSON.stringify({ ok:false, error:'rate limit ip' }) };
      const newCnt = cnt + 1;
      await fetch(`${UPSTASH_REST_URL}/set/${encodeURIComponent(minuteKey)}?EX=60`, {
        method:'POST', headers:{ 'Authorization':`Bearer ${UPSTASH_REST_TOKEN}`, 'Content-Type':'text/plain'}, body: String(newCnt)
      });
    }

    // fingerprint binding (optional)
    const FP_SECRET = process.env.FINGERPRINT_SECRET || null;
    if (FP_SECRET) {
      const ua = event.headers['user-agent'] || '';
      const al = event.headers['accept-language'] || '';
      const ipPart = (remoteip||'').split('.').slice(0,3).join('.');
      const raw = `${ua}|${al}|${ipPart}`;
      const fp = crypto.createHmac('sha256', FP_SECRET).update(raw).digest('hex');

      if (!meta.bindFingerprint) {
        meta.bindFingerprint = fp;
      } else if (meta.bindFingerprint !== fp) {
        return { statusCode: 403, body: JSON.stringify({ ok:false, error:'fingerprint mismatch' }) };
      }
    }

    // maxUses
    if (meta.maxUses && (meta.uses || 0) >= meta.maxUses) {
      return { statusCode: 403, body: JSON.stringify({ ok:false, error:'token max uses reached' }) };
    }

    // increment uses, recalc remaining TTL, save back
    meta.uses = (meta.uses || 0) + 1;
    meta.lastUsedAt = Date.now();

    const expiresAt = (meta.createdAt || Date.now()) + ((meta.ttlSeconds || parseInt(process.env.DEFAULT_TTL_SECONDS||'300',10)) * 1000);
    const remainingSec = Math.max(1, Math.floor((expiresAt - Date.now())/1000));

    await fetch(`${UPSTASH_REST_URL}/set/${encodeURIComponent(key)}?EX=${remainingSec}`, {
      method:'POST', headers:{ 'Authorization':`Bearer ${UPSTASH_REST_TOKEN}`, 'Content-Type':'text/plain'}, body: JSON.stringify(meta)
    });

    return { statusCode: 200, headers:{ 'content-type':'application/json'}, body: JSON.stringify({ ok:true, url: meta.redirectUrl }) };

  } catch(err) {
    console.error("verify-token error:", err);
    return { statusCode: 500, body: JSON.stringify({ ok:false, error: 'internal error' }) };
  }
};
