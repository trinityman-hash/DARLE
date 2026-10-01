# DARLE + Needle: integration and model research plan

Status: adapter contract implemented and CI-validated; Agent integration remains a proposal. No Needle weights are vendored, trained, or deployed.

## Decision

Use Cactus Compute's Needle as an optional, local structured-action specialist, not as DARLE's source of truth and not as a drop-in general chat model. The upstream project describes Needle as a compact tool-calling, structured-extraction, and embedding model. The upstream API is Python-first (`needle.Needle`); DARLE is a TypeScript/Node application. This language/runtime boundary must be explicit.

Upstream: https://github.com/cactus-compute/needle

Before choosing a checkpoint, pin an exact upstream commit, model generation, weight artifact hash, engine build, and license text. "14 MB" is an artifact-size claim, not a measure of capability, RAM, latency, or quality. Needle 2 and Needle 3 are distinct generations; do not silently substitute one for the other.

## Responsibility boundaries

- DARLE orchestrator: task policy, user/session scope, tool allow-list, budgets, retries, cancellation, and final response composition.
- Needle: propose a structured action or extract fields from a supplied input. It is an untrusted planner. It does not receive credentials and must not directly execute tools.
- Existing chat LLM: optional language generation for requests outside Needle's tested task envelope. It is also untrusted.
- DARLE memory: stores only explicitly accepted user facts with source/session provenance. Model outputs and tool outputs do not become user facts automatically.
- Exact engine: executes a deliberately small arithmetic grammar. Never evaluate model-produced code or arbitrary expressions.
- Verifier: returns supported, contradicted, or unknown relative to explicit evidence. "Supported" means supported by the available DARLE evidence, not universally true.

## Proposed request lifecycle

1. Normalize input while preserving the original text for display and audit.
2. Run deterministic routes first: exact arithmetic and currently supported memory queries.
3. If the request needs structured action selection or extraction, call the local Needle adapter with only the minimum task context and a fixed, versioned tool schema.
4. Validate the response against a closed schema: known action name, exact argument keys/types, size limits, and no additional properties.
5. Apply policy outside the model: authorize the action for this session/user, require confirmation for consequential or external actions, and enforce per-turn tool and time budgets.
6. Execute only approved application-owned functions. Return bounded, typed results to DARLE.
7. Verify any checkable result against the tool result and memory evidence. Keep tool provenance distinct from user-stated facts.
8. If Needle abstains, has low/uncalibrated confidence, emits invalid output, or proposes an unavailable action, do not guess. Fall back to the configured chat LLM when policy allows, otherwise explain the limitation.
9. Record a privacy-minimized trace: model/checkpoint version, schema version, selected route, validation result, tool name, latency, and outcome. Do not log raw prompts, secrets, or private tool payloads by default.

## Adapter contract

Run Needle in a separate process/service from the Node web server. The Node application should communicate over a loopback-only HTTP endpoint or authenticated private network endpoint. Do not expose a raw Needle port publicly.

Suggested versioned interface:

- `GET /healthz` -> `{ "status": "ready", "model": "pinned-id", "schema_version": 1 }`
- `POST /v1/plan` request -> `{ "request_id": "...", "text": "...", "context": { "facts": [] }, "tools": [] }`
- Response -> `{ "request_id": "...", "action": { "name": "...", "arguments": {} } | null, "confidence": number | null, "model": "...", "latency_ms": number }`

The adapter must not accept executable tool implementations from the caller. Tool schemas are configured server-side and versioned. The Node side revalidates all fields even if Needle uses constrained decoding. Reject oversized bodies, unknown fields, non-finite confidence, unknown tool names, invalid arguments, stale request IDs, and timeouts. A model-provided confidence score is a routing signal only; it is not proof of factual correctness.

## Model direction: DARLE-specific research, not a renamed checkpoint

A defensible DARLE-specific model contribution would be an evidence-conditioned action/retrieval model trained to produce *typed, provenance-bearing hypotheses* for DARLE's memory and tool ecosystem. It should learn to distinguish:
- a user assertion from a retrieved fact, a tool observation, and a model inference;
- evidence that entails a claim from evidence that merely co-occurs with it;
- contradiction from missing evidence;
- an executable action from a request that requires clarification or abstention;
- stable knowledge from time-sensitive claims requiring a fresh source.

A practical first experiment is a compact learned router/retriever, not a new general-purpose foundation model. Inputs: query, typed candidate facts with provenance, tool schemas, and explicit policy flags. Outputs: ranked fact IDs, a typed action proposal or abstention, and a calibrated uncertainty estimate. Evidence text should be referenced by IDs rather than regenerated. The final verifier remains deterministic and independent.

Do not call this a new architecture until there is a written mathematical specification, implementation, ablations, independent baselines, and reproducible evidence that the contribution improves a defined task. Needle's upstream architecture and weights remain upstream work; fine-tuning them on DARLE data is adaptation, not authorship of a new foundation model.

## Data and training requirements

- Build a versioned dataset from synthetic cases, licensed public task data, and explicitly consented product interactions. Keep personal or secret user data out unless a documented lawful basis, minimization, retention, and deletion path exist.
- Include positive, negative, ambiguous, adversarial, out-of-domain, contradictory, stale-evidence, and abstention examples.
- Split by source/template/entity and time where applicable to prevent leakage. Keep a locked test set unavailable to training and prompt iteration.
- Store labels for action, arguments, evidence IDs, provenance class, contradiction status, and whether abstention/confirmation is required.
- Train/evaluate a small adapter first. Only pursue architecture changes if measured bottlenecks cannot be addressed by data, retrieval, calibration, or systems design.
- Pin training code, tokenizer, base weights, dataset manifests, random seeds, environment, and artifact hashes. Publish model card, limitations, intended use, and license compatibility.

## Evaluation gates

Compare at minimum: current DARLE rules only; Needle unadapted; Needle adapted; existing LLM; and hybrid DARLE+Needle. Report per-task results and confidence intervals, not one aggregate score.

Required metrics:
- exact tool/action match and exact argument match;
- extraction field-level precision/recall/F1;
- evidence retrieval recall@k and provenance accuracy;
- unsupported-claim rate and contradiction detection precision/recall;
- selective risk versus coverage for abstention thresholds;
- calibration (ECE/Brier score) on held-out data;
- end-to-end task success, p50/p95 latency, peak RAM, model artifact size, CPU usage, and failure rate;
- prompt injection/tool misuse success rate, unauthorized action rate (target zero), cross-session leakage (target zero), and sensitive-data exposure (target zero).

Pre-register acceptance thresholds before tuning. Require zero unauthorized tool execution in the security test suite, no cross-session memory access, and explicit abstention when evidence is insufficient. Benchmark on the actual Render plan and at least one target local device; do not infer production performance from upstream marketing claims.

## Deployment and operations

Needle's Python package/runtime is a separate dependency and may download its engine or weights on first use depending on deployment. Pin versions and hashes, build/cache artifacts during controlled deployment, disable telemetry unless explicitly reviewed and opted into, and test cold-start/offline behavior. Never download unpinned executable artifacts dynamically in a user request path.

Use a bounded worker queue, request deadline, concurrency cap, health/readiness checks, restart policy, and circuit breaker. If Needle is unavailable, deterministic DARLE routes continue; optional LLM fallback follows explicit policy. Keep model service private and secrets outside source control.

## Implemented adapter slice and remaining limitations

The repository now contains a Python sidecar (`services/needle_adapter.py`) with `POST /v1/complete` and `POST /v1/extract`, plus a typed Node client (`src/needle-client.ts`). The sidecar uses an initialized `needle.Needle` instance, requires a local weight file and matching SHA-256 before startup, disables Needle telemetry through documented environment flags, serializes inference, bounds request sizes, and does not register or execute tools. Schema validation has focused standard-library unit tests. A CI workflow runs TypeScript tests, type-check, build, Python syntax compilation, and sidecar schema tests.

The adapter is a contract boundary, not a complete product integration: the Agent does not call it, no Needle weights or engine artifact are included, and the sidecar has not been exercised against a real model artifact in this work session. The current core still has rule-based parsing, hyperdimensional fact memory, exact arithmetic, and an OpenAI-compatible LLM client; it has no trained DARLE-specific neural weights, persistent per-user store, or independent security audit. Do not wire model-proposed actions to real side effects until authorization, confirmation, and end-to-end security tests are implemented.
