# DARLE
Hyperdimensional fact memory + multi-hop reasoner + claim verifier. No neural network.

## Render
1. Service type: **Web Service**. Language: **Node**.
2. Build: `npm install --include=dev && npm run build`
3. Start: `node dist/server.js`
4. Health check path: `/healthz`. Env var `NODE_VERSION` = `22`.

## Anywhere with Node 22+
`npm install --include=dev && npm test && npm run build && PORT=8080 npm start`

The page uses the server (`/api/state`, `POST /api/chat`) when it exists and falls back to running the engine in the browser if not (e.g. static hosting).
Memory lives in RAM: a restart or free-tier sleep clears what visitors taught it.
