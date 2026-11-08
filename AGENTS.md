# JobPipe workspace execution rules

These rules apply to agents operating in this repository. Development explicitly requested by the user may modify code and docs; routine job hunting must not modify code or business files.

## Operational entry point

Before doing job discovery, screening, tailoring, reviewing, applying or follow-up, read `docs/skill/inbox-contract.md` and the relevant domain flow. Do not rely on a stale external Skill instead of this repository's contract.

The current executor is Hatch Muse via the Mac device file channel. Read `docs/runbooks/muse-hatch.md` and use the installed `jobpipe_executor` Skill. Before each task submit AGENT_CONTEXT_REQUESTED; read its committed Engine Receipt and snapshot under data/agent-contexts/, verify the digest, and report Knowledge availability/version/count. On Mac, `npm run muse` provides setup/preview and optional request preparation; it does not launch Hatch. `npm run muse:cli` is only for the separate legacy Muse Code CLI. Do not confuse those execution environments.

Durable non-secret account methods, vault references and user preferences belong in Knowledge entries tagged `agent-context`, submitted through inbox and committed by Engine. Archive superseded entries. Do not rely on conversational memory alone or store credential values in Knowledge. Tool hooks report execution observations; Muse must still report semantic stage transitions and user waiting states.

- Agent writes only events/evidence under `data/inbox/`. Engine owns business JSON, ledger, formal PDFs, Run, Receipt, Changelog and state. UI decisions are user decisions; do not impersonate them.
- Start a real `AGENT_ACTIVITY running` event before work. Publish progress when changing jobs/steps and at least every 60 seconds while actively working. Use the same `activityId` and `runId`, increasing `sequence`; each event gets its own `taskId`. Use explicit restart semantics for an existing activity.
- Send `AGENT_WAITING` and a waiting activity when user input is needed. Stop running heartbeats while waiting. Finish with actual done/failed evidence. For apply done, require same-job committed Receipt/application/confirmed ledger proof. An inbox submission alone is queued, not completed.
- Prefer `node scripts/agent-events.ts emit --input <event.json> --base <project-root>`. Omit `createdAt` and let the tool use the machine's UTC clock. Never attach Z to a local clock string. The helper rejects future timestamps rather than guessing/correcting historical facts.
- For an actual executable workflow, `node scripts/agent-events.ts run --stage screening --title "Screen jobs" --activity-id <new-id> -- <actual-command> [args]` ties progress to the real child process. This wrapper is not a detached heartbeat for work happening elsewhere. For a conversational/browser workflow, publish real step events yourself using emit.
- Do not start a heartbeat loop just to make the dashboard green. Engine heartbeat means Engine only. Read each event's Receipt; if reporting is rejected or unavailable, tell the user the operation is not observable and handle the reporting failure.
- New PDFs enter `data/inbox/evidence/`; Engine promotes them. No historical backfill, business migration, deletion or direct corrections without a separate explicit authorized scope.

## Muse context and recovery

Hatch activity signals must carry contextTaskId/contextDigest and use the snapshot sessionId as runId. Engine validates the committed context request, workspace/stage/job and current rules/Knowledge. Missing or stale context stops the task. The helper lives in integrations/muse/hatch/jobpipe_executor/scripts/jobpipe.py; it prepares VM-local files and never directly writes Mac business data. Transfer immutable events with the actual Mac file connector, read Receipts, and preserve run/sequence state. After interruption, inspect prior Activity, waiting answers and business Receipts, request fresh context and use explicit restartOf. No undocumented hooks or detached fake heartbeat.

## Development

Preserve user edits. Test changes in temporary fixtures, run type checks and relevant tests/build. Never launch the real daemon, submit synthetic events into real inbox or rewrite true business data to test a UI repair. Do not overwrite records to remove warnings.

## Documentation source of truth

The user-facing product manual is docs/product-manual.md, bundled with /help. Keep execution contracts in docs/skill/ and operating instructions in docs/runbooks/. Do not introduce another current product manual. Local historical reports and archived skills are private, excluded from Git, and do not authorize obsolete write rules.

## Publication privacy

Never commit data/, local audit reports, archives, backups, credentials, personal contact details or absolute user paths. Use synthetic fixtures with example.com addresses. Read per-user business preferences from local data rather than embedding them in code or public Skill documents.
