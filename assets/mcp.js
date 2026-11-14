// MCP client for the browser: remote servers over Streamable HTTP (via /api/mcp) and
// in-page servers that answer the same JSON-RPC methods.
export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
const PROTOCOL = '2025-06-18';
let seq = 0;

class BaseServer {
  constructor(o) { Object.assign(this, { status: 'idle', tools: [], resources: [], prompts: [], info: null, error: '' }, o); }
  setStatus(s, err = '') { this.status = s; this.error = err; emit('status', this); }
  async rpc(method, params) {
    const id = ++seq; const msg = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
    const t0 = performance.now();
    emit('traffic', { dir: 'out', server: this, method, payload: msg, at: Date.now() });
    try {
      const result = await this._send(msg);
      emit('traffic', { dir: 'in', server: this, method, payload: { jsonrpc: '2.0', id, result }, ms: performance.now() - t0, at: Date.now() });
      return result;
    } catch (e) {
      emit('traffic', { dir: 'in', server: this, method, payload: { jsonrpc: '2.0', id, error: { message: e.message } }, ms: performance.now() - t0, at: Date.now(), error: true });
      throw e;
    }
  }
  async connect() {
    this.setStatus('connecting');
    try {
      const init = await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Patchbay', version: '1.0.0' } });
      this.info = init.serverInfo || { name: this.name }; this.capabilities = init.capabilities || {}; this.instructions = init.instructions || '';
      this.protocolVersion = init.protocolVersion || PROTOCOL;
      await this.notify('notifications/initialized');
      await this.refresh();
      this.setStatus('ready');
    } catch (e) { this.setStatus('error', e.message); }
    return this;
  }
  async refresh() {
    const c = this.capabilities || {};
    this.tools = c.tools ? await this._all('tools/list', 'tools') : [];
    this.resources = c.resources ? await this._all('resources/list', 'resources').catch(() => []) : [];
    this.prompts = c.prompts ? await this._all('prompts/list', 'prompts').catch(() => []) : [];
  }
  async _all(method, key) { let out = [], cursor; do { const r = await this.rpc(method, cursor ? { cursor } : undefined); out = out.concat(r[key] || []); cursor = r.nextCursor; } while (cursor && out.length < 2000); return out; }
  callTool(name, args) { emit('call', { server: this, name, args }); return this.rpc('tools/call', { name, arguments: args || {} }); }
  readResource(uri) { return this.rpc('resources/read', { uri }); }
  getPrompt(name, args) { return this.rpc('prompts/get', { name, arguments: args || {} }); }
}

export class RemoteServer extends BaseServer {
  constructor(o) { super({ kind: 'remote', ...o }); }
  async _send(msg) {
    const r = await fetch('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: this.url, headers: this.headers || {}, sessionId: this.sessionId, protocolVersion: this.protocolVersion, message: msg }) });
    const j = await r.json().catch(() => ({ error: `Relay answered ${r.status}` }));
    if (j.error) throw new Error(j.error);
    if (j.sessionId) this.sessionId = j.sessionId;
    if (j.status === 401 || j.status === 403) throw new Error(`The server refused the request (${j.status}). It probably needs an Authorization header.`);
    if (msg.id == null) return null;
    const resp = (j.messages || []).find(m => m.id === msg.id);
    if (!resp) throw new Error(`No reply to ${msg.method} (HTTP ${j.status}).`);
    if (resp.error) throw new Error(resp.error.message || 'Server error');
    return resp.result;
  }
  async notify(method) { try { await this._send({ jsonrpc: '2.0', method }); } catch {} }
}

export class LocalServer extends BaseServer {
  constructor(def) { super({ kind: 'local', ...def }); }
  async notify() {}
  async _send(msg) {
    await new Promise(r => setTimeout(r, 2 + Math.random() * 10));
    const p = msg.params || {};
    switch (msg.method) {
      case 'initialize': return { protocolVersion: PROTOCOL, serverInfo: { name: this.name, version: '1.0.0' }, capabilities: { tools: {}, ...(this.def.resources ? { resources: {} } : {}), ...(this.def.prompts ? { prompts: {} } : {}) }, instructions: this.def.instructions };
      case 'tools/list': return { tools: this.def.tools.map(({ handler, ...t }) => t) };
      case 'tools/call': {
        const t = this.def.tools.find(t => t.name === p.name);
        if (!t) throw new Error(`Unknown tool: ${p.name}`);
        try { const out = await t.handler(p.arguments || {}, this.ctx); return typeof out === 'string' ? { content: [{ type: 'text', text: out }] } : out; }
        catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
      }
      case 'resources/list': return { resources: (await this.def.resources?.list?.()) || [] };
      case 'resources/read': return { contents: [await this.def.resources.read(p.uri)] };
      case 'prompts/list': return { prompts: (this.def.prompts || []).map(({ build, ...x }) => x) };
      case 'prompts/get': { const pr = (this.def.prompts || []).find(x => x.name === p.name); if (!pr) throw new Error('Unknown prompt'); return pr.build(p.arguments || {}); }
      default: throw new Error(`Method not found: ${msg.method}`);
    }
  }
}

/* ---------- safe math ---------- */
export function calc(expr) {
  const s = String(expr).replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^');
  let i = 0;
  const F = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max, pow: Math.pow };
  const C = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  const peek = () => s[i];
  const expect = (c) => { if (s[i] !== c) throw new Error(`Expected "${c}" at position ${i + 1}`); i++; };
  function expression() { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  function term() { let v = power(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = s[i++]; const r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; }
  function power() { const b = unary(); if (peek() === '^') { i++; return Math.pow(b, power()); } return b; }
  function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return postfix(atom()); }
  function postfix(v) { while (peek() === '!') { i++; let f = 1; for (let k = 2; k <= v; k++) f *= k; v = f; } return v; }
  function atom() {
    if (peek() === '(') { i++; const v = expression(); expect(')'); return v; }
    const num = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i); if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = s.slice(i).match(/^[a-z_][a-z0-9_]*/i);
    if (id) { i += id[0].length; const n = id[0].toLowerCase();
      if (n in C) return C[n];
      if (n in F) { expect('('); const args = [expression()]; while (peek() === ',') { i++; args.push(expression()); } expect(')'); return F[n](...args); }
      throw new Error(`Unknown name "${id[0]}"`); }
    throw new Error(i >= s.length ? 'The expression ended early' : `Unexpected "${s[i]}" at position ${i + 1}`);
  }
  const v = expression(); if (i < s.length) throw new Error(`Unexpected "${s[i]}" at position ${i + 1}`);
  return v;
}

const UNITS = {
  length: { m: 1, km: 1000, cm: .01, mm: .001, mi: 1609.344, yd: .9144, ft: .3048, in: .0254, nmi: 1852 },
  mass: { kg: 1, g: .001, mg: 1e-6, lb: .45359237, oz: .028349523125, t: 1000, st: 6.35029318 },
  volume: { l: 1, ml: .001, gal: 3.785411784, qt: .946352946, pt: .473176473, cup: .2365882365, floz: .0295735295625, m3: 1000 },
  speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: .44704, knot: .514444 },
  data: { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824 },
  time: { s: 1, ms: .001, min: 60, h: 3600, day: 86400, week: 604800, year: 31557600 },
};
function convert(value, from, to) {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const temps = { c: 1, f: 1, k: 1 };
  if (f in temps && t in temps) { const c = f === 'c' ? value : f === 'f' ? (value - 32) * 5 / 9 : value - 273.15; return t === 'c' ? c : t === 'f' ? c * 9 / 5 + 32 : c + 273.15; }
  for (const table of Object.values(UNITS)) if (f in table && t in table) return value * table[f] / table[t];
  throw new Error(`Can't convert ${from} to ${to}. Supported: ${Object.values(UNITS).map(t => Object.keys(t).join(', ')).join('; ')}; c, f, k`);
}
const parseDate = (s) => { if (!s || /^(now|today)$/i.test(s)) return new Date(); if (/^tomorrow$/i.test(s)) return new Date(Date.now() + 864e5); const d = new Date(s); if (isNaN(d)) throw new Error(`Couldn't read the date "${s}". Use YYYY-MM-DD.`); return d; };
const rand = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };

/* ---------- built-in servers ---------- */
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const notes = () => LS.get('pb.notes', []);
const json = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o, null, 2) }], structuredContent: o });

export const BUILTINS = [
  { id: 'notes', name: 'notes', color: '#FF5B1F', instructions: 'A small note store that persists in the browser.',
    tools: [
      { name: 'create_note', description: 'Save a new note. Returns its id.', inputSchema: { type: 'object', properties: { title: { type: 'string', description: 'Short title' }, body: { type: 'string', description: 'Note contents (markdown ok)' }, tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' } }, required: ['title', 'body'] },
        handler: ({ title, body, tags = [] }) => { const n = { id: 'n_' + Math.random().toString(16).slice(2, 6), title, body, tags, created: new Date().toISOString() }; LS.set('pb.notes', [n, ...notes()]); return `Saved note ${n.id}: "${title}"`; } },
      { name: 'list_notes', description: 'List saved notes, newest first.', inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'Only notes with this tag' }, limit: { type: 'integer', default: 20 } } },
        handler: ({ tag, limit = 20 }) => { const list = notes().filter(n => !tag || n.tags?.includes(tag)).slice(0, limit); return list.length ? list.map(n => `${n.id}  ${n.title}${n.tags?.length ? '  #' + n.tags.join(' #') : ''}`).join('\n') : 'No notes yet.'; } },
      { name: 'read_note', description: 'Read one note by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: ({ id }) => { const n = notes().find(n => n.id === id); if (!n) throw new Error(`No note with id ${id}`); return `# ${n.title}\n\n${n.body}`; } },
      { name: 'search_notes', description: 'Full-text search across titles and bodies.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        handler: ({ query }) => { const q = query.toLowerCase(); const hits = notes().filter(n => (n.title + ' ' + n.body).toLowerCase().includes(q)); return hits.length ? hits.map(n => `${n.id}  ${n.title}`).join('\n') : `Nothing matches "${query}".`; } },
      { name: 'delete_note', description: 'Delete a note by id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        handler: ({ id }) => { const all = notes(); if (!all.some(n => n.id === id)) throw new Error(`No note with id ${id}`); LS.set('pb.notes', all.filter(n => n.id !== id)); return `Deleted ${id}`; } },
    ],
    resources: { list: () => notes().map(n => ({ uri: `note://${n.id}`, name: n.title, mimeType: 'text/markdown' })), read: (uri) => { const n = notes().find(n => `note://${n.id}` === uri); if (!n) throw new Error('Not found'); return { uri, mimeType: 'text/markdown', text: `# ${n.title}\n\n${n.body}` }; } },
    prompts: [{ name: 'summarize_notes', description: 'Ask for a summary of every saved note.', arguments: [{ name: 'style', description: 'e.g. bullet points', required: false }], build: ({ style = 'bullet points' }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Summarize these notes as ${style}:\n\n${notes().map(n => `## ${n.title}\n${n.body}`).join('\n\n') || '(no notes)'}` } }] }) }],
  },
  { id: 'web', name: 'web', color: '#17B3A3', instructions: 'Fetches public web pages as readable text.',
    tools: [
      { name: 'fetch_page', description: 'Fetch a public web page and return its readable text.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Full https URL' }, max_chars: { type: 'integer', default: 6000, description: 'Truncate the text to this many characters' } }, required: ['url'] },
        handler: async ({ url, max_chars = 6000 }) => { const r = await fetch('/api/fetch?url=' + encodeURIComponent(url)); const j = await r.json(); if (j.error) throw new Error(j.error); return `${j.title ? j.title + '\n' : ''}${j.url} (${j.status})\n\n${j.text.slice(0, max_chars)}${j.text.length > max_chars ? '\n…[truncated]' : ''}`; } },
      { name: 'fetch_json', description: 'GET a JSON API and return the parsed result.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        handler: async ({ url }) => { const r = await fetch('/api/fetch?url=' + encodeURIComponent(url)); const j = await r.json(); if (j.error) throw new Error(j.error); try { return json(JSON.parse(j.text)); } catch { throw new Error(`That URL didn't return JSON (got ${j.contentType || 'unknown'}).`); } } },
    ] },
  { id: 'math', name: 'math', color: '#F3C531', instructions: 'Exact arithmetic so the model does not have to guess.',
    tools: [
      { name: 'calculate', description: 'Evaluate an arithmetic expression. Supports + - * / ^ % ! and sqrt, sin, cos, tan, ln, log, abs, round, floor, ceil, min, max, pow, pi, e.', inputSchema: { type: 'object', properties: { expression: { type: 'string', description: 'e.g. (1.07^10)*2500' } }, required: ['expression'] },
        handler: ({ expression }) => { const v = calc(expression); if (!isFinite(v)) throw new Error('The result is not a finite number.'); return String(+v.toPrecision(14)); } },
      { name: 'statistics', description: 'Summary statistics for a list of numbers.', inputSchema: { type: 'object', properties: { numbers: { type: 'array', items: { type: 'number' } } }, required: ['numbers'] },
        handler: ({ numbers }) => { const a = numbers.map(Number).filter(n => !isNaN(n)).sort((x, y) => x - y); if (!a.length) throw new Error('Give at least one number.'); const n = a.length, sum = a.reduce((x, y) => x + y, 0), mean = sum / n; const med = n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2; const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (n > 1 ? n - 1 : 1)); return json({ count: n, sum, mean: +mean.toFixed(6), median: med, min: a[0], max: a[n - 1], stdev: +sd.toFixed(6) }); } },
      { name: 'convert_units', description: 'Convert between units of length, mass, volume, speed, data, time and temperature (c, f, k).', inputSchema: { type: 'object', properties: { value: { type: 'number' }, from: { type: 'string', description: 'e.g. mi' }, to: { type: 'string', description: 'e.g. km' } }, required: ['value', 'from', 'to'] },
        handler: ({ value, from, to }) => `${value} ${from} = ${+convert(Number(value), from, to).toPrecision(10)} ${to}` },
    ] },
  { id: 'clock', name: 'clock', color: '#E8418A', instructions: 'Current time, time zones and date arithmetic.',
    tools: [
      { name: 'now', description: 'Current date and time, optionally in an IANA time zone.', inputSchema: { type: 'object', properties: { timezone: { type: 'string', description: 'e.g. Asia/Tokyo' } } },
        handler: ({ timezone }) => { const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone; try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: tz }).format(new Date()); } catch { throw new Error(`Unknown time zone "${timezone}"`); } } },
      { name: 'days_between', description: 'Whole days between two dates. Accepts YYYY-MM-DD, "today" or "tomorrow".', inputSchema: { type: 'object', properties: { from: { type: 'string', default: 'today' }, to: { type: 'string' } }, required: ['to'] },
        handler: ({ from = 'today', to }) => { const a = parseDate(from), b = parseDate(to); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0); const d = Math.round((b - a) / 864e5); return `${d} day${Math.abs(d) === 1 ? '' : 's'} (${Math.floor(Math.abs(d) / 7)} weeks, ${Math.abs(d) % 7} days)`; } },
      { name: 'add_time', description: 'Add or subtract time from a date.', inputSchema: { type: 'object', properties: { date: { type: 'string', default: 'today' }, amount: { type: 'number' }, unit: { type: 'string', enum: ['minutes', 'hours', 'days', 'weeks', 'months', 'years'] } }, required: ['amount', 'unit'] },
        handler: ({ date = 'today', amount, unit }) => { const d = parseDate(date); const n = Number(amount); ({ minutes: () => d.setMinutes(d.getMinutes() + n), hours: () => d.setHours(d.getHours() + n), days: () => d.setDate(d.getDate() + n), weeks: () => d.setDate(d.getDate() + 7 * n), months: () => d.setMonth(d.getMonth() + n), years: () => d.setFullYear(d.getFullYear() + n) })[unit](); return d.toISOString(); } },
    ] },
  { id: 'sketch', name: 'sketch', color: '#3C6CF0', instructions: 'Draws on an 800 by 500 canvas the user can see. Origin is top left.',
    tools: [
      { name: 'draw_shape', description: 'Draw a shape on the 800x500 canvas.', inputSchema: { type: 'object', properties: { shape: { type: 'string', enum: ['circle', 'rect', 'line', 'triangle', 'star'] }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number', description: 'width (rect, triangle)' }, h: { type: 'number', description: 'height (rect, triangle)' }, r: { type: 'number', description: 'radius (circle, star)' }, x2: { type: 'number', description: 'line end x' }, y2: { type: 'number', description: 'line end y' }, color: { type: 'string', description: 'CSS color', default: '#1D1D1B' }, fill: { type: 'boolean', default: true }, stroke_width: { type: 'number', default: 4 } }, required: ['shape', 'x', 'y'] },
        handler: (a, ctx) => { ctx.sketch.shape(a); return `Drew a ${a.color || ''} ${a.shape} at (${a.x}, ${a.y})`; } },
      { name: 'draw_text', description: 'Write text on the canvas.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number', default: 32 }, color: { type: 'string', default: '#1D1D1B' } }, required: ['text', 'x', 'y'] },
        handler: (a, ctx) => { ctx.sketch.text(a); return `Wrote "${a.text}"`; } },
      { name: 'clear_canvas', description: 'Clear the canvas to a background color.', inputSchema: { type: 'object', properties: { background: { type: 'string', default: '#F4F1E8' } } },
        handler: (a, ctx) => { ctx.sketch.clear(a.background); return 'Canvas cleared'; } },
    ] },
  { id: 'dice', name: 'dice', color: '#8BC34A', instructions: 'Cryptographically random dice, picks and ids.',
    tools: [
      { name: 'roll', description: 'Roll dice in standard notation like 2d6+3 or d20.', inputSchema: { type: 'object', properties: { notation: { type: 'string', default: '1d20' } } },
        handler: ({ notation = '1d20' }) => { const m = notation.replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i); if (!m) throw new Error('Use notation like 3d6+2'); const n = Math.min(+m[1] || 1, 100), s = +m[2], k = +(m[3] || 0); const rolls = Array.from({ length: n }, () => rand(s) + 1); const total = rolls.reduce((a, b) => a + b, 0) + k; return { content: [{ type: 'text', text: `${total} (${rolls.join(', ')}${k ? (k > 0 ? ' +' : ' ') + k : ''})` }], structuredContent: { total, rolls, modifier: k } }; } },
      { name: 'pick', description: 'Pick random items from a list.', inputSchema: { type: 'object', properties: { options: { type: 'array', items: { type: 'string' } }, count: { type: 'integer', default: 1 } }, required: ['options'] },
        handler: ({ options, count = 1 }) => { const a = [...options]; const out = []; while (a.length && out.length < count) out.push(a.splice(rand(a.length), 1)[0]); return out.join('\n'); } },
      { name: 'shuffle', description: 'Shuffle a list.', inputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
        handler: ({ items }) => { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.join('\n'); } },
      { name: 'uuid', description: 'Generate random UUIDs.', inputSchema: { type: 'object', properties: { count: { type: 'integer', default: 1 } } },
        handler: ({ count = 1 }) => Array.from({ length: Math.min(count, 50) }, () => crypto.randomUUID()).join('\n') },
    ] },
];

export const contentText = (result) => (result?.content || []).map(b => b.type === 'text' ? b.text : b.type === 'image' ? `[image ${b.mimeType}]` : b.type === 'resource' ? (b.resource?.text || `[resource ${b.resource?.uri}]`) : b.type === 'resource_link' ? `[link ${b.uri}]` : JSON.stringify(b)).join('\n');
