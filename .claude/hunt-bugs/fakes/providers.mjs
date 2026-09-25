// The fake Groq + Gemini, on one port. Both SDKs reach it for real — the provider table's
// base_url is the only thing the shim rewrites — so every request the services build, and every
// error they parse, is the real SDK's. POST /control switches a provider into a failure mode — for
// every call, one lecture's, or the next N — so quota and outage flows need no real quota.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

// The harness's own copy, not the repo's: everything a run reads or writes lives under one root.
const FIXTURES = path.join(process.env.HUNT_BUGS_HARNESS, 'fixtures');
const PORT = Number(process.env.HUNT_BUGS_PROVIDERS_PORT ?? 4598);

const TRANSCRIPT = fs
  .readFileSync(path.join(FIXTURES, 'transcript.txt'), 'utf8')
  .split(/\n\s*\n/)
  .filter(Boolean);
const SUMMARY = fs.readFileSync(path.join(FIXTURES, 'summary.md'), 'utf8');

// Each provider's rule: `mode` is what a matching request gets, `match` limits it to the lectures
// whose `x-hunt-bugs-lecture` path holds it as whole segments, and `times` drains one per hit, back
// to 'ok' at zero. 'empty' is the "model returned nothing" branch each step has its own message for.
const MODES = {
  groq: ['ok', '429', '500', 'empty'],
  gemini: ['ok', '429', '500', 'empty', 'invalidkey'],
};
const OK = { mode: 'ok', match: null, times: null };
const mode = { groq: { ...OK }, gemini: { ...OK } };

// A bare string is the untargeted rule, so `{"gemini":"429"}` still fails every call.
function parseRule(provider, value) {
  const rule = { ...OK, ...(typeof value === 'string' ? { mode: value } : value) };
  const unknown = Object.keys(rule).filter((key) => !(key in OK));
  if (unknown.length) throw new Error(`${provider} takes mode, match, times — not ${unknown}`);
  if (rule.match !== null && (typeof rule.match !== 'string' || !rule.match)) {
    throw new Error(`${provider} match must be a non-empty path like "hb-fail/שיעור 4"`);
  }
  if (!MODES[provider].includes(rule.mode)) {
    throw new Error(`${provider} mode must be one of ${MODES[provider].join(' | ')}`);
  }
  if (rule.times !== null && !(Number.isInteger(rule.times) && rule.times > 0)) {
    throw new Error(`${provider} times must be a whole number ≥ 1`);
  }
  return rule;
}

// The failure this request gets among the modes its route honours, or 'ok'. The shim stamps the
// lecture a pipeline step or an overview works on; a probe carries none, so only an untargeted rule reaches it.
function failure(provider, req, honoured) {
  const rule = mode[provider];
  if (!honoured.includes(rule.mode)) return 'ok';
  if (rule.match !== null) {
    const target = decodeURIComponent(req.headers['x-hunt-bugs-lecture'] ?? '');
    if (!`/${target}/`.includes(`/${rule.match}/`)) return 'ok';
  }
  const hit = rule.mode;
  if (rule.times !== null && --rule.times === 0) mode[provider] = { ...OK };
  return hit;
}

let chunk = 0;
let uploads = 0;

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    ...headers,
  });
  res.end(payload);
}

function text(res, status, body) {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}

// Groq's 429 body, phrased the way transcribe.py's parse_rate_limit_message expects to read it.
function groqRateLimit(res) {
  json(
    res,
    429,
    {
      error: {
        message:
          'Rate limit reached for model `whisper-large-v3` in organization `org_hunt` on ' +
          'seconds of audio per hour (ASH): Limit 7200, Used 7200, Requested 600. ' +
          'Please try again in 12m30s.',
        type: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded',
      },
    },
    { 'retry-after': '750' },
  );
}

// Gemini's 429: the SDK error carries this body through, and llm_client digs the QuotaFailure and
// RetryInfo details out of it to build the message the lecture view shows.
function geminiRateLimit(res) {
  json(res, 429, {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaValue: '50',
            },
          ],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '41s' },
      ],
    },
  });
}

// What real Gemini answers a key it does not know: 400, not 401, with the reason in ErrorInfo.
function geminiKeyInvalid(res) {
  const message = 'API key not valid. Please pass a valid API key.';
  json(res, 400, {
    error: {
      code: 400,
      message,
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'API_KEY_INVALID',
          domain: 'googleapis.com',
          metadata: { service: 'generativelanguage.googleapis.com' },
        },
        { '@type': 'type.googleapis.com/google.rpc.LocalizedMessage', locale: 'en-US', message },
      ],
    },
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const route = url.pathname;

  if (route === '/control') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    // `reset` is what a reseed sends; a provider's field sets only that provider.
    const next = body.reset ? { groq: { ...OK }, gemini: { ...OK } } : { ...mode };
    try {
      for (const provider of ['groq', 'gemini']) {
        if (body[provider] !== undefined) next[provider] = parseRule(provider, body[provider]);
      }
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
    Object.assign(mode, next);
    if (body.reset) chunk = 0; // the transcript restarts at its first paragraph
    return json(res, 200, { mode });
  }
  if (route === '/health') return json(res, 200, { status: 'ok', mode });

  // A key containing `bad` is rejected the way the key probe reads a rejection, so the settings
  // screen's rejected-key path is drivable by typing one.
  const key = `${req.headers.authorization ?? ''} ${req.headers['x-goog-api-key'] ?? ''} ${url.searchParams.get('key') ?? ''}`;
  if (key.includes('bad'))
    return json(res, 401, { error: { code: 401, message: 'fake: invalid API key' } });

  // Groq: the key probe lists models, transcription takes the multipart chunk ffmpeg produced.
  if (route.endsWith('/openai/v1/models')) {
    if (failure('groq', req, ['500']) !== 'ok')
      return json(res, 500, { error: { message: 'fake groq is down' } });
    return json(res, 200, { object: 'list', data: [{ id: 'whisper-large-v3', object: 'model' }] });
  }
  if (route.endsWith('/openai/v1/audio/transcriptions')) {
    await readBody(req);
    const fail = failure('groq', req, ['429', '500', 'empty']);
    if (fail === '429') return groqRateLimit(res);
    if (fail === '500') return json(res, 500, { error: { message: 'fake groq is down' } });
    if (fail === 'empty') return text(res, 200, '');
    const line = TRANSCRIPT[chunk++ % TRANSCRIPT.length];
    return text(res, 200, line);
  }

  // Gemini: models for the probe, generateContent for both summarize and the course overview,
  // and the resumable Files API they upload through. A rejected key is rejected on every route,
  // so the first thing the backend sends is what fails, as with a real bad key.
  if (route.startsWith('/gemini/')) {
    if (failure('gemini', req, ['invalidkey']) !== 'ok') {
      await readBody(req);
      return geminiKeyInvalid(res);
    }
  }
  if (route.endsWith('/v1beta/models') && req.method === 'GET') {
    if (failure('gemini', req, ['500']) !== 'ok')
      return json(res, 500, { error: { message: 'fake gemini is down' } });
    return json(res, 200, { models: [{ name: 'models/gemini-2.5-flash' }] });
  }
  if (route.includes('/upload/') && route.endsWith('/files')) {
    await readBody(req);
    if (url.searchParams.has('upload_id')) {
      uploads += 1;
      // `x-goog-upload-status: final` is what the SDK reads to decide the upload finished; without
      // it every upload fails as "Upload status is not finalized" however good the body is.
      return json(
        res,
        200,
        {
          file: {
            name: `files/hunt-${uploads}`,
            uri: `http://127.0.0.1:${PORT}/gemini/v1beta/files/hunt-${uploads}`,
            mimeType: 'application/pdf',
            sizeBytes: '1024',
            state: 'ACTIVE',
          },
        },
        { 'x-goog-upload-status': 'final' },
      );
    }
    return json(
      res,
      200,
      {},
      {
        'x-goog-upload-url': `http://127.0.0.1:${PORT}${route}?upload_id=${uploads + 1}`,
        'x-goog-upload-status': 'active',
      },
    );
  }
  if (route.includes('/v1beta/files/')) {
    const name = route.slice(route.lastIndexOf('/') + 1);
    if (req.method === 'DELETE') return json(res, 200, {});
    return json(res, 200, {
      name: `files/${name}`,
      uri: `http://127.0.0.1:${PORT}${route}`,
      mimeType: 'application/pdf',
      state: 'ACTIVE',
    });
  }
  if (route.includes('/v1beta/models/') && route.endsWith(':generateContent')) {
    await readBody(req);
    const fail = failure('gemini', req, ['429', '500', 'empty']);
    if (fail === '429') return geminiRateLimit(res);
    if (fail === '500')
      return json(res, 500, { error: { code: 500, message: 'fake gemini is down' } });
    const body = fail === 'empty' ? '' : SUMMARY;
    return json(res, 200, {
      candidates: [
        { content: { role: 'model', parts: [{ text: body }] }, finishReason: 'STOP', index: 0 },
      ],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 800, totalTokenCount: 2000 },
      modelVersion: 'hunt-bugs-fake',
    });
  }

  // Where a seeded drive_url.txt points: "Open in Drive" lands here, never off the machine.
  if (route.startsWith('/drive/view/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      '<!doctype html><meta charset="utf-8"><p>hunt-bugs: fake Drive file. Nothing was uploaded.',
    );
  }

  // The Drive consent URL the faked settings flow hands the UI; opening it explains itself.
  if (route === '/drive/consent') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      '<!doctype html><meta charset="utf-8"><p>hunt-bugs: fake Drive consent. Nothing was signed in.',
    );
  }

  return json(res, 404, { error: { message: `fake provider has no route for ${route}` } });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((error) => json(res, 500, { error: { message: String(error) } }));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`fake providers on ${PORT}`));
