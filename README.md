# Patchbay

An MCP playground styled like a modular synth. Patch servers into an agent with cables.

- **Rack**: six built-in servers (notes, web, math, clock, sketch, dice) that run in the page, plus any remote MCP server you add by URL (Streamable HTTP, optional auth headers).
- **Inspect**: every tool, resource and prompt, with forms generated from each tool's JSON schema, raw JSON editing, results, and "Copy as curl" for remote servers.
- **Chain**: pipe tools together with `{{step1}}`, `{{step1.num}}` or `{{step1.json.field}}`. Save and replay chains.
- **Agent**: Claude gets every patched tool and a goal; each call flashes its server and shows arguments and results. The sketch server draws on a live canvas.
- **Traffic monitor**: every JSON-RPC request and response with timings. Click a row for the full payload.

Inspect and Chain work with no API key. Agent mode needs `ANTHROPIC_API_KEY` (or a key pasted in Settings).

## Run locally
```bash
cp .env.example .env.local
node dev-server.mjs   # http://localhost:3000
```

## Deploy
```bash
vercel --prod
vercel env add ANTHROPIC_API_KEY
```

## API routes
- `api/ai.js`: Claude Messages proxy (key stays server-side, optional ACCESS_CODE gate)
- `api/mcp.js`: relays JSON-RPC to remote MCP servers that don't allow browser CORS; handles SSE replies and `mcp-session-id`
- `api/fetch.js`: readable-text fetcher used by the built-in web server

The relays refuse private and localhost addresses. To test a local MCP server, run `node dev-server.mjs` and remove the PRIVATE check in `api/mcp.js` on your machine only.
