# DARLE

DARLE is being rebuilt as a **local-first visual automation and multi-platform bot runtime**. Its core must run without a language model. AI, if added later, is an optional connector—not a required runtime dependency.

## Product boundaries

- Visual workflows: triggers, ordered actions, branching, schedules, webhooks, approvals, execution history and retries.
- Multi-platform bots: shared bot logic connected to channels such as Telegram and Discord.
- Extensible connectors: a documented contract for built-in, community and local application integrations (including a planned Blender bridge).
- Secure local execution: explicit permissions, least privilege, bounded inputs and outputs, secret handling, auditability, and safe failure behavior.

DARLE will not treat general-purpose conversation, model tuning, or cloud dependence as its product core. “Local-first” does not mean every connector is automatically trusted: integrations that access files, networks, credentials, or processes require deliberate permission boundaries.

## Current implementation

The repository currently contains a legacy conversational prototype alongside the first workflow-runtime foundation. The workflow foundation is deliberately data-only:

- Versioned workflow and step contracts.
- Bounded JSON validation; executable code is not accepted as workflow data.
- Actions run only through explicitly registered connector handlers.
- Sequential fail-closed execution with per-step timeout and cancellation signals.
- Automated tests, TypeScript checks, bundling, and container build in CI.

This is an early execution foundation, **not yet the complete visual builder, persistent workflow store, connector permission manager, bot runtime, or production security boundary**. In-process action timeouts cannot forcibly stop arbitrary JavaScript; trusted connector handlers must cooperate with cancellation, and untrusted extensions require process or OS-level isolation before they can be enabled.

## Development sequence

1. Complete the workflow schema, runtime lifecycle, run records, and deterministic tests.
2. Add explicit connector registration and permission declarations.
3. Build the visual workflow editor and local workflow storage.
4. Add Telegram and Discord through the common connector interface.
5. Prove safe local integration with a Blender bridge.
6. Remove legacy conversational, memory, and model-specific code once no longer needed.
7. Harden installation, secrets, isolation, network policy, audit logs, and recovery.

## Engineering requirements

- No dynamic evaluation, dynamic code execution, or implicit shell execution in workflow definitions.
- Validate untrusted data at every boundary and cap payloads, steps, execution time, and retained history.
- Fail closed on unknown actions, missing permissions, invalid data, and execution errors.
- Never store credentials in workflow definitions, logs, source control, or browser-visible state.
- Treat CI success as necessary, not sufficient, evidence of security. Threat-model review and adversarial tests are required before enabling untrusted connectors.

## Development

Requires Node.js 22 or later.

```sh
npm install --include=dev
npm test
npm run check
npm run build
npm start
```

The current HTTP host serves the existing prototype UI and API. It is not yet the target local automation interface.
