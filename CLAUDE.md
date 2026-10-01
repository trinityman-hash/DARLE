# CLAUDE.md

## Working agreement
Use these rules alongside the repository's architecture and security documentation.

### Think before coding
- State assumptions and material uncertainty before implementation.
- If requirements have materially different interpretations, ask before choosing.
- Prefer the smallest implementation that meets the stated goal; explain meaningful trade-offs.
- Do not claim capability, novelty, test success, deployment, or security assurance without evidence.

### Simplicity and scope
- Make only changes required by the current task.
- Avoid speculative features, unnecessary abstractions, broad refactors, and unrelated cleanup.
- Match the existing TypeScript/Python style.
- Remove only dead code made obsolete by the current change.

### Goal-driven work
- Define observable acceptance criteria for each multi-step task.
- Add focused regression tests for behavior and failure paths.
- Run the narrowest relevant tests, then the full test suite and build when available.
- If checks cannot be run, say exactly which checks remain unverified.

## DARLE-specific engineering constraints
- Preserve DARLE's current architecture unless a concrete limitation requires a change.
- Treat model output as untrusted proposals. Models must never directly execute tools, edit files, deploy, or change permissions.
- Keep deterministic operations deterministic; use models only for tasks with a justified model requirement.
- Route Needle only to explicitly supported structured extraction/action tasks with a defined input/output schema. Do not equate mentioning JSON or a tool with proven Needle suitability.
- Route TRM only to task encodings and domains supported by measured evaluation. Do not describe it as a general-purpose reasoning or coding model.
- Provider availability must come from explicit configuration/health checks, not assumptions. Fallbacks must be visible and tested.
- Keep user data local by default. Any server transfer, telemetry, training use, or persistence requires clear product policy and appropriate user consent.
- Keep model artifacts versioned and integrity-checked. Do not commit weights, credentials, tokens, or private user data.
- Separate research/training dependencies from the production Node service.
- Security claims must be scoped to implemented and tested controls; never claim "NSA/CIA-level" or equivalent certification without independent evidence.

## Definition of done
A change is complete only when its code, focused tests, documentation, and actual validation status agree. A draft PR is not a production deployment.
