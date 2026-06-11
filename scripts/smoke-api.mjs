#!/usr/bin/env node

import process from 'node:process';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
const DEFAULT_CHAT_TEXT = '我不知道该不该读研，觉得读研是一段体验，但又怕自己其实不喜欢理论研究。';
const RESPONSE_TYPES = new Set(['normal', 'summary', 'crisis']);
const RESPONSE_MODES = new Set(['free_text', 'choice']);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.JINGGUAN_BASE_URL || DEFAULT_BASE_URL,
    chat: false,
    text: DEFAULT_CHAT_TEXT,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') {
      args.baseUrl = argv[++i] || args.baseUrl;
    } else if (arg === '--chat') {
      args.chat = true;
    } else if (arg === '--text') {
      args.text = argv[++i] || args.text;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run smoke:api
  npm run smoke:api:chat
  node scripts/smoke-api.mjs --base-url http://127.0.0.1:5173 --chat

By default this only checks /api/health.
Use --chat to spend one model call and validate /api/chat response shape.`);
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`Cannot reach ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${url} returned non-JSON response: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }

  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateHealth(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 'health body must be an object');
  assert(body.service === 'jingguan-api', 'health.service must be jingguan-api');
  assert(body.mode === 'anthropic' || body.mode === 'mock', 'health.mode must be anthropic or mock');
  assert(typeof body.ok === 'boolean', 'health.ok must be boolean');
  assert(typeof body.anthropic_configured === 'boolean', 'health.anthropic_configured must be boolean');
  assert(typeof body.prompt_loaded === 'boolean', 'health.prompt_loaded must be boolean');
  assert(body.prompt_loaded, 'system prompt is not readable');

  if (body.mode === 'anthropic') {
    assert(body.anthropic_configured, 'anthropic mode requires ANTHROPIC_API_KEY and ANTHROPIC_MODEL');
    assert(body.ok, 'health.ok must be true in configured anthropic mode');
  }
}

function validateChoices(choices) {
  assert(Array.isArray(choices), 'choices must be an array');
  assert(choices.length >= 2 && choices.length <= 4, 'choice mode requires 2-4 choices');

  choices.forEach((choice, index) => {
    assert(choice && typeof choice === 'object' && !Array.isArray(choice), `choice ${index + 1} must be an object`);
    for (const field of ['id', 'label', 'description', 'meaning']) {
      assert(typeof choice[field] === 'string' && choice[field].trim(), `choice ${index + 1}.${field} must be a non-empty string`);
    }
    assert(
      !/^\s*[\[{]|"id"\s*:|"label"\s*:/.test(choice.label),
      `choice ${index + 1}.label looks like serialized JSON`,
    );
    assert(
      choice.requires_api_after_choice === undefined || typeof choice.requires_api_after_choice === 'boolean',
      `choice ${index + 1}.requires_api_after_choice must be boolean when present`,
    );
  });
}

function validateChat(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 'chat body must be an object');
  assert(RESPONSE_TYPES.has(body.response_type), 'response_type is invalid');
  assert(RESPONSE_MODES.has(body.response_mode), 'response_mode is invalid');
  assert(typeof body.message === 'string' && body.message.trim(), 'message must be a non-empty string');
  assert(Array.isArray(body.detected_beliefs), 'detected_beliefs must be an array');
  assert(Array.isArray(body.detected_tensions), 'detected_tensions must be an array');
  assert(typeof body.can_summarize === 'boolean', 'can_summarize must be boolean');
  assert(typeof body.should_summarize === 'boolean', 'should_summarize must be boolean');

  if (body.response_mode === 'choice') {
    validateChoices(body.choices);
  } else {
    assert(Array.isArray(body.choices) && body.choices.length === 0, 'free_text mode should not return choices');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const health = await fetchJson(endpoint(args.baseUrl, '/api/health'));
  validateHealth(health);

  console.log(
    `health ok: mode=${health.mode}, anthropic_configured=${health.anthropic_configured}, model=${health.model || '-'}`,
  );

  if (!args.chat) {
    return;
  }

  const chat = await fetchJson(endpoint(args.baseUrl, '/api/chat'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text: args.text,
      history: [],
      detectedBeliefs: [],
      detectedTensions: [],
    }),
  });

  validateChat(chat);
  console.log(
    `chat ok: response_type=${chat.response_type}, phase=${chat.phase}, response_mode=${chat.response_mode}, choices=${chat.choices.length}`,
  );
}

main().catch((error) => {
  console.error(`smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
