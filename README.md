# KG AI Benchmark

A React + TypeScript playground for building interactive evaluations across local LLM models. The
project ships with a modern dashboard layout, mocked benchmark data, and ready-to-use utilities so
you can focus on connecting LM Studio or any other inference runtime.

## Features

- ⚡️ Vite-powered React 19 + TypeScript setup with strict linting
- 🎯 Context-driven state management for benchmark runs and model selection
- 📊 Recharts-based visualization primitives for latency and accuracy trends
- 🧱 Modular component structure ready for expansion into new pages or charts

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

## Next steps

1. Replace the mocked data in `src/data/mockResults.ts` with real benchmark output once the LM Studio
   integration is ready.
2. Persist run history by wiring the context to your storage of choice (filesystem, SQLite, etc.).
3. Add new visualizations or analytics panels to highlight prompt-level insights.
4. Create upload/import utilities that transform raw model responses into the dashboard format.

## License

MIT License © 2025 Complete Coding with Prashant Sir
