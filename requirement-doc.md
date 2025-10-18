# Local LLM Benchmark – Working Design Document

## Context
The Local LLM Benchmark tooling lets admins configure local model profiles, sanity-check connectivity, and execute multi-step evaluations against curated question sets. Recent iterations (Codex, Jan 2025) focused on:

- Removing environment flag dependencies so the feature runs in any non-production deployment.
- Persisting benchmark form inputs and reusable model profiles in local storage for faster reruns.
- Introducing granular logging and a diagnostics panel that exercises `testConnection` on demand.
- Expanding diagnostics into two tiers:
  - **Level 1 – Handshake** validates JSON-mode responses from the configured model.
  - **Level 2 – Readiness** runs the full topology/answer/solution pipeline against a sample question to confirm schema compliance before launching a long benchmark.
- Dropping console noise in the admin UI while presenting structured log entries and response breakdowns.

This document tracks the status of the feature set and the upcoming redesign workstream. Treat it as the source of truth until implementation completes.

## Current Capabilities (Oct 2025)
- **Tabbed information architecture**
  - Dashboard, Profiles, Runs, and contextual Run Detail views implemented with React Router.
  - Shared `BenchmarkContext` manages profiles, diagnostics history, question bank, and persisted runs via browser local storage.
- **Model profiles & diagnostics**
  - Create/update/delete LM Studio profiles with form validation, configurable temperature/prompts, and editable benchmark steps.
  - Level 1 (handshake) and Level 2 (readiness) diagnostics execute against the configured LM Studio endpoint with JSON-mode fallback and structured log capture.
  - Diagnostics history is retained per profile with status pills, timestamps, and raw log viewer (last 10 entries).
- **Benchmark creation & execution**
  - Runs launched from the Runs tab using a filterable, 100-question selector (type, difficulty, PYQ year, free-text search, select all/clear).
  - Benchmarks execute client-side via `executeBenchmarkRun`, streaming attempt updates into context and persisting tokens/latency/accuracy metrics.
  - Readiness diagnostics must pass before launch; progress toast shown while run is active.
- **Analytics & visualizations**
  - Dashboard surfaces KPI cards, accuracy/latency trend line chart, dataset snapshot, and latest run table with drill-down links.
  - Run Detail view renders pass/fail vs latency composed chart, dataset filter summary, and per-attempt drawer with reasoning, token usage, and raw responses.
- **Question dataset integration**
  - GATE PYQ sample (100 questions) normalized via `questionDataset` loader, exposing topology metadata, accepted answers, and evaluation helpers.
  - October 2025 refresh replaces rich-text nodes with plain strings and trims metadata to status-only; standalone topology catalogue (`pyq-gate-sample-topology.json`) now drives subject/topic selection.

## Requested Enhancements & Scope
1. ✅ **Run lifecycle management**
   - Runs list supports delete actions with confirmation gates (blocking for active runs) and context persistence.
2. ✅ **Question selection UX**
   - Manual selector shows the latest 100 curated questions with filters (type, difficulty, PYQ year, search) and bulk actions.
3. ✅ **Information architecture overhaul**
   - Dashboard/Profiles/Runs tabs plus Run Detail route delivered; navigation sidebar updated accordingly.
4. ✅ **Visualizations**
   - Dashboard trend chart (accuracy vs latency) and Run Detail composed chart implemented via Recharts.
5. 🔄 **Document maintenance**
   - This working doc now reflects the Oct 2025 implementation; continue updating with backend integration status and future enhancements.
6. 🆕 **Dataset alignment**
   - Normalize the simplified PYQ payload across the app, wire up the topology tree for filters/diagnostics, and ensure evaluators handle missing legacy fields.

## Proposed UX Structure
```
Local LLM Benchmark
├── Dashboard (default)
│   ├── Latest run per model (trend cards, charts)
│   ├── Quick stats (success rate, avg duration)
│   └── CTA to view full run or launch new run
├── Profiles
│   ├── Saved model list
│   ├── Profile editor + diagnostics panel (Level 1/2)
│   └── Actions: save, load, delete, test connection
├── Runs
│   ├── Filterable table (status, provider, date, user)
│   ├── Bulk actions (delete run)
│   └── Row click → Run Detail
└── Run Detail (contextual view)
    ├── Summary metrics (duration, status, accuracy per step)
    ├── Visualizations (step pass/fail, timeline)
    └── Attempts list (expandable entries with request/response)
```

## Data & API Considerations
- Frontend currently persists profiles and runs locally; no remote API calls beyond LM Studio chat completions/handshake.
- When wiring to the admin API, replicate current local-storage contracts:
  - `GET /runs` should return attempts with evaluation metrics and token usage to hydrate charts.
  - `DELETE /runs/:id` must guard against active executions similar to the UI confirmation.
  - Consider a `/summary` endpoint that mirrors `DashboardOverview` shape (latest runs, trend points).
- Backend integration backlog: persist diagnostic history, question metadata, and run attempts to Mongo (replace in-memory store when ready).

## Implementation Plan (Draft)
| Phase | Status (Oct 2025) | Notes |
| --- | --- | --- |
| **A. Backend support** | Pending | Frontend simulates storage; backend routes still required for multi-user deployments. |
| **B. Data contracts** | In progress | New TypeScript models defined in `src/types/benchmark.ts`; align REST contracts when backend work starts. |
| **C. UI refactor** | ✅ Complete | Tabbed layout, navigation overhaul, and context store shipped. |
| **D. Dashboard analytics** | ✅ Complete | KPI cards + accuracy/latency chart delivered via Recharts. |
| **E. Run detail improvements** | ✅ Complete | Detailed summary, charts, attempt breakdown, token stats. |
| **F. Polish & validation** | Ongoing | Lint/build green; manual QA with LM Studio pending once credentials validated. |
| **G. Dataset alignment** | In progress | Rework question loader for simplified schema, surface topology catalogue, and backfill metadata defaults. |

## Dependencies & Risks
- **Mongo performance**: Loading 100 questions and full run histories may impact load time; may need server-side caching or client virtualization.
- **Charting library footprint**: Ensure existing chart.js/react-chartjs does not bloat bundle; lazy-load components where possible.
- **Run deletion safety**: Provide confirmation dialogs and ensure no benchmarks are mid-run before deletion (optional guard).
- **Design consistency**: Align tab styling with existing admin theme; coordinate with design if charts require new patterns.

## Open Questions
1. Should run deletion prevent removal of runs in `running` status until completion/cancellation?
2. Do we need role-based restrictions for dashboard vs. profile management?
3. What specific metrics/visualizations are most important on the default dashboard (accuracy over time, per-step latency, etc.)?
4. Should the 100-question display support client-side search/filtering to keep the list usable?

## February 2025 UI Adjustments
- Profiles tab now defaults to a concise saved-profile list, with per-profile diagnostics summaries and log viewers; full configuration forms only appear when creating or editing.
- Connection tests persist diagnostics data alongside each profile so Level 1/Level 2 handshake details surface directly in the list view.
- Runs tab exposes a `New run` entry point that reveals run setup; setup requires picking an existing profile and hides raw model fields to reduce duplication.
- Run setup now surfaces diagnostics status, auto-runs Level 1 then Level 2 in a single action, and blocks launch until readiness passes.
- Question selection is filter-driven (topology, question type, PYQ, year) with select-all and manual curation instead of relying on counts.
- Run history stays focused on existing executions, while detailed analytics move into a dedicated drill-down view that opens after selecting a run and provides a back navigation path.
- Benchmark creation flow now reuses selected profile metadata when POSTing to the backend, keeping evaluation-step selections and filtered question IDs intact.
- Diagnostics backend falls back when OpenAI-compatible servers reject JSON-mode (`response_format`) so Level 2 checks work against OSS stacks.

## Diagnostics Notes
- Recent Level 2 runs against `openai/gpt-oss-120b` returned HTTP 400 when `response_format` was requested; the service now retries without JSON mode to sustain readiness checks.

## Implementation Notes (Oct 2025)
- Diagnostics switch automatically retries without `response_format` when LM Studio rejects JSON mode, marking profile metadata with `supportsJsonMode=false` so future runs start in fallback mode.
- Benchmark evaluation leverages `parseModelResponse` + `evaluateModelAnswer` for MCQ/MSQ/NAT/TRUE_FALSE question types. NAT answers respect numeric ranges and accepted answer lists.
- `executeBenchmarkRun` streams progress into context, allowing live updates in the Runs table and eventual detail view without reload.
- Question loader now handles plain-string prompts/options from the simplified PYQ dataset while retaining compatibility with legacy rich-text payloads.
- Topology catalogue (`pyq-gate-sample-topology.json`) will feed subject/topic/subtopic filters once ingestion pipeline lands.

## Next Steps
1. Wire profile/run persistence to backend APIs (mirror local storage schema, add optimistic updates).
2. Add run cancellation controls and progress indicators (per-attempt progress bar, elapsed timers).
3. Expand evaluation to support FILL_BLANK and descriptive grading with rubric scoring.
4. Integrate screenshot capture and export (CSV/JSON) for completed runs.
5. Validate LM Studio credentials, document setup (base URL, API key) in README once confirmed.
6. Deliver dataset alignment work: load simplified PYQ data, expose topology-aware filters, and refresh diagnostics sample selection.

This document will evolve as we implement and learn; update sections with decisions, links to PRs, and any shifts in scope.
