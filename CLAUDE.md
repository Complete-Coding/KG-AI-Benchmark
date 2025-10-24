# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KG AI Benchmark is a React + TypeScript application for benchmarking local LLMs hosted in LM Studio (or any OpenAI-compatible runtime) using a curated GATE PYQ (Previous Year Questions) dataset. The app is client-side only, with benchmark state persisted to Supabase.

## Development Commands

### Core Commands
- `npm run dev` - Start Vite dev server at http://localhost:5173
- `npm run build` - Type-check with TypeScript and build production bundle
- `npm run lint` - Run ESLint with TypeScript rules
- `npm run preview` - Preview production build locally

### Important Notes
- No test suite is currently configured
- Supabase stores profiles, diagnostics, and run history; ensure the environment has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured.

## Architecture

### State Management (Context-Based)

The application uses a centralized `BenchmarkContext` (src/context/BenchmarkContext.tsx) as the single source of truth:

- **Profiles** (`ModelProfile[]`) - LM Studio connection configs, diagnostics history, and benchmark step configurations
- **Runs** (`BenchmarkRun[]`) - Benchmark executions with attempts, metrics, and evaluation results
- **Questions** - Static dataset loaded from `src/data/questions.ts` (100 GATE PYQs)
- **Topology** - Subject/topic/subtopic catalog loaded from `src/data/topology.ts`

State updates flow through a reducer pattern with actions:
- `UPSERT_PROFILE` / `DELETE_PROFILE` - Manage model configurations
- `UPSERT_RUN` / `DELETE_RUN` - Manage benchmark runs
- `RECORD_DIAGNOSTIC` - Store diagnostic results in profile history

All state changes automatically sync to Supabase via `src/services/storage.ts`.

### Data Normalization

Both profiles and runs go through normalization functions (`normalizeProfile`, `normalizeRun`) that:
- Merge partial updates with existing records
- Apply defaults from `src/data/defaults.ts`
- Ensure all required fields are present
- Maintain createdAt/updatedAt timestamps

### LM Studio Integration (src/services/)

**lmStudioClient.ts**
- `sendChatCompletion()` - Sends chat requests to `/v1/chat/completions`
- Automatic JSON-mode fallback: if the server rejects `response_format: { type: 'json_object' }`, retries without it and sets `fallbackUsed: true`
- Returns `ChatCompletionResult` with usage stats and raw response

**diagnostics.ts**
- `runDiagnostics()` - Executes two-tier diagnostics:
  - **HANDSHAKE** (Level 1): Validates server connectivity and JSON-mode support
  - **READINESS** (Level 2): Runs a sample question through the full pipeline to verify answer parsing and evaluation
- Stores results in profile's `diagnostics[]` array with timestamps and structured logs

**benchmarkEngine.ts**
- `executeBenchmarkRun()` - Orchestrates the full benchmark execution:
  - Iterates through selected questions
  - Builds prompts with question text, options, and formatting instructions
  - Calls LM Studio for each question
  - Parses responses via `parseModelResponse()` (src/services/evaluation.ts)
  - Evaluates answers via `evaluateModelAnswer()`
  - Aggregates metrics (accuracy, latency, pass/fail counts)
  - Streams progress via `onProgress` callback
  - Supports AbortSignal for cancellation

**evaluation.ts**
- `parseModelResponse()` - Extracts `answer`, `explanation`, `confidence` from JSON or plain text
- `evaluateModelAnswer()` - Type-specific evaluation:
  - **MCQ**: Single option match (A, B, C, D)
  - **MSQ**: Multiple options match (A,C or A, C)
  - **NAT**: Numeric range validation or exact string match
  - **TRUE_FALSE**: Boolean comparison
- Returns `BenchmarkAttemptEvaluation` with expected/received/passed/score

### UI Structure (React Router)

```
/ (AppLayout wrapper)
├── /dashboard - KPI cards, trend charts (Recharts), latest runs table
├── /profiles - Profile list, diagnostics panel, CRUD operations
├── /runs - Runs table with filters, "New run" flow
└── /runs/:runId - Run detail with metrics, charts, attempt breakdown
```

### Key Type Definitions (src/types/benchmark.ts)

- `BenchmarkQuestion` - Question data with type, prompt, options, answer key, metadata
- `ModelProfile` - LM Studio config + benchmark steps + diagnostics history + metadata (supportsJsonMode, lastHandshakeAt, lastReadinessAt)
- `BenchmarkRun` - Run metadata + question IDs + attempts + metrics
- `BenchmarkAttempt` - Single question evaluation with request/response payloads, latency, tokens, and evaluation results
- `DiagnosticsResult` - Diagnostic run with level, status, logs, and metadata

### Question Dataset

The question loader (src/data/questions.ts) ingests `pyq-gate-sample.json`:
- 100 normalized GATE PYQs
- Types: MCQ, MSQ, NAT, TRUE_FALSE
- Plain-string prompts/options (legacy rich-text fields removed Oct 2025)
- Metadata includes topology (subject/topic/subtopic), PYQ year/exam/branch, and tags

The topology catalog (src/data/topology.ts) loads `pyq-gate-sample-topology.json` for subject/topic/subtopic filters.

## Important Patterns

### Modal Implementation
All modals should have translucent backgrounds (per user global instructions).

### JSON Mode Handling
Always respect `profile.metadata.supportsJsonMode`:
- If `false`, skip `response_format` in chat completion requests
- If `undefined`, attempt JSON mode and fall back on error (handled automatically by `sendChatCompletion`)

### Diagnostics Before Benchmark
The UI blocks benchmark launch until both HANDSHAKE and READINESS diagnostics pass for the selected profile. This ensures the model can handle the full pipeline before executing long-running evaluations.

### Question Prompt Format
Prompts follow a consistent structure (see `buildQuestionPrompt` in benchmarkEngine.ts):
1. Question header with type
2. Optional instructions
3. Options list (A, B, C, D for MCQ/MSQ)
4. JSON format instructions: `{ "answer": "...", "explanation": "...", "confidence": 0-1 }`
5. Special handling for NAT numeric ranges

## Known Limitations & Roadmap

### Pending Backend Integration
- Supabase currently stores complete benchmark payloads; future work may add per-user auth and server-side analytics.
- If migrating away from Supabase, mirror the contracts defined in `src/types/benchmark.ts` and update `src/services/storage.ts` accordingly.

### Future Enhancements
1. Cancellation controls and progress indicators for running benchmarks
2. FILL_BLANK and descriptive question evaluation with rubric scoring
3. Dataset import/export (CSV/JSON)
4. Screenshot capture for completed runs
5. Server-side caching or virtualization for large question banks

## Path Aliases

The project uses `@/` as an alias for `src/`:
- Configured in vite.config.ts (`resolve.alias`)
- Use `@/components/...`, `@/services/...`, etc. in imports

## Code Style

- React 19 with functional components and hooks
- Strict TypeScript with ESLint rules
- Recharts for data visualization
- No emoji usage unless explicitly requested
