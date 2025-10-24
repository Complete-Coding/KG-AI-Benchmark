# KG AI Benchmark

A React + TypeScript playground for benchmarking local LLMs hosted in LM Studio (or any
OpenAI-compatible runtime). The project now ships with a full dashboard, profile management,
diagnostics workflow, and an embedded 100-question GATE PYQ dataset so you can launch end-to-end
evaluations without additional scaffolding.

## Features

- ⚡️ Vite-powered React 19 + TypeScript setup with strict linting
- 🧭 Tabbed dashboard (Dashboard · Profiles · Runs · Run Detail) powered by a shared benchmark context
- 🧪 Level 1/Level 2 diagnostics against LM Studio with JSON-mode fallback and log history
- 📋 Question selector with filter/search + evaluation engine for MCQ/MSQ/NAT/TRUE_FALSE question types
- 📊 Recharts-based analytics (accuracy vs latency trends, pass/fail vs latency, KPI tiles)

## Getting started

```bash
npm install
npm run dev
```

The development server runs at [http://localhost:5173](http://localhost:5173).

## Available scripts

| Script        | Description                                      |
| ------------- | ------------------------------------------------ |
| `npm run dev` | Start the Vite development server                |
| `npm run lint`| Run ESLint with the configured TypeScript rules  |
| `npm run build`| Type-check and build the production bundle      |
| `npm run preview`| Preview the production build locally         |

## Usage workflow

1. **Create a profile** – open the Profiles tab, click “New profile”, and supply the LM Studio base
   URL (e.g., `http://127.0.0.1:1234`), model identifier, API key (if required), and prompt settings.
2. **Run diagnostics** – execute Level 1 (handshake) then Level 2 (readiness). The UI records logs,
   flags JSON-mode fallbacks, and blocks benchmarks until readiness passes.
3. **Launch a benchmark** – switch to the Runs tab, click “New run”, filter/select questions from the
   embedded PYQ dataset, and start the run. Progress streams live; results persist to Supabase so you
   can pick up on any device.
4. **Analyze results** – open any run to inspect accuracy, latency, token usage, and per-question
   responses/explanations. Dashboard trend lines summarize the most recent completions.

## Roadmap

1. Harden Supabase schemas/policies (per-user scoping, migrations) and backfill analytics views.
2. Add cancellation controls, progress indicators, and screenshot/export helpers.
3. Extend evaluation to descriptive/FILL_BLANK questions with rubric scoring.
4. Support dataset import/export to drive custom benchmark suites.

## License

MIT License © 2025 Complete Coding with Prashant Sir
