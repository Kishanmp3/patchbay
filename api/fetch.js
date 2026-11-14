// Readable-web fetcher for the built-in "web" server. GET /api/fetch?url=...
export const config = { runtime: 'edge' };
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[?::1\]?)/i;
export default async function handler(req) {
  const target = new URL(req.url).searchParams.get('url');
  let u; try { u = new URL(target); } catch { return json({ error: 'Pass a full URL, like https://example.com' }, 400); }
  if (!/^https?:$/.test(u.protocol) || PRIVATE.test(u.hostname)) return json({ error: 'Only public http(s) URLs are allowed.' }, 400);
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'Patchbay/1.0 (+MCP playground)', accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' }, redirect: 'follow' });
    const ct = r.headers.get('content-type') || '';
    let text = await r.text();
    let title = '';
    if (ct.includes('html')) {
      title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
      text = text.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
    }
    return json({ status: r.status, url: r.url, contentType: ct, title, text: text.slice(0, 60000), truncated: text.length > 60000 });
  } catch (e) { return json({ error: `Fetch failed: ${e.message}` }, 502); }
}
