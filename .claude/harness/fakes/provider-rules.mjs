// The fake providers' failure rules and the decision each request gets from them, apart from the
// server so the unit tests can drive a sequence of calls without a port or a fixture.

// Each provider's rule: `mode` is what a matching request gets, `match` limits it to the lectures
// whose `x-harness-lecture` path holds it as whole segments, and `times` drains one per hit, back
// to 'ok' at zero. 'empty' is the "model returned nothing" branch each step has its own message for;
// 'slow' holds the call `ms` and then answers as 'ok', so a step stays in flight on demand.
export const MODES = {
  groq: ['ok', '429', '500', 'empty', 'slow'],
  gemini: ['ok', '429', '500', 'empty', 'invalidkey', 'slow'],
};
export const OK = { mode: 'ok', match: null, times: null, ms: null };

// A bare string is the untargeted rule, so `{"gemini":"429"}` still fails every call.
export function parseRule(provider, value) {
  const rule = { ...OK, ...(typeof value === 'string' ? { mode: value } : value) };
  const unknown = Object.keys(rule).filter((key) => !(key in OK));
  if (unknown.length) throw new Error(`${provider} takes mode, match, times, ms — not ${unknown}`);
  if (rule.match !== null && (typeof rule.match !== 'string' || !rule.match)) {
    throw new Error(`${provider} match must be a non-empty path like "hb-fail/שיעור 4"`);
  }
  if (!MODES[provider].includes(rule.mode)) {
    throw new Error(`${provider} mode must be one of ${MODES[provider].join(' | ')}`);
  }
  if (rule.times !== null && !(Number.isInteger(rule.times) && rule.times > 0)) {
    throw new Error(`${provider} times must be a whole number ≥ 1`);
  }
  if ((rule.mode === 'slow') !== (Number.isInteger(rule.ms) && rule.ms > 0)) {
    throw new Error(`${provider} ms is a whole number ≥ 1, given with mode slow and only with it`);
  }
  return rule;
}

/** Both providers' live rules, with the `/control` update and the per-request decision over them. */
export function createRules() {
  const mode = { groq: { ...OK }, gemini: { ...OK } };
  return {
    mode,
    // `reset` is what a reseed sends; a provider's field sets only that provider. All or nothing:
    // a rule that fails to parse throws before any provider changes.
    control(body) {
      const next = body.reset ? { groq: { ...OK }, gemini: { ...OK } } : { ...mode };
      for (const provider of ['groq', 'gemini']) {
        if (body[provider] !== undefined) next[provider] = parseRule(provider, body[provider]);
      }
      Object.assign(mode, next);
    },
    // The mode this request hits among those its route honours, or 'ok', plus a slow hit's `ms`.
    // `lecture` is the raw `x-harness-lecture` header; a probe carries none, so only an untargeted
    // rule reaches it.
    take(provider, lecture, honoured) {
      const rule = mode[provider];
      if (!honoured.includes(rule.mode)) return { hit: 'ok', ms: null };
      if (rule.match !== null) {
        const target = decodeURIComponent(lecture ?? '');
        if (!`/${target}/`.includes(`/${rule.match}/`)) return { hit: 'ok', ms: null };
      }
      if (rule.times !== null && --rule.times === 0) mode[provider] = { ...OK };
      return { hit: rule.mode, ms: rule.ms };
    },
  };
}
