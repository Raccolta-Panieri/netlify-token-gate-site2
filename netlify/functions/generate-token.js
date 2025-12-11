// netlify/functions/generate-token.js  (CommonJS)
const crypto = require('crypto');

exports.handler = async function(event) {
  try {
    const ADMIN_KEY = process.env.ADMIN_KEY;
    const UPSTASH_REST_URL = process.env.UPSTASH_REST_URL;
    const UPSTASH_REST_TOKEN = process.env.UPSTASH_REST_TOKEN;

    if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'server misconfigured: missing UPSTASH env' })
      };
    }

    const provided = (event.headers && (event.headers['x-admin-key'] || event.headers['X-Admin-Key'])) ||
                     (event.queryStringParameters && event.queryStringParameters.admin_key);
    if (!provided || provided !== ADMIN_KEY) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: "unauthorized" })
      };
    }

    const isPost = event.httpMethod === "POST";
    let body = {};
    if (isPost) {
      try { body = JSON.parse(event.body || '{}'); } catch(e){ body = {}; }
    } else {
      body = event.queryStringParameters || {};
    }

    const redirectUrl = body.url || body.redirect;
    if (!redirectUrl) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: "missing url" })
      };
    }

    const ttl = parseInt(body.ttl || process.env.DEFAULT_TTL_SECONDS || "300", 10);
    const maxUses = body.max_uses ? parseInt(body.max_uses, 10) : (body.maxUses ? parseInt(body.maxUses,10) : null);

    const token = crypto.randomBytes(18).toString("hex");
    const key = `token:${token}`;

    const meta = {
      redirectUrl,
      createdAt: Date.now(),
      ttlSeconds: ttl,
      uses: 0,
      maxUses: Number.isFinite(maxUses) ? maxUses : null
    };

    const upstashUrl = `${UPSTASH_REST_URL}/set/${encodeURIComponent(key)}?EX=${ttl}`;
    const res = await fetch(upstashUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${UPSTASH_REST_TOKEN}`,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify(meta)
    });

    if (!res.ok) {
      const t = await res.text();
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'upstash set failed', detail: t })
      };
    }

    // ---------- supporto set_default con KEY_NAME da env ----------
    try {
      const shouldSetDefault = Boolean(
        (body && (body.set_default || body.setDefault)) ||
        (event.queryStringParameters && event.queryStringParameters.set_default === '1')
      );

      if (shouldSetDefault) {
        const KEY_NAME = process.env.DEFAULT_TOKEN_KEY || 'default_public_token';
        const defaultSetRes = await fetch(`${UPSTASH_REST_URL}/set/${encodeURIComponent(KEY_NAME)}?EX=${ttl}`, {
          method: 'POST',
          headers: {
            "Authorization": `Bearer ${UPSTASH_REST_TOKEN}`,
            "Content-Type": "text/plain"
          },
          body: token
        });

        if (!defaultSetRes.ok) {
          const txt = await defaultSetRes.text().catch(()=>'<no body>');
          console.warn('generate-token: set default token failed', defaultSetRes.status, txt);
        }
      }
    } catch (e) {
      console.warn('generate-token: exception while setting default token', e);
      // non falliamo l'intera richiesta: il token principale è già stato creato
    }
    // -----------------------------------------------------------------

    return {
      statusCode: 200,
      headers: { 'content-type':'application/json' },
      body: JSON.stringify({ token, expires_in: ttl })
    };
  } catch (err) {
    console.error("generate-token error:", err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'internal error' })
    };
  }
};
