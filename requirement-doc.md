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

## Current Capabilities (as of this document)
- **Model profiles**
  - Editable form with provider, base URL, model identifier, API key, temperature, benchmark steps.
  - Save/load/delete named profiles stored in browser local storage.
- **Diagnostics**
  - Level selector (handshake vs readiness).
  - Result panel summarizing JSON validity, sample-step pass rates, raw response payloads, and log stream.
- **Benchmark creation & runs**
  - Choose automatic (latest published questions) or manual selection with pagination.
  - Runs persist in Mongo via `LocalLLMBenchmarkRun` and `LocalLLMBenchmarkAttempt` models.
  - Run detail view (single page) shows attempts list with step responses/evaluations.
- **Logging**
  - UI surface for diagnostic logs (info/warn/error), trimmed to last 50 entries.
  - Backend winston logs for run execution, step-level failures, and diagnostics.

## Requested Enhancements & Scope
1. **Run lifecycle management**
   - Allow admins to delete an entire run (and associated attempts) when it is obsolete or broken.
2. **Question selection UX**
   - Remove pagination; always load and display the latest 100 questions for selection context.
3. **Information architecture overhaul**
   - Break the single-page dashboard into tabbed views:
     - **Dashboard** – default landing page. High-level comparison of the latest runs per model, visualized via charts or KPI tiles.
     - **Profiles** – create/manage model profiles, run connectivity diagnostics.
     - **Runs** – tabular run history with filters and summary stats. Clicking a run drills into detail view.
     - **Run Detail** (sub-view) – rich analytics for a single run (pass/fail distribution, step accuracy graphs, attempt table).
4. **Visualizations**
   - Provide graphical comparisons (e.g., bar/line charts for accuracy, durations) between recent runs and across models.
5. **Document maintenance**
   - Keep this design document updated as new requirements surface and decisions are made.

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
- **Run deletion**
  - Add `DELETE /api/v1/admin/local-llm-benchmark/runs/:id`.
  - Cascade delete attempts (`LocalLLMBenchmarkAttempt.deleteMany({ run: id })`).
  - Restrict to admins (reuse router middleware).
- **Run listing**
  - Enhance `listBenchmarkRuns` to support loading all recent runs (remove pagination limit or set high cap with client-side filtering).
  - Provide rollups: success counts, average durations per model, last executed timestamp.
- **Dashboard summary endpoint**
  - New API to fetch latest run per model and aggregated metrics (accuracy, completion counts, failures).
- **UI state management**
  - Consider splitting current component into smaller client components per tab to reduce complexity.
  - Reuse hooks for shared data fetching (e.g., `useBenchmarkRuns`, `useModelProfiles`).

## Implementation Plan (Draft)
| Phase | Goals | Key Tasks |
| --- | --- | --- |
| **A. Backend support** | Enable lifecycle operations & summary data | - Implement run deletion endpoint<br>- Adjust existing list endpoints to support unpaginated fetch (with server cap)<br>- Add summary aggregation service for dashboard |
| **B. Data contracts** | Normalize responses for UI | - Extend shared types in `@kg-portal/shared` if needed<br>- Update frontend API util routes |
| **C. UI refactor** | Introduce tabbed layout | - Split current dashboard into tabs/components<br>- Route state management (URL param or local tabs) |
| **D. Dashboard analytics** | Visual comparison experience | - Build chart components (reuse existing chart libs)<br>- Surface KPI cards (accuracy, duration, failure counts) |
| **E. Run detail improvements** | Rich drill-down | - Compose summary panels and charts<br>- Enhance attempts table (search/filter) |
| **F. Polish & validation** | QA and docs | - Update documentation (this file, README)<br>- Manual QA with mock data and LM Studio<br>- Capture screenshots for PR |

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

## Next Steps
1. Review this plan with stakeholders to confirm scope and priorities.
2. Finalize API contracts (especially summary & deletion endpoints).
3. Kick off Phase A backend work while preparing UI component scaffolding.
4. Iterate on dashboard visualization mockups before implementation.

This document will evolve as we implement and learn; update sections with decisions, links to PRs, and any shifts in scope.
