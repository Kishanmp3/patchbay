// Browser helper for /api/ai. Settings live in localStorage.
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
export const settings = {
  get key() { return LS.get('ai.userKey', ''); }, set key(v) { LS.set('ai.userKey', v); },
  get code() { return LS.get('ai.accessCode', ''); }, set code(v) { LS.set('ai.accessCode', v); },
  get model() { return LS.get('ai.model', ''); }, set model(v) { LS.set('ai.model', v); },
};
function headers() { const h = { 'content-type': 'application/json' }; if (settings.key) h['x-user-key'] = settings.key; if (settings.code) h['x-access-code'] = settings.code; return h; }
export async function aiStatus() { try { const r = await fetch('/api/ai'); if (!r.ok) throw 0; const j = await r.json(); return { ...j, ready: j.configured || !!settings.key }; } catch { return { configured: false, ready: !!settings.key, offline: true }; } }
export async function claude(body) {
  const r = await fetch('/api/ai', { method: 'POST', headers: headers(), body: JSON.stringify({ ...(settings.model ? { model: settings.model } : {}), ...body, stream: false }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Request failed (${r.status})`);
  return j;
}
export async function* claudeStream(body, signal) {
  const r = await fetch('/api/ai', { method: 'POST', headers: headers(), body: JSON.stringify({ ...(settings.model ? { model: settings.model } : {}), ...body, stream: true }), signal });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error?.message || `Request failed (${r.status})`); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
      try { yield JSON.parse(line.slice(5).trim()); } catch {} } }
}
export const textOf = (msg) => (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
export function extractJSON(text) { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : text; const a = s.indexOf('{'), b = s.lastIndexOf('}'); return JSON.parse(s.slice(a, b + 1)); }
