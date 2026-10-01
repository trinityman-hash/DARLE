# DARLE Verified Change Loop

Status: research proposal, not implemented or benchmarked. No claim of novelty is made before a literature review and controlled experiments.

## Product thesis

DARLE should be a compact developer adaptation system built around Needle, not a general-purpose LLM or generic agent framework. Its first target is bounded software maintenance: interpret a developer request, propose a reviewable patch, validate it in an isolated environment, and preserve the verified outcome as a project-scoped learning record.

Research question: can a small task-adapted model improve software-change proposals by learning from verified execution and review outcomes, while keeping private project data local and avoiding silent online weight updates?

Patch generation, tool calling, retrieval, testing, and LoRA already exist individually. The possible contribution is a carefully evaluated method for turning verified change outcomes into compact, scoped adaptation. This combination may already have prior art; literature and product review is a required gate. If no distinct contribution survives review, ship the useful product without a novelty claim.

## System boundaries

- **Needle:** local neural model for structured task interpretation, edit proposals, extraction, and action selection. It is not trusted to authorize or execute actions.
- **DARLE:** project context, policy, versioned records, retrieval, evaluation orchestration, and user interface. Existing deterministic memory is bookkeeping, not neural reasoning.
- **Sandbox:** applies candidate edits in a disposable worktree and runs only project-approved checks under resource limits.
- **Optional larger model:** may assist on server-side training-data generation or difficult tasks only with explicit permission to transfer relevant code. It is not required for local operation.
- **Developer:** reviews the diff and evidence. Separate approval is required for changes to the working tree, commits, pushes, releases, or deployment.

## Verified Change Record (VCR)

A VCR links a task to a repository revision, selected file references, proposed diff hash, allow-listed checks and outcomes, developer disposition (accepted/rejected/revised/abandoned), regression and security review status, applicability scope, model/adapter/schema versions, consent and retention metadata.

Do not store secrets, full source trees, or raw terminal output by default. Records are project-scoped, exportable and deletable. A passing test is evidence, not proof of correctness; a merged patch is not automatically a reusable general solution.

## Adaptation timescales

1. **Task state:** current request, selected code, tool results and test failures; ephemeral by default.
2. **Project-local experience:** VCR retrieval, editable and deletable, never silently shared across projects.
3. **Offline fine-tuning:** periodic opt-in adaptation of a pinned Needle checkpoint using curated examples derived from approved records. Version, evaluate, sign and roll back each artifact. No silent per-user gradient updates or automatic ingestion into a global model.

First measure whether project-local retrieval provides most of the benefit. Fine-tuning is justified only if it adds measurable value beyond retrieval and prompt/schema improvements.

## Model contract

Input: task, bounded repository metadata, selected source snippets with stable file IDs and ranges, project rules, allowed edit/check types, and relevant VCR IDs.

Output: propose/clarify/abstain status; interpretation and assumptions; structured edits with file IDs and exact anchors; validation plan using allow-listed check IDs; risk flags; reused record IDs; unresolved questions.

Validate output against a closed schema. Reject unknown paths, ambiguous anchors, oversized diffs, unknown checks, and edits outside the disposable worktree. The model never supplies arbitrary executable commands, credentials, network destinations, or deployment actions.

Treat repository files, issues, comments, test output and retrieved records as untrusted data. Default sandbox networking off; preserve original state and provide rollback. If checks are absent or fail to run, report the patch as unvalidated.

## Evaluation

Compare on identical tasks and resource budgets:
A. current DARLE rules; B. base Needle; C. Needle fine-tuned on demonstrations; D. Needle plus VCR retrieval; E. Needle plus retrieval and fine-tuning; F. a strong coding model as a reference where access and licensing permit.

Use permissively licensed or synthetic tasks with checked outcomes. Split by repository and task family to prevent leakage; keep a locked test set and separate adversarial suite.

Measure patch application and syntax validity, original and hidden test pass rates, regressions, blind human acceptance and edit distance, correct abstention, VCR retrieval applicability, policy violations, cross-project leakage, sandbox escapes, latency, peak RAM, cold-start, artifact size and device performance. Report per-task breakdowns and uncertainty, not one aggregate score. Set acceptance thresholds before training.

## Delivery gates

### 0. Reproduce
Pin Needle generation, commit, checkpoint hash, runtime and license. Reproduce the upstream baseline and one documented fine-tune. Complete literature review and define target device matrix.

### 1. Product before custom weights
Build local repository context, structured patch proposal, isolated validation, diff review, approval, rollback, and local VCR storage/retrieval/deletion. Add tests for malicious repository instructions, path traversal, unauthorized commands and project isolation.

### 2. Fine-tuning experiment
Curate approved training records, fine-tune through the supported Needle pipeline, compare baselines B-E on locked repository splits, and measure quantized artifacts on real user-device classes.

### 3. Research only if evidence warrants it
Investigate a new objective or architecture only if error analysis shows a limitation that retrieval and supported fine-tuning cannot address. Require ablations, independent replication and reproducible results before claiming a new contribution.

## Constraints and honest limits

Needle's compact artifact does not itself guarantee low peak RAM, latency, coding competence, or robust security. Its documented strengths are structured tool use, extraction and related compact tasks; repository-level code repair may exceed its base capability. Training occurs on controlled server hardware; inference artifacts can be distributed to supported user devices. Local execution and privacy behavior must be tested on actual platforms, not inferred from model size.

The first credible deliverable is a safe local patch-and-verify workflow using Needle. A DARLE-specific fine-tuned model is a subsequent experiment, not something that can honestly be claimed before training and evaluation.
