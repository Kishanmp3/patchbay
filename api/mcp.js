// Streamable-HTTP MCP relay (Vercel Edge). Lets the browser talk to remote MCP servers
// that don't send CORS headers. Body: { url, headers, sessionId, message }
export const config = { runtime: 'edge' };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[?::1\]?|.*\.internal$|.*\.local$)/i;

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  let u; try { u = new URL(b.url); } catch { return json({ error: 'That server URL is not valid.' }, 400); }
  if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) return json({ error: 'Only public http(s) MCP servers can be relayed. Run the local dev server to reach localhost.' }, 400);
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': b.protocolVersion || '2025-06-18' };
  if (b.sessionId) headers['mcp-session-id'] = b.sessionId;
  for (const [k, v] of Object.entries(b.headers || {})) if (k && v) headers[k.toLowerCase()] = String(v);
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
  let r;
  try { r = await fetch(u, { method: 'POST', headers, body: JSON.stringify(b.message), signal: ctrl.signal }); }
  catch (e) { clearTimeout(timer); return json({ error: `Could not reach ${u.host}: ${e.message}` }, 502); }
  const sessionId = r.headers.get('mcp-session-id');
  const ct = r.headers.get('content-type') || '';
  const messages = [];
  if (r.status === 202 || !r.body) { clearTimeout(timer); return json({ status: r.status, sessionId, messages }); }
  if (ct.includes('text/event-stream')) {
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const want = b.message?.id;
    outer: while (true) {
      const { value, done } = await reader.read().catch(() => ({ done: true })); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = ev.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (!data) continue;
        try { const m = JSON.parse(data); messages.push(m); if (want != null && m.id === want) { reader.cancel().catch(() => {}); break outer; } } catch {}
      }
    }
  } else {
    const text = await r.text();
    try { const m = JSON.parse(text); Array.isArray(m) ? messages.push(...m) : messages.push(m); }
    catch { clearTimeout(timer); return json({ status: r.status, sessionId, error: `Server answered with non-JSON (${r.status}): ${text.slice(0, 300)}` }, 502); }
  }
  clearTimeout(timer);
  return json({ status: r.status, sessionId, messages });
}
