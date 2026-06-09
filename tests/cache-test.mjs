#!/usr/bin/env node
// Verify Anthropic prompt caching for claude-opus-4.8 through the gateway.
// Strategy: send a large system block (>1024 tokens) marked with cache_control,
// twice. Call #1 should populate the cache (cache_creation_input_tokens > 0),
// call #2 (identical) should hit it (cache_read_input_tokens > 0).
// Usage: CPX_KEY=cpx-... MODEL=claude-opus-4.8 node scripts/cache-test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env so CPX_DEMO_KEY (and friends) are available without
// needing `node --env-file=.env`. Existing process env vars take precedence.
function loadDotEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const GATEWAY = process.env.GATEWAY || 'http://localhost:4000';
const KEY =
  process.env.CPX_KEY ||
  process.env.CPX_DEMO_KEY ||
  (fs.existsSync('/tmp/cpxkey.txt') ? fs.readFileSync('/tmp/cpxkey.txt', 'utf8').trim() : '');
const MODEL = process.env.MODEL || 'claude-opus-4.8';

if (!KEY) {
  console.error('No API key. Set CPX_KEY, set CPX_DEMO_KEY in .env, or provide /tmp/cpxkey.txt');
  process.exit(1);
}

// Build a deterministic, large system prompt (well over the 1024-token minimum).
const filler = Array.from(
  { length: 400 },
  (_, i) =>
    `Rule ${i + 1}: When responding, remain concise, factual, and consistent with all prior rules in this list.`
).join(' ');
const SYSTEM = `You are a meticulous assistant operating under a fixed rulebook. ${filler}`;

const HEADERS = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };

async function call(label) {
  const t0 = performance.now();
  const res = await fetch(`${GATEWAY}/v1/messages`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    }),
  });
  const body = await res.json();
  const ms = (performance.now() - t0).toFixed(0);
  if (!res.ok) {
    console.log(`${label}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    return null;
  }
  const u = body.usage || {};
  console.log(
    `${label} (${ms}ms): input=${u.input_tokens} output=${u.output_tokens} ` +
      `cache_creation=${u.cache_creation_input_tokens ?? '-'} ` +
      `cache_read=${u.cache_read_input_tokens ?? '-'}`
  );
  return u;
}

async function run() {
  console.log(`Model: ${MODEL}  via ${GATEWAY}/v1/messages`);
  console.log(`System prompt length: ${SYSTEM.length} chars (~${Math.round(SYSTEM.length / 4)} tokens est.)`);
  console.log('='.repeat(72));

  const u1 = await call('call #1 (cold) ');
  // Small delay so the cache is registered upstream.
  await new Promise((r) => setTimeout(r, 1500));
  const u2 = await call('call #2 (warm) ');
  await new Promise((r) => setTimeout(r, 1500));
  const u3 = await call('call #3 (warm) ');

  console.log('='.repeat(72));
  const read2 = u2?.cache_read_input_tokens || 0;
  const read3 = u3?.cache_read_input_tokens || 0;
  const created = u1?.cache_creation_input_tokens || 0;
  const coldInput = u1?.input_tokens || 0;
  const warmInput = u2?.input_tokens ?? coldInput;
  const maxRead = Math.max(read2, read3);

  // Definitive signal is cache_read on a warm call (billed input also collapses).
  if (maxRead > 0) {
    console.log(
      `RESULT: ✅ caching WORKS — warm calls read ${maxRead} tokens from cache; ` +
        `billed input dropped ${coldInput} -> ${warmInput}.` +
        (created === 0 ? ' (upstream omits cache_creation_input_tokens, but read proves it.)' : '')
    );
  } else if (created > 0) {
    console.log(`RESULT: ⚠️ cache was CREATED (${created}) but never READ back — not effective here.`);
  } else if (u1 && u1.cache_read_input_tokens === undefined) {
    console.log('RESULT: ⚠️ response has no cache_* usage fields — upstream/model does not surface caching.');
  } else {
    console.log('RESULT: ❌ no caching observed.');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
