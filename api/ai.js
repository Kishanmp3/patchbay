// Anthropic Messages API proxy (Vercel Edge). Key comes from env ANTHROPIC_API_KEY,
// or from the x-user-key header if a visitor pastes their own key in Settings.
export const config = { runtime: 'edge' };

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  const env = (typeof process !== 'undefined' && process.env) || {};
  if (req.method === 'GET') return json({ configured: !!env.ANTHROPIC_API_KEY, accessCode: !!env.ACCESS_CODE, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const userKey = req.headers.get('x-user-key');
  if (!userKey && env.ACCESS_CODE && req.headers.get('x-access-code') !== env.ACCESS_CODE) return json({ error: { message: 'This site needs an access code. Add it in Settings.' } }, 401);
  const key = userKey || env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: { message: 'No API key yet. Set ANTHROPIC_API_KEY on the server or paste a key in Settings.' } }, 401);
  let body; try { body = await req.json(); } catch { return json({ error: { message: 'Body must be JSON' } }, 400); }
  const payload = {
    model: body.model || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: Math.min(Number(body.max_tokens) || 4096, 32000),
    messages: body.messages,
  };
  for (const k of ['system', 'tools', 'tool_choice', 'temperature', 'stream', 'stop_sequences']) if (body[k] !== undefined) payload[k] = body[k];
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload),
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
}
