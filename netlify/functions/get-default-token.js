// netlify/functions/get-default-token.js
exports.handler = async function(event) {
  try {
    const UPSTASH_REST_URL = process.env.UPSTASH_REST_URL;
    const UPSTASH_REST_TOKEN = process.env.UPSTASH_REST_TOKEN;

    // se Upstash non è configurato, ritorniamo fallback dalla env (comportamento attuale)
    if (!UPSTASH_REST_URL || !UPSTASH_REST_TOKEN) {
      const token = process.env.DEFAULT_PUBLIC_TOKEN || '';
      if (!token) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'no-default-token' })
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      };
    }

    // prova a leggere la key definita da env DEFAULT_TOKEN_KEY, fallback su 'default_public_token'
    const KEY_NAME = process.env.DEFAULT_TOKEN_KEY || 'default_public_token';
    const key = KEY_NAME;
    const res = await fetch(`${UPSTASH_REST_URL}/get/${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${UPSTASH_REST_TOKEN}` }
    });

    if (!res.ok) {
      console.warn('get-default-token: upstash GET non ok', res.status);
      // fallback su env
      const token = process.env.DEFAULT_PUBLIC_TOKEN || '';
      if (!token) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'no-default-token' })
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      };
    }

    const js = await res.json();
    if (!js || js.result == null || String(js.result).trim() === '') {
      // fallback su env — mantiene il sito funzionante
      const token = process.env.DEFAULT_PUBLIC_TOKEN || '';
      if (!token) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'no-default-token' })
        };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: String(js.result) })
    };

  } catch (err) {
    console.error('get-default-token error', err);
    // in caso di errore non vogliamo bloccare il sito: fallback su env
    const token = process.env.DEFAULT_PUBLIC_TOKEN || '';
    if (!token) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'internal' })
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    };
  }
};
