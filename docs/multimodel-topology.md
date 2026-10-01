# DARLE multi-model execution topology

Status: partial implementation. DARLE has a conservative classifier, capability-aware registry, typed Needle HTTP client, and a private Python sidecar. The sidecar is not yet wired into the Agent or deployed, and no model artifact is included.

## Grounded reading of the proposed stack

Needle and Tiny Recursive Models (TRM) solve different kinds of problems. The current upstream Needle 3 package (cactus-needle 3.0.1, Apache-2.0) documents a compact structured tool-use/extraction/embedding model, with platform engines and fine-tuning paths. The upstream README describes an 8–29 MB model family, so a specific 14 MB artifact must be pinned rather than treating that size as universal. TRM is a small recurrent refinement network trained for constrained reasoning domains such as ARC-style grids, Sudoku, and mazes. TRM is not a drop-in natural-language chain-of-thought model or a general code-generation model. The upstream repository reports a 7M-parameter model and task-specific results; those results do not establish software-engineering or open-domain reasoning ability. Upstream repo: https://github.com/SamsungSAILMontreal/TinyRecursiveModels (MIT license per upstream repository).

The repository is archived/read-only per its README. Pin a reviewed commit and license, vendor only the minimum required source with attribution, and isolate its training dependencies from DARLE's Node deployment. Reproduction is a gate before adaptation.

## Proposed 2 + 3 compute topology

Treat "2 + 3" as five execution roles, not five newly invented neural models:

### Server-side (2 roles)
1. **Training/teacher role:** an optional stronger model used only for approved training-data assistance or difficult tasks where the user explicitly permits source/context transfer. Teacher output is untrusted and needs tests/review.
2. **Training/evaluation role:** controlled GPU/CPU jobs for fine-tuning, benchmarking, artifact validation, signing, and release. This is compute infrastructure, not a separate inference model.

### User device/browser-side (3 roles)
1. **Needle:** compact natural-language-to-typed-action/extraction specialist.
2. **TRM:** recursive solver only for supported, explicitly encoded constrained tasks (initially a narrow puzzle/grid benchmark). It does not receive arbitrary prose and should not be routed code tasks to without evidence.
3. **DARLE control plane:** deterministic orchestration, exact operations, memory provenance, policy enforcement, model routing, and verification. This is software, not a neural model.

The existing general language model can remain an optional server-side response/reasoning provider. If the intended "2 + 3" means five neural networks, specify their exact jobs and checkpoint candidates first; adding five models by count alone increases cost and failure modes without guaranteeing capability.

## Request routing

1. Run deterministic parsers/calculators and memory queries first.
2. Route structured extraction and constrained action proposals to Needle.
3. Route only supported symbolic/grid tasks to TRM after encoding and task-domain validation.
4. Route open-ended language and software design to the configured general/reasoning LLM, if available and if data-transfer policy permits. The current Node Agent uses this configured provider as a disclosed fallback when Needle/TRM providers are not registered.
5. Keep all model outputs as proposals. Validate schema, evidence, permissions, budgets, and task-specific correctness outside the model.
6. If no eligible model is available, ask for clarification or return a clear unsupported-task response. Do not silently label a general LLM response as TRM reasoning.

## Needle adapter currently added\n\n- `services/needle_adapter.py` is a Python standard-library HTTP sidecar using the upstream `Needle.complete()` API. It returns model proposals only and never executes function calls.\n- `services/requirements-needle.txt` pins `cactus-needle==3.0.1`; install this in an isolated Python environment, not in the Node web bundle.\n- `src/needle-client.ts` is a typed Node client for `/v1/complete`, with timeout, input limits, bearer-token support, and response/request-ID validation.\n- Sidecar endpoints: `GET /healthz`; `POST /v1/complete` with `{request_id,text,max_new_tokens}`. Set `NEEDLE_WEIGHTS` to a reviewed local `.cact` file, `DARLE_NEEDLE_MODEL_ID` to a pinned artifact identifier, and optionally `DARLE_NEEDLE_TOKEN`. It binds to loopback by default and refuses non-loopback binding without a token.\n- The current Agent does not yet call this client. Provider registration, trusted server-side tool schemas, deployment wiring, artifact hash verification, and runtime tests are still required. Do not expose the sidecar publicly.\n\n## Server/browser division

Browser inference is optional and capability-detected. Check WebGPU/WASM/runtime support, available memory, model artifact compatibility, and a measured latency budget. Do not assume a browser can execute an arbitrary PyTorch TRM checkpoint. The browser should download only versioned, integrity-checked model artifacts, cache them under explicit product policy, and offer cancellation and removal. No repository source, prompts, telemetry, or training feedback leaves the device without explicit consent.

Server-side model inference must use private authenticated service endpoints, bounded queues, request deadlines, concurrency caps, and model/version observability. Render capacity must be measured; server availability does not imply GPU access. If the deployed instance has no compatible accelerator, route to CPU only when benchmarks meet the product's latency and memory targets.

Parallel inference is not automatically beneficial. Start with selective routing; use parallel execution only for independent candidates with a clear value-of-information test, strict time/token budgets, and a deterministic merge/verifier. Never average incompatible outputs or let model voting replace evidence.

## TRM adaptation boundary

Do not adapt TRM on natural-language code tasks by merely changing labels. First reproduce the official task pipeline. Then investigate a narrow structured developer task that can be represented as a fixed-size state/problem/answer format (for example, dependency-graph constraint repair or small configuration constraint solving). Define an encoder, output decoder, exact evaluator, and leakage-resistant dataset. Only expand to source-code reasoning if experiments establish a suitable representation and reliable gains over Needle/LLM baselines.

## Required gates

- Confirm upstream archive state, commit SHA, license and checkpoint provenance.
- Reproduce a documented TRM benchmark before making local changes.
- Define the user-device support matrix and test browser runtime feasibility.
- Benchmark each model alone and the routed system on the same held-out tasks.
- Measure task success, false acceptance, abstention, p50/p95 latency, peak RAM/VRAM, downloads, energy where measurable, and failure rates.
- Test prompt injection, malicious repository content, cross-project isolation, unauthorized actions and data exfiltration. Target zero unauthorized side effects and zero cross-project data access in the security suite.
- Train or fine-tune only with documented data rights and explicit opt-in for private user data.
- Publish model cards, artifact hashes, licenses, limitations and reproducible evaluation results.

## Immediate implementation sequence

1. Add a versioned model-router contract and capability registry, with no provider falsely marked available.
2. Add mock-backed routing tests and safe unavailable-provider fallback.
3. Reproduce upstream TRM in an isolated research environment; do not put its full CUDA training stack in the web server.
4. Implement one local inference adapter at a time, starting with Needle's documented runtime.
5. Implement the local verified patch workflow and collect opt-in verified change records.
6. Run Needle and TRM adaptation experiments only on task representations each model can actually support.
