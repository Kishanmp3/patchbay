import { bus, LocalServer, RemoteServer, BUILTINS, contentText } from './mcp.js';
import { claude, aiStatus, settings } from './ai-client.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const toast = (t) => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2800); };
const PALETTE = ['#9C27B0', '#00ACC1', '#FF9800', '#795548', '#607D8B', '#C0CA33', '#D81B60', '#5E35B1'];
const md = (s) => { const blocks = []; s = String(s || '').replace(/```\w*\n?([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre>${esc(c)}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  return s.split(/\n{2,}/).map(p => p.match(/^\u0000\d+\u0000$/) ? p : `<p>${esc(p).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</p>`).join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]); };

/* ---------- sketch canvas ---------- */
const cv = $('#sketch'), g = cv.getContext('2d');
const sketch = {
  clear(bg = '#F4F1E8') { g.fillStyle = bg; g.fillRect(0, 0, 800, 500); },
  shape({ shape, x, y, w = 100, h = 100, r = 50, x2, y2, color = '#1D1D1B', fill = true, stroke_width = 4 }) {
    g.fillStyle = g.strokeStyle = color; g.lineWidth = stroke_width; g.lineCap = 'round'; g.beginPath();
    if (shape === 'circle') g.arc(x, y, r, 0, Math.PI * 2);
    else if (shape === 'rect') g.rect(x, y, w, h);
    else if (shape === 'line') { g.moveTo(x, y); g.lineTo(x2 ?? x + w, y2 ?? y + h); g.stroke(); return; }
    else if (shape === 'triangle') { g.moveTo(x + w / 2, y); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); }
    else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }
    fill ? g.fill() : g.stroke();
  },
  text({ text, x, y, size = 32, color = '#1D1D1B' }) { g.fillStyle = color; g.font = `700 ${size}px "Barlow Condensed", sans-serif`; g.fillText(text, x, y); },
};
sketch.clear();
$('#sketchClear').onclick = () => sketch.clear();

/* ---------- servers ---------- */
const ctx = { sketch };
const state = { servers: [], sel: null, sub: 'tools', item: null, enabled: LS.get('pb.enabled', {}) };
const isOn = (s) => state.enabled[s.id] !== false;
function addLocal(def) { const s = new LocalServer({ id: def.id, name: def.name, color: def.color, def, ctx }); state.servers.push(s); return s.connect(); }
function addRemote(cfg) { const s = new RemoteServer({ ...cfg, ctx }); state.servers.push(s); return s.connect(); }
const saveRemotes = () => LS.set('pb.remotes', state.servers.filter(s => s.kind === 'remote').map(({ id, name, url, headers, color }) => ({ id, name, url, headers, color })));
const byId = (id) => state.servers.find(s => s.id === id);

function renderRack() {
  $('#servers').innerHTML = state.servers.map(s => `
    <li class="srv ${s.id === state.sel ? 'sel' : ''}" style="--col:${s.color}" data-id="${esc(s.id)}" tabindex="0">
      <span class="jack"></span>
      <span><b>${esc(s.info?.name || s.name)}</b><small>${s.kind === 'local' ? 'Built-in' : esc(new URL(s.url).host)}, ${s.tools.length} tools</small></span>
      <span class="led ${isOn(s) ? s.status : 'off'}" title="${esc(s.error || s.status)}"></span>
      <span class="tog"><span>Patched into agent</span><span>${s.kind === 'remote' ? `<button class="rm" data-rm="${esc(s.id)}">Remove</button> ` : ''}<button class="switch" role="switch" aria-checked="${isOn(s)}" aria-label="Patch ${esc(s.name)} into the agent" data-tog="${esc(s.id)}"></button></span></span>
    </li>`).join('');
  $('#monFilter').innerHTML = '<option value="">All servers</option>' + state.servers.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  renderPatchList();
}
$('#servers').addEventListener('click', (e) => {
  const tog = e.target.closest('[data-tog]'); const rm = e.target.closest('[data-rm]');
  if (tog) { e.stopPropagation(); const s = byId(tog.dataset.tog); state.enabled[s.id] = !isOn(s); LS.set('pb.enabled', state.enabled); renderRack(); return; }
  if (rm) { e.stopPropagation(); state.servers = state.servers.filter(s => s.id !== rm.dataset.rm); saveRemotes(); if (state.sel === rm.dataset.rm) state.sel = state.servers[0]?.id; renderRack(); renderInspect(); return; }
  const li = e.target.closest('.srv'); if (li) { state.sel = li.dataset.id; state.item = null; renderRack(); renderInspect(); if (location.hash !== '#inspect' && location.hash) location.hash = 'inspect'; }
});
$('#servers').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('srv')) e.target.click(); });
bus.addEventListener('status', () => { renderRack(); if (state.sel) renderInspect(); });
bus.addEventListener('call', (e) => { const li = $(`.srv[data-id="${CSS.escape(e.detail.server.id)}"]`); if (li) { li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash'); } });

/* ---------- inspect ---------- */
$$('#subtabs button').forEach(b => b.onclick = () => { state.sub = b.dataset.sub; state.item = null; renderInspect(); });
function renderInspect() {
  const s = byId(state.sel); if (!s) { $('#srvHead').innerHTML = '<h1>No server</h1>'; $('#itemList').innerHTML = ''; return; }
  $('#srvHead').innerHTML = `<div><h1 style="color:${s.color}">${esc(s.info?.name || s.name)}</h1><p>${s.status === 'error' ? `<span class="err">Couldn't connect: ${esc(s.error)}</span>` : esc(s.instructions || (s.kind === 'local' ? 'Built-in server running in this page.' : s.url))}</p></div>
    <div class="row-end"><span class="silk">${s.kind === 'local' ? 'In-page' : 'Streamable HTTP'}${s.info?.version ? ', v' + esc(s.info.version) : ''}${s.protocolVersion ? ', protocol ' + esc(s.protocolVersion) : ''}</span><button class="btn small" id="reconnect">Reconnect</button></div>`;
  $('#reconnect').onclick = async () => { await s.connect(); toast(s.status === 'ready' ? 'Reconnected' : 'Still failing'); };
  const counts = { tools: s.tools.length, resources: s.resources.length, prompts: s.prompts.length };
  $$('#subtabs button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.sub === state.sub); b.innerHTML = `${b.dataset.sub[0].toUpperCase() + b.dataset.sub.slice(1)}<span>${counts[b.dataset.sub]}</span>`; });
  const items = s[state.sub];
  const key = (it) => it.uri || it.name;
  $('#itemList').innerHTML = items.length ? items.map(it => `<li><button data-k="${esc(key(it))}" ${state.item === key(it) ? 'aria-current="true"' : ''}><b>${esc(it.name || it.uri)}</b><span>${esc(it.description || it.uri || '')}</span></button></li>`).join('') : `<li class="empty">This server has no ${state.sub}.</li>`;
  $$('#itemList button').forEach(b => b.onclick = () => { state.item = b.dataset.k; renderInspect(); });
  if (!state.item && items[0]) { state.item = key(items[0]); return renderInspect(); }
  const it = items.find(x => key(x) === state.item);
  if (!it) { $('#pane').innerHTML = '<div class="empty">Pick something on the left.</div>'; return; }
  if (state.sub === 'tools') renderToolPane(s, it);
  else if (state.sub === 'resources') renderResourcePane(s, it);
  else renderPromptPane(s, it);
}

function fieldFor(name, sch, req) {
  const id = 'f_' + name; const t = Array.isArray(sch.type) ? sch.type.find(x => x !== 'null') : sch.type;
  const label = `<label for="${id}"><span>${esc(name)}${req ? ' <span class="req">*</span>' : ''}</span><em>${esc(t || 'any')}</em></label>`;
  const help = sch.description ? `<small>${esc(sch.description)}</small>` : '';
  const def = sch.default;
  let input;
  if (sch.enum) input = `<select id="${id}" data-name="${esc(name)}" data-type="enum">${req ? '' : '<option value="">(none)</option>'}${sch.enum.map(v => `<option ${v === def ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  else if (t === 'boolean') input = `<input type="checkbox" id="${id}" data-name="${esc(name)}" data-type="boolean" ${def ? 'checked' : ''}>`;
  else if (t === 'number' || t === 'integer') input = `<input type="number" id="${id}" data-name="${esc(name)}" data-type="number" step="${t === 'integer' ? 1 : 'any'}" ${def != null ? `placeholder="${esc(def)}"` : ''}>`;
  else if (t === 'array' && ['string', 'number', 'integer'].includes(sch.items?.type)) input = `<textarea id="${id}" rows="3" data-name="${esc(name)}" data-type="list" data-item="${sch.items.type}" placeholder="One per line"></textarea>`;
  else if (t === 'object' || t === 'array' || !t) input = `<textarea id="${id}" rows="4" data-name="${esc(name)}" data-type="json" placeholder="${t === 'array' ? '[ ]' : '{ }'}"></textarea>`;
  else input = (sch.description?.length > 80 || /body|content|text|query|prompt|code/i.test(name)) ? `<textarea id="${id}" rows="3" data-name="${esc(name)}" data-type="string" placeholder="${esc(def ?? '')}"></textarea>` : `<input id="${id}" data-name="${esc(name)}" data-type="string" placeholder="${esc(def ?? '')}">`;
  return `<div class="field">${label}${input}${help}</div>`;
}
function readForm(root) {
  const args = {};
  for (const el of $$('[data-name]', root)) {
    const n = el.dataset.name, t = el.dataset.type;
    if (t === 'boolean') { if (el.checked) args[n] = true; continue; }
    const v = el.value.trim(); if (!v) continue;
    if (t === 'number') args[n] = Number(v);
    else if (t === 'list') args[n] = v.split(/\n|,/).map(x => x.trim()).filter(Boolean).map(x => el.dataset.item === 'string' ? x : Number(x));
    else if (t === 'json') { try { args[n] = JSON.parse(v); } catch { throw new Error(`"${n}" isn't valid JSON`); } }
    else args[n] = v;
  }
  return args;
}
function resultHTML(res, ms, isErr) {
  const blocks = (res?.content || []).map(b => b.type === 'image' ? `<img alt="" src="data:${esc(b.mimeType)};base64,${esc(b.data)}">` : `<pre>${esc(b.type === 'text' ? b.text : JSON.stringify(b, null, 2))}</pre>`).join('') || `<pre>${esc(JSON.stringify(res, null, 2))}</pre>`;
  return `<div class="result ${isErr || res?.isError ? 'err' : ''}"><div class="rh"><span>${isErr || res?.isError ? 'Tool error' : 'Result'}</span><span>${ms != null ? ms.toFixed(0) + ' ms' : ''}</span></div>${blocks}</div>`;
}
function renderToolPane(s, tool) {
  const sch = tool.inputSchema || { type: 'object', properties: {} };
  const props = sch.properties || {}; const req = new Set(sch.required || []);
  $('#pane').innerHTML = `<h2>${esc(tool.name)}</h2><p class="desc">${esc(tool.description || 'No description.')}</p>
    <div class="form" id="form">${Object.keys(props).length ? Object.entries(props).map(([k, v]) => fieldFor(k, v, req.has(k))).join('') : '<p class="field"><small>This tool takes no arguments.</small></p>'}</div>
    <textarea class="json-edit" id="rawArgs" rows="8" hidden></textarea>
    <div class="pane-actions"><button class="btn go" id="runTool">Call tool</button><button class="btn small" id="rawToggle">Edit as JSON</button><button class="btn small" id="toChain">Add to chain</button><span class="spacer"></span>${s.kind === 'remote' ? '<button class="btn small" id="copyCurl">Copy as curl</button>' : ''}</div>
    <div id="out"></div>
    <details class="schema"><summary>Input schema</summary><pre>${esc(JSON.stringify(sch, null, 2))}</pre></details>`;
  let raw = false;
  const getArgs = () => raw ? JSON.parse($('#rawArgs').value || '{}') : readForm($('#form'));
  $('#rawToggle').onclick = () => { try { if (!raw) { $('#rawArgs').value = JSON.stringify(readForm($('#form')), null, 2); } raw = !raw; $('#rawArgs').hidden = !raw; $('#form').hidden = raw; $('#rawToggle').textContent = raw ? 'Use the form' : 'Edit as JSON'; } catch (e) { toast(e.message); } };
  $('#runTool').onclick = async () => {
    let args; try { args = getArgs(); } catch (e) { toast(e.message); return; }
    const miss = [...req].filter(k => args[k] === undefined); if (miss.length) { toast(`Fill in ${miss.join(', ')}`); return; }
    $('#runTool').disabled = true; const t0 = performance.now();
    try { const r = await s.callTool(tool.name, args); $('#out').innerHTML = resultHTML(r, performance.now() - t0); }
    catch (e) { $('#out').innerHTML = resultHTML({ content: [{ type: 'text', text: e.message }] }, performance.now() - t0, true); }
    $('#runTool').disabled = false;
  };
  $('#toChain').onclick = () => { let args = {}; try { args = getArgs(); } catch {} chain.steps.push({ server: s.id, tool: tool.name, args: JSON.stringify(args, null, 2) }); renderChain(); toast(`Added ${tool.name} to the chain`); };
  $('#copyCurl')?.addEventListener('click', async () => { let args = {}; try { args = getArgs(); } catch {} const h = Object.entries(s.headers || {}).map(([k, v]) => ` \\\n  -H '${k}: ${v}'`).join('');
    const cmd = `curl -s '${s.url}' \\\n  -H 'content-type: application/json' \\\n  -H 'accept: application/json, text/event-stream'${s.sessionId ? ` \\\n  -H 'mcp-session-id: ${s.sessionId}'` : ''}${h} \\\n  -d '${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool.name, arguments: args } }).replace(/'/g, "'\\''")}'`;
    try { await navigator.clipboard.writeText(cmd); toast('curl command copied'); } catch { toast('Clipboard blocked'); } });
}
function renderResourcePane(s, r) {
  $('#pane').innerHTML = `<h2>${esc(r.name || r.uri)}</h2><p class="desc">${esc(r.description || r.uri)}${r.mimeType ? `\n${esc(r.mimeType)}` : ''}</p><div class="pane-actions"><button class="btn go" id="readRes">Read resource</button></div><div id="out"></div>`;
  $('#readRes').onclick = async () => { const t0 = performance.now(); try { const res = await s.readResource(r.uri); $('#out').innerHTML = resultHTML({ content: (res.contents || []).map(c => c.text != null ? { type: 'text', text: c.text } : { type: 'text', text: `[binary ${c.mimeType}, ${(c.blob || '').length} base64 chars]` }) }, performance.now() - t0); } catch (e) { $('#out').innerHTML = resultHTML({ content: [{ type: 'text', text: e.message }] }, 0, true); } };
}
function renderPromptPane(s, p) {
  $('#pane').innerHTML = `<h2>${esc(p.name)}</h2><p class="desc">${esc(p.description || '')}</p><div class="form" id="form">${(p.arguments || []).map(a => fieldFor(a.name, { type: 'string', description: a.description }, a.required)).join('')}</div><div class="pane-actions"><button class="btn go" id="getPrompt">Get prompt</button></div><div id="out"></div>`;
  $('#getPrompt').onclick = async () => { const t0 = performance.now(); try { const res = await s.getPrompt(p.name, readForm($('#form'))); $('#out').innerHTML = resultHTML({ content: (res.messages || []).map(m => ({ type: 'text', text: `${m.role}: ${m.content?.text ?? JSON.stringify(m.content)}` })) }, performance.now() - t0); } catch (e) { $('#out').innerHTML = resultHTML({ content: [{ type: 'text', text: e.message }] }, 0, true); } };
}

/* ---------- chain ---------- */
const SAMPLE_CHAIN = { name: 'Roll a character', steps: [
  { server: 'dice', tool: 'roll', args: '{\n  "notation": "4d6"\n}' },
  { server: 'math', tool: 'calculate', args: '{\n  "expression": "{{step1.json.total}} * 3"\n}' },
  { server: 'clock', tool: 'now', args: '{}' },
  { server: 'notes', tool: 'create_note', args: '{\n  "title": "Character",\n  "body": "Strength roll {{step1}}, power score {{step2}}, rolled {{step3}}"\n}' },
] };
let chains = LS.get('pb.chains', [SAMPLE_CHAIN]);
const chain = { name: chains[0]?.name || 'Untitled', steps: structuredClone(chains[0]?.steps || []) };
function renderChain() {
  $('#chainPick').innerHTML = chains.map((c, i) => `<option value="${i}" ${c.name === chain.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const opts = (sel) => state.servers.map(s => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  $('#steps').innerHTML = chain.steps.map((st, i) => { const s = byId(st.server); const col = s?.color || '#888';
    return `<div class="chain" style="--col:${col}" data-i="${i}"><div class="spine"><span class="jack"></span><span class="cable"></span></div>
      <div class="card"><div class="top"><b>Step ${i + 1}</b><select data-f="server" aria-label="Server">${opts(st.server)}</select><select data-f="tool" aria-label="Tool">${(s?.tools || []).map(t => `<option ${t.name === st.tool ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select><span><button class="btn tiny" data-up>Up</button> <button class="btn tiny" data-del>Remove</button></span></div>
      <textarea data-f="args" rows="${Math.min(8, (st.args || '').split('\n').length + 1)}" spellcheck="false" aria-label="Arguments">${esc(st.args)}</textarea>
      <div class="state" data-state></div><div data-out>${st.out || ''}</div></div></div>`; }).join('') || '<div class="empty">No steps yet. Add one, or send a tool here from Inspect.</div>';
  $$('#steps .chain').forEach(el => { const i = +el.dataset.i; const st = chain.steps[i];
    el.querySelector('[data-f=server]').onchange = (e) => { st.server = e.target.value; st.tool = byId(st.server)?.tools[0]?.name; renderChain(); };
    el.querySelector('[data-f=tool]').onchange = (e) => { st.tool = e.target.value; };
    el.querySelector('[data-f=args]').oninput = (e) => { st.args = e.target.value; };
    el.querySelector('[data-del]').onclick = () => { chain.steps.splice(i, 1); renderChain(); };
    el.querySelector('[data-up]').onclick = () => { if (i) { [chain.steps[i - 1], chain.steps[i]] = [chain.steps[i], chain.steps[i - 1]]; renderChain(); } };
  });
}
function fill(tpl, outs) {
  return tpl.replace(/\{\{\s*step(\d+)(\.num)?(?:\.json((?:\.[\w$]+|\[\d+\])*))?\s*\}\}/g, (_, n, num, path) => {
    const o = outs[+n - 1]; if (o == null) throw new Error(`step${n} hasn't run yet`);
    if (num) { const m = o.text.match(/-?\d+(\.\d+)?/); if (!m) throw new Error(`step${n} has no number in it`); return m[0]; }
    if (!path) return JSON.stringify(o.text).slice(1, -1);
    let v = o.json ?? (() => { try { return JSON.parse(o.text); } catch { throw new Error(`step${n} didn't return JSON`); } })();
    for (const k of path.match(/[\w$]+/g)) v = v?.[k];
    return typeof v === 'string' ? JSON.stringify(v).slice(1, -1) : JSON.stringify(v);
  });
}
$('#addStep').onclick = () => { const s = state.servers.find(s => s.status === 'ready'); chain.steps.push({ server: s?.id, tool: s?.tools[0]?.name, args: '{}' }); renderChain(); };
$('#chainNew').onclick = () => { chain.name = 'Untitled ' + (chains.length + 1); chain.steps = []; renderChain(); };
$('#chainPick').onchange = (e) => { const c = chains[+e.target.value]; chain.name = c.name; chain.steps = structuredClone(c.steps); renderChain(); };
$('#chainSave').onclick = () => { const name = chain.name.startsWith('Untitled') ? (chain.steps.map(s => s.tool).join(' → ').slice(0, 40) || chain.name) : chain.name; chain.name = name; const clean = chain.steps.map(({ out, ...s }) => s); const i = chains.findIndex(c => c.name === name); i >= 0 ? chains[i] = { name, steps: clean } : chains.push({ name, steps: clean }); LS.set('pb.chains', chains); renderChain(); toast(`Saved "${name}"`); };
$('#chainRun').onclick = async () => {
  $('#chainRun').disabled = true; const outs = []; const els = $$('#steps .chain');
  for (const st of chain.steps) st.out = '';
  for (let i = 0; i < chain.steps.length; i++) {
    const st = chain.steps[i], el = els[i], s = byId(st.server);
    const set = (h) => { st.out = h; el.querySelector('[data-out]').innerHTML = h; };
    el.querySelector('[data-state]').textContent = 'Running';
    const t0 = performance.now();
    try {
      if (!s) throw new Error('That server is no longer in the rack.');
      const args = JSON.parse(fill(st.args || '{}', outs));
      const r = await s.callTool(st.tool, args);
      outs.push({ text: contentText(r), json: r.structuredContent });
      set(resultHTML(r, performance.now() - t0)); el.querySelector('[data-state]').textContent = `Sent ${JSON.stringify(args).slice(0, 140)}`;
      if (r.isError) throw new Error('The tool reported an error. Stopping here.');
    } catch (e) { if (!st.out) set(resultHTML({ content: [{ type: 'text', text: e.message }] }, performance.now() - t0, true)); el.querySelector('[data-state]').textContent = 'Stopped'; toast(`Step ${i + 1} failed: ${e.message}`); break; }
  }
  $('#chainRun').disabled = false;
};

/* ---------- agent ---------- */
const IDEAS = ['Draw a sunset over mountains on the sketch canvas', 'How many days until New Year, and what time is it in Tokyo?', 'Fetch news.ycombinator.com and save the top 5 titles as a note', 'Roll 4d6 six times for D&D stats and give me the average', 'Draw a smiley face, then write my name under it: Kee'];
$('#ideas').innerHTML = IDEAS.map(i => `<button type="button">${esc(i)}</button>`).join('');
$$('#ideas button').forEach(b => b.onclick = () => { $('#goal').value = b.textContent; $('#goal').focus(); });
let convo = [];
const toolName = (s, t) => `${s.id}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
function agentTools() { const map = new Map(); for (const s of state.servers) if (isOn(s) && s.status === 'ready') for (const t of s.tools) map.set(toolName(s, t), { s, t }); return map; }
function renderPatchList() { const m = agentTools(); const per = {}; for (const { s } of m.values()) per[s.id] = (per[s.id] || 0) + 1;
  $('#patchList').innerHTML = `<div class="silk row-sp"><span>Patched in</span><span>${m.size} tools</span></div><ul>${Object.entries(per).map(([id, n]) => `<li style="--col:${byId(id).color}"><span><i></i>${esc(byId(id).name)}</span><span>${n}</span></li>`).join('') || '<li>Nothing patched. Flip a switch in the rack.</li>'}</ul>`; }
const logEl = $('#agentLog');
const add = (html, cls) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; logEl.querySelector('.empty')?.remove(); logEl.append(d); logEl.scrollTop = logEl.scrollHeight; return d; };
$('#agentReset').onclick = () => { convo = []; logEl.innerHTML = ''; add(`<div class="empty big"><h2>Fresh start</h2><p>New conversation. The rack is still patched.</p></div>`, ''); };
$('#goal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#askForm').requestSubmit(); });
$('#askForm').onsubmit = async (e) => {
  e.preventDefault(); const goal = $('#goal').value.trim() || $('#goal').placeholder; $('#goal').value = '';
  const st = await aiStatus(); if (!st.ready) { add(`<p><strong>The agent needs a Claude key.</strong> Add <code>ANTHROPIC_API_KEY</code> on the server, or paste your own key in Settings.</p>`, 'msg ai'); $('#dlgSettings').showModal(); return; }
  const tools = agentTools(); add(esc(goal), 'msg user'); convo.push({ role: 'user', content: goal });
  const defs = [...tools].map(([name, { s, t }]) => ({ name, description: `[${s.name}] ${t.description || ''}`.slice(0, 1024), input_schema: t.inputSchema?.type ? t.inputSchema : { type: 'object', properties: {} } }));
  const system = `You are an agent in Patchbay, an MCP playground. Use the available tools to accomplish the user's goal. Prefer tools over guessing for math, dates and web content. The sketch canvas is 800x500, origin top-left; build drawings from many shapes and pick pleasing colors. When done, reply with a short summary of what you did.`;
  $('#agentGo').disabled = true; const max = Math.max(1, Math.min(30, +$('#maxTurns').value || 12));
  try {
    for (let turn = 0; turn < max; turn++) {
      const think = add('Thinking', 'thinking');
      const res = await claude({ system, messages: convo, tools: defs, max_tokens: 4096 });
      think.remove();
      convo.push({ role: 'assistant', content: res.content });
      for (const b of res.content) if (b.type === 'text' && b.text.trim()) add(md(b.text), 'msg ai');
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses) {
        const hit = tools.get(u.name);
        const card = add(`<div class="h"><b>${esc(hit ? `${hit.s.name}.${hit.t.name}` : u.name)}</b><span>calling</span></div><pre>${esc(JSON.stringify(u.input, null, 2))}</pre>`, 'call');
        card.style.setProperty('--col', hit?.s.color || '#888');
        const t0 = performance.now(); let text, isErr = false;
        try { if (!hit) throw new Error(`Unknown tool ${u.name}`); const r = await hit.s.callTool(hit.t.name, u.input); text = contentText(r) || '(empty result)'; isErr = !!r.isError; }
        catch (err) { text = err.message; isErr = true; }
        card.querySelector('.h span').textContent = `${(performance.now() - t0).toFixed(0)} ms`; if (isErr) card.classList.add('err');
        card.insertAdjacentHTML('beforeend', `<pre class="res">${esc(text.slice(0, 1500))}${text.length > 1500 ? '\n…' : ''}</pre>`);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: text.slice(0, 20000), is_error: isErr });
        logEl.scrollTop = logEl.scrollHeight;
      }
      convo.push({ role: 'user', content: results });
      if (turn === max - 1) add(`<p>Stopped after ${max} turns. Raise Max turns to let it keep going.</p>`, 'msg ai');
    }
  } catch (err) { $$('.thinking', logEl).forEach(t => t.remove()); add(`<p><strong>Agent error:</strong> ${esc(err.message)}</p>`, 'msg ai'); if (convo.at(-1)?.role === 'user' && typeof convo.at(-1).content === 'string') convo.pop(); }
  $('#agentGo').disabled = false;
};

/* ---------- monitor ---------- */
const mon = $('#mon'); let monFilter = '';
bus.addEventListener('traffic', (e) => {
  const d = e.detail; const li = document.createElement('li');
  li.className = `${d.dir} ${d.error ? 'err' : ''}`; li.dataset.srv = d.server.id; li.style.setProperty('--col', d.server.color);
  const summary = (d.payload.params?.name ? `${d.method} ${d.payload.params.name}` : d.method) + (d.dir === 'in' ? (d.error ? ' failed' : ' ok') : '');
  li.innerHTML = `<div class="l1"><span class="dir">${d.dir === 'out' ? '→' : '←'}</span><span class="srvn">${esc(d.server.name)}</span><span>${esc(summary)}</span><span class="ms">${d.ms != null ? d.ms.toFixed(0) + ' ms' : new Date(d.at).toLocaleTimeString()}</span></div><pre>${esc(JSON.stringify(d.payload, null, 2).slice(0, 8000))}</pre>`;
  li.onclick = () => li.classList.toggle('open');
  if (monFilter && monFilter !== d.server.id) li.hidden = true;
  mon.prepend(li); while (mon.children.length > 400) mon.lastChild.remove();
});
$('#monClear').onclick = () => { mon.innerHTML = ''; };
$('#monFilter').onchange = (e) => { monFilter = e.target.value; $$('li', mon).forEach(li => li.hidden = !!monFilter && li.dataset.srv !== monFilter); };
$('#toggleMon').onclick = () => { const wide = innerWidth > 1200; const sh = $('#shell'); if (wide) sh.classList.toggle('nomon'); else sh.classList.toggle('mon-open'); $('#toggleMon').setAttribute('aria-pressed', wide ? !sh.classList.contains('nomon') : sh.classList.contains('mon-open')); };

/* ---------- dialogs ---------- */
$('#addServer').onclick = () => { $('#serverForm').reset(); $('#dlgServer').showModal(); };
$$('[data-try]').forEach(b => b.onclick = () => { const [n, u] = b.dataset.try.split('|'); $('#fsName').value = n; $('#fsUrl').value = u; });
$('#serverForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  const name = $('#fsName').value.trim(), url = $('#fsUrl').value.trim();
  const headers = Object.fromEntries($('#fsHeaders').value.split('\n').map(l => l.split(':')).filter(p => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 5);
  const color = PALETTE[state.servers.filter(s => s.kind === 'remote').length % PALETTE.length];
  state.sel = id; const p = addRemote({ id, name, url, headers, color }); saveRemotes(); renderRack(); renderInspect();
  await p; toast(byId(id).status === 'ready' ? `${name} connected, ${byId(id).tools.length} tools` : `${name} didn't connect. See the rack for details.`); location.hash = 'inspect';
});
$('#openSettings').onclick = () => { $('#sKey').value = settings.key; $('#sCode').value = settings.code; $('#sModel').value = settings.model; $('#dlgSettings').showModal(); };
$('#sSave').onclick = () => { settings.key = $('#sKey').value.trim(); settings.code = $('#sCode').value.trim(); settings.model = $('#sModel').value.trim(); refreshAI(); toast('Settings saved'); };
async function refreshAI() { const s = await aiStatus(); const p = $('#aiPill'); p.classList.toggle('on', s.ready); p.textContent = s.ready ? 'Agent ready' : 'Agent needs a key'; }

/* ---------- routing ---------- */
const views = ['inspect', 'chain', 'agent'];
function route() { const v = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inspect'; for (const n of views) $('#view-' + n).hidden = n !== v; $$('.tabs a').forEach(a => a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')); if (v === 'chain') renderChain(); if (v === 'agent') renderPatchList(); }
addEventListener('hashchange', route);

/* ---------- boot ---------- */
route(); refreshAI();
const boots = BUILTINS.map(addLocal);
for (const r of LS.get('pb.remotes', [])) boots.push(addRemote(r));
state.sel = state.servers[0].id; renderRack(); renderInspect();
await Promise.all(boots); renderRack(); renderInspect(); renderChain();
