# DARLE

A language model behind a verifier. The model writes; DARLE decides what is allowed to stand.

## Requirements
- Answers must be checkable: typed output, exact arithmetic, claims tested against stored facts.
- Cost: anything provable from memory or computable never calls the model.
- Any OpenAI-compatible model server can be attached. None is required to run.

## Flow
```
message -> arithmetic? --yes--> calculator
              | no
        parse + memory --answered--> reply (0 tokens)
              | miss
        workload classification -> eligible model (when configured)
              | structured extraction -> Needle adapter (when explicitly configured)
              | supported puzzle -> TRM (not yet integrated)
              | general language -> LLM
              v
        schema/policy/evidence validation -> reply or abstain
```
Only user statements are written to memory (hyperdimensional vectors, see `src/darle.ts`).

## Multi-model direction

- **Needle**: compact structured action and extraction specialist.
- **Tiny Recursive Models (TRM)**: a recursive solver for supported structured domains such as grid/puzzle tasks. It is not a general chat or code-reasoning model.
- **General LLM**: optional language generation and broad software discussion.
- **DARLE control plane**: deterministic routing, memory provenance, exact operations, authorization, and verification; it is software, not another neural model.

The conservative task-shape classifier is in `src/model-routing.ts`; `src/model-registry.ts` selects only explicitly available, capability-matched providers and provides a transparent general-model fallback. The current agent uses this registry for its configured language-model route and optional Needle structured-extraction route, and records when a specialist is unavailable. Tests are in `test/model-routing.test.ts` and `test/model-registry.test.ts`. The registry does not load models. A typed Node client (`src/needle-client.ts`) and private Python sidecar (`services/needle_adapter.py`, pinned `cactus-needle==3.0.1`) now define a non-executing Needle inference boundary, and the Agent now invokes it for bounded structured extraction when `NEEDLE_BASE_URL` is configured. The Agent validates returned data against the DARLE turn schema and rejects unsupported arithmetic or malformed results. The sidecar is still not deployed or tested against weights. TRM inference, browser runtime support, training, and benchmark validation are not yet implemented. See [docs/multimodel-topology.md](docs/multimodel-topology.md), [docs/needle-architecture.md](docs/needle-architecture.md), and [docs/verified-change-loop.md](docs/verified-change-loop.md).

Upstream projects:
- Needle: https://github.com/cactus-compute/needle
- TRM: https://github.com/SamsungSAILMontreal/TinyRecursiveModels

## API
- `GET /healthz`
- `GET /api/state?session=ID` -> `{stats, bits, llm}`
- `POST /api/chat {session, text}` -> `{reply:{text, route, claims, proof, notes, tokens}, stats, bits}`

Session IDs match `[\w-]{8,64}`. 64 live sessions, 20 minute idle timeout, 40 requests per minute per IP.

## Trade-offs
- Rule-based parsing covers few sentence forms; everything else goes to the model and is only verified where claims fit DARLE's relation forms.
- Memory is RAM only. A restart clears it.
- `response_format: json_schema` support depends on the model server. Output is re-validated regardless.
- TRM is domain-specific. Recursive computation alone does not establish general reasoning ability.

## Deploy checklist
- [ ] `npm test` green, `npm run build` succeeds
- [ ] Render: Web Service, Node, build `npm install --include=dev && npm run build`, start `node dist/server.js`, health `/healthz`, `NODE_VERSION=22`
- [ ] `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` set in Render (never committed)
- [ ] Verify live interface, API, latency, logs, and security headers
- [ ] Rollback plan tested

## Run locally
`npm install --include=dev && npm test && npm run build && PORT=8080 npm start`
