// Tiny HTTPS relay: Lovable Worker -> this relay -> Fixie proxy -> Monnify.
// Monnify only sees Fixie's 2 static IPs (whitelist them in Monnify dashboard).

const http = require('http');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.RELAY_SHARED_SECRET;
const FIXIE_URL = process.env.FIXIE_URL; // auto-set by Fixie addon
const MONNIFY_BASE = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';

if (!SHARED_SECRET) {
  console.error('FATAL: RELAY_SHARED_SECRET env var is required');
  process.exit(1);
}
if (!FIXIE_URL) {
  console.error('FATAL: FIXIE_URL env var is required (add Fixie addon)');
  process.exit(1);
}

const agent = new HttpsProxyAgent(FIXIE_URL);

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function proxyRequest(targetUrl, init = {}) {
  const url = new URL(targetUrl);
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: init.method || 'GET',
      headers: init.headers,
      agent,
    }, (upstream) => {
      const chunks = [];
      upstream.on('data', (chunk) => chunks.push(chunk));
      upstream.on('end', () => {
        resolve({
          status: upstream.statusCode || 502,
          headers: upstream.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);

    if (init.body) {
      req.write(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
    }

    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method !== 'POST' || req.url !== '/forward') {
      res.writeHead(404);
      return res.end('Not found');
    }

    if (req.headers['x-relay-secret'] !== SHARED_SECRET) {
      res.writeHead(401);
      return res.end('Unauthorized');
    }

    const bodyText = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      res.writeHead(400);
      return res.end('Bad JSON');
    }

    const { method, path, headers = {}, body, baseUrl } = payload;
    if (typeof path !== 'string' || !path.startsWith('/')) {
      res.writeHead(400);
      return res.end('Invalid path');
    }

    const relayBase = typeof baseUrl === 'string' && /^https?:\/\//.test(baseUrl)
      ? baseUrl.replace(/\/$/, '')
      : MONNIFY_BASE;
    const targetUrl = `${relayBase}${path}`;
    console.log(`-> ${method} ${targetUrl}`);

    // Safe debug: never logs the secret itself
    const authHeader = headers['Authorization'] || headers['authorization'];
    if (authHeader) {
      if (authHeader.startsWith('Basic ')) {
        try {
          const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
          const [user, pass] = decoded.split(':');
          console.log(`   auth: Basic, apiKeyPrefix=${(user || '').slice(0, 10)}..., apiKeyLen=${(user || '').length}, secretLen=${(pass || '').length}`);
        } catch {
          console.log('   auth: Basic (failed to decode)');
        }
      } else {
        console.log(`   auth: ${authHeader.slice(0, 12)}... len=${authHeader.length}`);
      }
    } else {
      console.log('   auth: <none>');
    }

    const upstream = await proxyRequest(targetUrl, {
      method: method || 'GET',
      headers,
      body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });

    res.writeHead(upstream.status, {
      'content-type': upstream.headers['content-type'] || 'application/json',
    });
    res.end(upstream.body);
  } catch (e) {
    console.error('Relay error:', e);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e?.message || 'Relay failure' }));
  }
});

server.listen(PORT, () => console.log(`Monnify relay listening on :${PORT}`));
