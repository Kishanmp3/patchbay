// Claude access for the browser.
// A visitor's own key goes straight from their browser to Anthropic (never to this site's server).
// Without one, calls fall back to the site's /api/ai proxy if the owner configured ANTHROPIC_API_KEY.
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const settings = {
  get key() { return LS.get('ai.userKey', ''); }, set key(v) { LS.set('ai.userKey', v); },
  get code() { return LS.get('ai.accessCode', ''); }, set code(v) { LS.set('ai.accessCode', v); },
  get model() { return LS.get('ai.model', ''); }, set model(v) { LS.set('ai.model', v); },
};
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
function request(payload, key = settings.key) {
  const { _signal: signal, ...body } = payload;
  if (key) return fetch(ANTHROPIC, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: settings.model || DEFAULT_MODEL, ...body }), signal });
  const h = { 'content-type': 'application/json' }; if (settings.code) h['x-access-code'] = settings.code;
  return fetch('/api/ai', { method: 'POST', headers: h, body: JSON.stringify({ ...(settings.model ? { model: settings.model } : {}), ...body }), signal });
}
let serverInfo = null;
async function server() { if (serverInfo) return serverInfo; try { const r = await fetch('/api/ai'); serverInfo = r.ok ? await r.json() : {}; } catch { serverInfo = {}; } return serverInfo; }
export async function aiStatus() { const s = await server(); return { ...s, own: !!settings.key, ready: !!settings.key || !!s.configured, model: settings.model || s.model || DEFAULT_MODEL }; }
const errMsg = (j, r) => j?.error?.message || (r.status === 401 ? 'That API key was rejected. Check it in Settings.' : r.status === 429 ? 'Rate limited by Anthropic. Wait a moment and try again.' : `Request failed (${r.status})`);
export async function claude(body) {
  const r = await request({ ...body, stream: false });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(errMsg(j, r));
  return j;
}
export async function* claudeStream(body, signal) {
  const r = await request({ ...body, stream: true, _signal: signal });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(errMsg(j, r)); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split('\n').find(l => l.startsWith('data:')); if (!line) continue;
      try { yield JSON.parse(line.slice(5).trim()); } catch {} } }
}
export async function testKey(key) {
  try {
    const r = await request({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }, key);
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || /model/i.test(j?.error?.message || '')) return { ok: false, message: `The key works, but the model "${settings.model || DEFAULT_MODEL}" isn't available to it. Pick another model.` };
    return { ok: false, message: r.status === 401 ? 'Anthropic rejected that key. Copy it again from console.anthropic.com.' : errMsg(j, r) };
  } catch (e) { return { ok: false, message: `Couldn't reach Anthropic: ${e.message}` }; }
}
export const textOf = (msg) => (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
export function extractJSON(text) { const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); const s = m ? m[1] : text; const a = s.indexOf('{'), b = s.lastIndexOf('}'); return JSON.parse(s.slice(a, b + 1)); }

/**
 * Wires a site's key dialog. Expects inputs #sKey, #sModel, optional #sCode (+ its label), a save button #sSave,
 * and a #sStatus element for messages. Returns { open, require, refresh }.
 */
export function setupKeyUI({ dialog, button, labels = ['Add API key', 'API key added'], onChange, toast = () => {} }) {
  const $ = (s) => document.querySelector(s);
  const dlg = $(dialog), btn = $(button), status = $('#sStatus');
  const codeRow = $('#sCode')?.closest('label');
  async function refresh() { const s = await aiStatus(); if (btn) { btn.textContent = settings.key ? labels[1] : s.configured ? 'API key' : labels[0]; btn.classList.toggle('needs-key', !s.ready); } if (codeRow) codeRow.hidden = !s.accessCode || !!settings.key; onChange?.(s); return s; }
  function open(reason) { $('#sKey').value = settings.key; $('#sModel').value = settings.model; if ($('#sCode')) $('#sCode').value = settings.code; if (status) { status.textContent = reason || ''; status.dataset.kind = reason ? 'info' : ''; } if (!dlg.open) dlg.showModal(); setTimeout(() => $('#sKey').focus(), 50); }
  btn?.addEventListener('click', () => open());
  $('#sSave').addEventListener('click', async (e) => {
    e.preventDefault(); const key = $('#sKey').value.trim(); settings.model = $('#sModel').value.trim(); if ($('#sCode')) settings.code = $('#sCode').value.trim();
    if (key && key !== settings.key) {
      $('#sSave').disabled = true; if (status) { status.textContent = 'Checking the key with Anthropic'; status.dataset.kind = 'info'; }
      const t = await testKey(key); $('#sSave').disabled = false;
      if (!t.ok) { if (status) { status.textContent = t.message; status.dataset.kind = 'error'; } return; }
    }
    settings.key = key; dlg.close(); await refresh(); toast(key ? 'Key saved in this browser' : 'Key removed');
  });
  const forget = $('#sForget'); forget?.addEventListener('click', async () => { settings.key = ''; $('#sKey').value = ''; dlg.close(); await refresh(); toast('Key removed from this browser'); });
  async function require(reason) { const s = await aiStatus(); if (s.ready) return true; open(reason); return false; }
  refresh();
  return { open, require, refresh };
}
