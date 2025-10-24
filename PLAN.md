# KG AI Benchmark – Implementation Plan

## Context
KG AI Benchmark is a React 19 + TypeScript application used to benchmark local LLMs running through LM Studio or an OpenAI-compatible endpoint. The UI overhaul (Tailwind migration, theme system, component refactors) is largely complete, and the next major milestone is stronger LM Studio integration so that administrators can discover installed models and manage default profiles without manual setup.

## Primary Outcomes
- Maintain the polished Tailwind-based UI and theme system already delivered.
- Deliver a transparent benchmark launch experience with in-modal progress tracking.
- Expand intelligent defaults for benchmark configuration to reduce manual effort.
- Integrate directly with the LM Studio REST API so the app auto-discovers available models (including capabilities metadata) and surfaces them as ready-to-use profiles.
- Finish the remaining UI polish pass (spacing, status states, hover affordances) once the discovery work lands.

## Current Focus: Run Launch Experience Overhaul

### Problem Statement
- The new run modal in `src/pages/Runs.tsx` (`NewRunPanel`) still surfaces a `Launch benchmark` CTA that flips to `Launching…` with no visible increments, making long-running batches appear stalled.
- Progress only appears indirectly when the run row updates or the floating toast renders, so users cannot verify that individual questions are executing or diagnose slowdowns mid-run.

### Goals
- Rename the primary CTA to `Run benchmark` and ensure copy on the modal reflects the multi-stage experience.
- Keep the modal open after submission and pivot the layout to show a live execution view without forcing navigation to the runs table.
- Surface per-question status (queued → running → completed/failed), aggregate metrics (accuracy, average latency, elapsed time), and highlight the current question being evaluated.
- Allow the operator to minimize/dismiss the modal once progress is visible while keeping a persistent inline indicator on the runs screen.
- Provide clear failure and completion states with next-step affordances (view run details, start another run).

### Non-Goals
- No server-side streaming or websocket introduction—leverage `executeBenchmarkRun`'s existing `onProgress` callback.
- No scheduling/queuing of multiple concurrent runs; focus on the single-run experience.
- Cancel/abort controls are out of scope for the first pass unless the existing engine already supports it.

### Current Behavior Audit
- `src/pages/Runs.tsx` handles launch via `NewRunPanel`, sets a `launching` boolean, and immediately closes the modal once `onLaunch` resolves.
- `handleLaunchRun` triggers `executeBenchmarkRun` and uses `upsertRun` to write incremental attempts, but these updates are only visible after closing the modal.
- While a run is active, a temporary toast (`launchingRunId` banner) instructs the user to watch the table, yet rows only show coarse `Running` status with no granular context.
- There is no shared state that tracks "active run" metadata for components outside of the runs table, so a future progress component has nothing to subscribe to.

### Proposed UX Flow
1. **Configure run** – identical form as today with improved CTA text.
2. **Running state** – modal transitions into a progress dashboard:
   - Timeline/progress bar showing % completion derived from attempts vs selected questions.
   - Scrollable list of selected questions (label + type) with status pills and latency once answered.
   - Hero section with current question id, step-level copy, elapsed time, and recent metrics.
3. **Completion state** – modal shows summary (accuracy, average latency, failures) and offers buttons to view run detail or start another run. In the failure case, surface error notes for the last attempt and link to diagnostics.

### UX & Copy Requirements
- Primary button copy `Run benchmark` (idle) → `Starting…` (while awaiting first update) → `View run`/`Close`.
- Secondary actions: `Back` to editing prior to launch; once running, replace with `Hide window` that simply dismisses the modal but keeps run active.
- Status tags: `Queued`, `Running`, `Passed`, `Failed`. Should reuse Tailwind token colors already defined for status pills.

### Data & State Updates
- Extend `BenchmarkContext` with an `activeRun` slice (id, questionIds, attempts, progress, startedAt, status, lastUpdatedAt) that persists while the app session is open.
- Update `handleLaunchRun` to populate the `activeRun` store before calling `executeBenchmarkRun` and to emit progress snapshots from the `onProgress` callback.
- Provide a derived selector/hook (e.g., `useActiveRunProgress()`) that the modal and a lightweight runs-table indicator can consume.
- Preserve existing `runs` entries so that if the modal is closed, returning to Runs shows consistent data.
- Consider debouncing updates to avoid re-render storms (batch updates or requestAnimationFrame).

### Technical Tasks & Phasing
1. **Discovery & scaffolding**
   - Inventory question metadata needed for progress rows (prompt, display id, type) and ensure it is available without repeated lookups.
   - Draft TypeScript types for the new `ActiveRunProgress` structure and integrate with context reducer/storage (unit tests for reducer transitions).
2. **Progress plumbing**
   - Refactor `handleLaunchRun` to stream progress events into context, including derived metrics (elapsed time, average latency).
   - Ensure failure paths and completion events finalize `activeRun` with terminal status and timestamps.
   - Decide how to handle modal dismissal (keep state in context, rehydrate modal if user reopens while run active).
3. **UI implementation**
   - Convert `NewRunPanel` into a multi-step component (`mode: 'form' | 'progress' | 'complete'`) with smooth transitions.
   - Build new progress subcomponents (progress header, metrics widgets, question list, empty states) using Tailwind primitives.
   - Update CTA/button logic and ensure accessibility (focus management when switching states).
4. **Post-run handoff**
   - Inject inline indicator/banner on the Runs page when an active run exists (e.g., status chip above the table with link to reopen modal).
   - Write copy/affordances for completion and error states that direct users to run detail or diagnostics.
   - Update documentation (`requirement-doc.md` or README) as needed.

### Detailed To-Do
- [ ] Align on final UX copy and confirm whether modal dismissal should keep progress accessible via a banner or badge.
- [ ] Add `activeRun` reducer actions to `src/context/BenchmarkContext.tsx` and provide selectors/hooks.
- [ ] Refactor `handleLaunchRun` in `src/pages/Runs.tsx` to emit structured progress objects (status per question, metrics).
- [ ] Map question metadata upfront so the progress UI can render labels without expensive lookups.
- [ ] Split `NewRunPanel` into form + progress views with retained selection state when returning.
- [ ] Implement progress header (elapsed time, completion %, accuracy, average latency).
- [ ] Render question list with live status updates and latency values.
- [ ] Handle failure states gracefully (show error message, allow retry) and mark failed questions.
- [ ] Add inline active-run indicator on the Runs page and wire it to reopen the modal in progress mode.
- [ ] Audit accessibility (focus trapping, aria-live for status announcements).
- [ ] Add unit tests for new reducer logic and UI tests (e.g., React Testing Library) to verify state transitions.
- [ ] Update cypress/manual test checklist to include launching a run and observing progress.

### Testing & Validation
- Unit-test reducer transitions for all new actions (start, progress tick, completion, failure, reset).
- Component tests for `NewRunPanel` multi-step flow to ensure UI switches when progress events stream in.
- Manual verification against a long-running profile to confirm progress list updates without freezing.
- Regression pass on runs table and existing run detail view to ensure persisted data unchanged.

### Dependencies & Risks
- Need reliable timestamps and metrics from `executeBenchmarkRun`; latency spikes or errors must not crash the progress UI.
- Modal staying mounted for long runs could increase memory usage; ensure list virtualization is unnecessary given question counts (<100).
- If multiple runs are launched concurrently (future scenario), we must clarify how `activeRun` behaves (likely single active run only).
- Ensure storage persistence does not record `activeRun` snapshot in localStorage unless specifically desired (avoid stale resume on reload).

### Open Questions
- Should closing the modal cancel the run, or merely hide the UI? Current thinking: hide only, but needs confirmation.
- Do we want to allow launching another run while one is active? If not, disable CTA globally until completion.
- Is there interest in exporting a progress log or metrics snapshot directly from the modal?

## Workstreams & Status

### A. Tailwind CSS Migration (Complete)
- ✅ Dependencies installed (`tailwindcss`, `postcss`, `autoprefixer`).
- ✅ Tailwind config with brand palette, spacing scale, dark mode.
- ✅ Global styles replaced with Tailwind directives; legacy CSS removed.

### B. Theme System (Complete)
- ✅ `ThemeContext` with auto/Light/Dark modes and localStorage persistence.
- ✅ App wrapped in `ThemeProvider`; sidebar toggle cycles Light → Dark → Auto.
- ✅ Dark-mode color tokens wired into Tailwind config.

### C. Intelligent Defaults (Complete)
- ✅ `DEFAULT_PROFILE_VALUES` centralizes model parameters (temperature, topP, penalties).
- ✅ `ModelProfile` types extended with `topP`, `frequencyPenalty`, `presencePenalty`.
- ✅ Profile form updated with helper text + new inputs; LM Studio client sends the values.

### D. Component Library & Layout Refresh (Complete)
- ✅ Modal, Button, and Card primitives implemented with Tailwind variants.
- ✅ Dashboard, Profiles, Runs, and Run Detail screens migrated to Tailwind layout patterns.
- ✅ Diagnostics and run workflows respect the new design system.

### E. UI Polish (Phase 5, Not Started)
- ⬜ Apply consistent spacing scale across pages.
- ⬜ Enhance card/panel styling for visual hierarchy.
- ⬜ Improve status pills, table hover states, and form field affordances.
- ⬜ Add subtle transitions where beneficial.

### F. LM Studio Model Discovery & Auto Profiles (New, In Progress)
Goal: When LM Studio is running locally, automatically fetch its available models, capture capability metadata, and present them as pre-populated profiles that can be adopted or customized.

- 🟡 **Discovery Client**
  - Implement `lmStudioDiscoveryClient` service to call `GET /api/v0/models` (rich metadata) with fallback to `GET /v1/models`.
  - Normalize payload into internal `DiscoveredModel` records (id, type, context window, quantization, capabilities array, load state).
- ⬜ **Benchmark Context Integration**
  - Extend `BenchmarkContext` to store discovered models alongside saved profiles.
  - Add load/refresh actions that fetch on app start and via manual refresh in Profiles tab.
- ⬜ **Auto Profile Generation**
  - Map discovered models into default profile entries (base URL, model id, capability tags) while keeping user-created profiles separate.
  - Flag autogenerated profiles to prevent accidental edits from overwriting persistent user data.
- ⬜ **UI Updates**
  - Update Profiles tab to display “Discovered Models” section with capability badges (e.g., `tool_use`, `vision`, `embeddings`) and load state.
  - Provide CTA to adopt/clone a discovered model into a persistent profile.
- ⬜ **Resilience & Telemetry**
  - Handle offline LM Studio gracefully (retry strategy, UI messaging).
  - Surface last sync timestamp and error state in diagnostics drawer.

### G. Run Launch Experience Overhaul
- ✅ Draft progress-driven UX requirements in `PLAN.md` (capture problem, goals, technical approach).
- ✅ Implement `activeRun` state management and selectors in `BenchmarkContext`.
- ✅ Add inline active-run indicator and completion affordances on the Runs page.
- 🟡 Replace modal-driven progress flow with a full-screen live dashboard.
  - ✅ Redirect new run launches to the dedicated progress/detail route immediately after submission.
  - ✅ Redesign `RunDetail` to support active runs with live metrics, dataset summary, and status-aware hero treatment.
  - ✅ Build a question navigator layout (left status rail + right attempt inspector) that works for in-progress and completed runs.
  - ✅ Auto-focus the inspector on the currently running question while honoring manual overrides.
  - ✅ Keep the run creation experience scoped to configuration only (modal/panel) and ensure "View progress" opens the dashboard.
  - 🟡 Validate that completed runs continue to render cleanly with the updated UX and data model.

### H. Multi-Step Benchmark Pipeline Restoration (New, High Priority)
Goal: Reinstate the documented multi-call execution flow so every question triggers distinct topology and answer evaluations, with results captured per step.

- ⬜ **Engine Refactor**
  - Update `executeBenchmarkRun` to iterate through `profile.benchmarkSteps`, issuing separate chat completions for enabled steps (topology first, final answer second at minimum).
  - Ensure prompts honor each step’s `promptTemplate`, injecting question context plus prior step outputs when needed.
- ⬜ **Attempt Persistence**
  - Extend `BenchmarkAttempt` to store per-step request/response payloads, inferred topology metadata, and evaluation notes.
  - Persist topology comparison outcomes alongside answer scoring so downstream analytics can surface accuracy per step.
- ⬜ **Evaluation Enhancements**
  - Add a topology validator that compares the model’s predicted subject/topic/subtopic to the ground truth before scoring answers.
  - Propagate step-level pass/fail metrics into aggregated run stats (e.g., topology accuracy, answer accuracy, combined score).
- ⬜ **UI & Reporting**
  - Surface step timelines in Run Detail (e.g., topology vs answer results, latency per step, JSON payloads).
  - Update readiness diagnostics to exercise the full multi-step flow and fail fast when topology extraction breaks.
- ⬜ **Config & Defaults**
  - Refresh default benchmark steps to include explicit `topology` and `answer` templates and document customization rules in Profiles.
  - Backfill existing saved profiles/runs with default steps if missing to avoid runtime regressions.

### I. Supabase Persistence Layer (New, In Progress)
Goal: Replace localStorage with Supabase-backed storage so profiles, diagnostics, and runs survive reloads and support multi-device use.

- ✅ **Client bootstrap**
  - Add Supabase JS client configured via `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.
  - Load and persist benchmark data (profiles, runs, diagnostics) through Supabase instead of localStorage.
- ⬜ **Database schema & migrations**
  - Create `profiles` and `runs` tables with `id (uuid)`, `data (jsonb)`, `updated_at`, plus helper columns (`name`, `status`, etc.).
  - Add row-level security policies (RLS) aligned with anonymous key usage or replace with service-role key when auth is added.
- ⬜ **API hardening**
  - Handle offline/latency scenarios with optimistic updates and retry queue.
  - Add structured error surfacing in the UI when persistence fails.
- ⬜ **Future enhancements**
  - Split large run payloads into normalized tables for analytics queries.
  - Introduce user auth + multi-tenant scoping before production rollout.

## Upcoming Milestones
1. Restore the multi-step benchmark pipeline (topology + answer calls, per-step metrics, UI surfaces).
2. Ship the run launch progress experience (active run plumbing, multi-step modal, inline indicator).
3. Finish LM Studio discovery client and context plumbing so models auto-populate on load.
4. Ship Profiles UI updates that clearly separate discovered models from saved profiles and allow quick adoption.
5. Complete Phase 5 polish tasks once the discovery experience is stable.

## Risks & Mitigations
- **LM Studio server availability** – Mitigate with retries, offline messaging, and manual refresh controls.
- **Payload drift between `/api/v0/models` versions** – Guard with type-safe parsing, optional chaining, and capability defaults.
- **Profile confusion** – Clearly label autogenerated entries and require explicit “Save as profile” before editing parameters.
- **Run progress rendering cost** – Frequent progress ticks could trigger heavy React updates; batch reducer dispatches and memoize derived selectors to keep the UI responsive.
- **Multi-step regression risk** – Introduce integration and smoke checks that verify topology and answer steps run in sequence before shipping.

## Open Questions
- Should discovered models auto-refresh in the background or only on user action?
- How should we persist capability metadata if LM Studio is unavailable after initial discovery?
- Do we want to pre-filter models (e.g., hide unloaded ones when JIT loading is off) or show the full list with load-state badges?
- When the run progress modal is dismissed, where should the user reopen it (banner, toast, pinned button)?
- Do we need a cancel/abort affordance in the progress view for long-running or stuck attempts?
- Should active-run state persist across reloads, or is it acceptable to revert to table-only updates after refresh?

## Progress Tracking Legend
- ✅ Completed
- 🟡 In Progress
- ⬜ Not Started
- ⏭️ Skipped
