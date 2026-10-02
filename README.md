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
        structured request? -> Needle 2 (typed specialist)
              | otherwise / fallback
        recall known facts -> language model (JSON schema, temperature 0)
              |                       |
              |         invalid shape -> re-ask (max 4 tries total)
              |         calc requested -> exact evaluator -> back to model
              |         claims -> verifier -> conflict -> back to model with evidence
              v
        verified / unverified / declined reply + trace
```
Only user statements are written to memory (hyperdimensional vectors, see `src/darle.ts`).

## API
- `GET /healthz`
- `GET /api/state?session=ID` -> `{stats, bits, llm, needle}`
- `POST /api/chat {session, text}` -> `{reply:{text, route, claims, proof, notes, tokens}, stats, bits}`

Session IDs match `[\w-]{8,64}`. 64 live sessions, 20 minute idle timeout, 40 requests per minute per IP.

## Trade-offs
- Rule-based parsing covers few sentence forms; everything else goes to the model and is only verified where claims fit DARLE's relation forms.
- Memory is RAM only. A restart clears it.
- `response_format: json_schema` support depends on the model server. Output is re-validated regardless.

## Revisit as it grows
Persistence, a larger relation vocabulary, streaming replies, per-user auth, real rate limiting at the edge.

## Deploy checklist
- [ ] `npm test` green, `npm run build` succeeds
- [ ] Render: deploy from `main` using the repository Dockerfile; health `/healthz`.
- [ ] Needle 2 is packaged in the container; its native inference engine is fetched from the model host on first initialization. Confirm `/api/state` reports `needle.ready: true` before treating it as online.
- [ ] Set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` in Render if a separate language model is desired (never commit secrets). `NEEDLE_TELEMETRY=0` is set by the Dockerfile.
- [ ] Open the site: header says `server connected`, ask `Is a whale an animal?`, then `What is 1234 * 5678?`
- [ ] Watch logs 15 minutes: `route` mix, `ms`, no 5xx
- [ ] Rollback: Render, Deploys, previous deploy, Rollback. Trigger: health check failing, or 5xx on `/api/chat`

## Run locally
`npm install --include=dev && npm test && npm run build && PORT=8080 npm start`
