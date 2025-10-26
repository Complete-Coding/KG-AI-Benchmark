# Topology Accuracy Investigation – October 2025

## Context
- Supabase credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are present in `.env.local`, enabling direct access to the `runs` and `profiles` tables. Recent analysis used the anonymous key via the REST endpoint (`rest/v1/runs`) to inspect stored run payloads.
- Current question set: 7 GATE PYQ sample questions (`src/data/benchmark-questions.json`) with ground-truth subject/topic/subtopic IDs mapped to the taxonomy in `src/data/benchmark-topology.json`.
- Benchmark engine pipeline: `executeBenchmarkRun` issues a dedicated topology classification step (first) followed by answer generation. Prompts are assembled with `defaultBenchmarkSteps[0]`, which inlines the full taxonomy for every question.

## Summary of Findings
- Reviewed 10 recent runs (60 topology attempts). Aggregate metrics:
  - Topology accuracy (`subjectId` & `topicId` & `subtopicId` all match) = **3.3 %** (2 of 60).
  - Field-level matches: subject 12/60 (20 %), topic 11/60 (18 %), subtopic 4/60 (6.7 %).
  - Answer accuracy across the same runs ranges from 28 %–85 %, confirming the issue is topology-specific.
- Token budget: topology prompts average **29 k prompt tokens** (max 31 k) because the full taxonomy is embedded for each call. Several target models have ≤8k–16k token context windows, so they likely truncate or lose salient instructions.
- Structural confusion is rampant:
  - **21/60** predictions supplied a valid *topic* ID in the `subjectId` field; **17/60** supplied a *subtopic* ID in the `topicId` field.
  - **10/60** subject IDs and **17/60** topic IDs were not found anywhere in the taxonomy (often strings like `"null"` or hallucinated IDs).
  - Subtopic picks skew toward generic buckets (`Basics`, `HTTP`, `Graph Traversal`) even when the question ground truth is a specific concept (e.g., `Electronic Mail` for question 3833, `Linear Probing` for question 3947).
- Example misclassifications (run `71aca9f3-d895-4592-b60e-31dc41d499d8`):
  - Q3945 (Graph shortest path): expected `Algorithm › Single Source Shortest Path › Multiple Topics`; model returned topic ID in `subjectId` (`68da42cb…` → Hashing) and subtopic `Graph Representation`.
  - Q3786 (Transport-layer for email): instructions request `subtopicId: null` when not applicable, but JSON schema enforces strings. Several responses emit `"subtopicId": "null"`, which fails evaluation.
  - Q3844 (Mod-258 counter): subject reported as topic (`68cbe536…` → Number System) instead of the parent subject (`Digital Electronics`), leading to `received "— › Number System › Basics"` in stored evaluations.
- Prompt structure mixes subjects, topics, and subtopics with identical bullet formatting. Models do not get explicit delineation between hierarchy levels beyond indentation, which many LLMs ignore when copying IDs.

## Root-Cause Hypotheses
1. **Prompt overload** – Embedding ~30 k tokens of taxonomy per request mutes instructions and risks truncation on smaller-context models. Even when not truncated, retrieving the correct parent ID requires the model to scan the entire catalog on every call.
2. **Hierarchical ambiguity** – IDs are visually identical across levels; without labels like “Subject ID:” or explicit parent mapping, models frequently copy the first matching ID (topic or subtopic) into the `subjectId` slot.
3. **Schema vs. instructions conflict** – Prompt tells the model to emit `null` when no subtopic applies, but the enforced JSON schema (`TOPOLOGY_SCHEMA`) only accepts strings. Models either hallucinate string `"null"` or pick a random subtopic to stay valid.
4. **Ground-truth drift** – Some expected labels (e.g., SSSP tagged under Algorithm while many knowledge bases place it under Graph Theory/Data Structures) may conflict with model priors. This mismatch exacerbates already noisy predictions.
5. **Lack of retrieval/filtering** – Every question sees the full taxonomy; there is no heuristic to pre-filter to relevant subjects (e.g., based on keywords or historical mappings), so the search space is massive.

## Recommended Remediation Plan

### Phase 1 — Instrument & Triage (immediate)
- Add telemetry to store per-field pass rates (`subject`, `topic`, `subtopic`) and whether returned IDs exist in the taxonomy; surface this in the run detail view for faster diagnosis.
- Extend the stored attempt record with a derived flag when the model returns a topic/subtopic ID in the wrong slot so we can quantify improvement over time.
- Patch the JSON schema used for topology (and instructions) to allow `null` for `subtopicId` when a question lacks a tagged subtopic.
- Review the seven-question ground truth for potential relabeling or acceptance of multiple valid branches (e.g., treat both `Algorithm › SSSP` and `Data Structure › Graph` as acceptable for Q3945) before tightening parsing logic.

### Phase 2 — Prompt Restructure (short-term)
- **Adopt a three-call topology pipeline** (subject → topic → subtopic):
  1. **Subject classification** – send a compact subject-only catalog and request `{ "subjectId": string, "confidence": number }`.
  2. **Topic classification** – include the previously predicted subject (ID + name) and only the topics belonging to that subject; request `{ "topicId": string, "confidence": number }`.
  3. **Subtopic classification** – supply both subject and topic context plus the relevant subtopics; request `{ "subtopicId": string, "confidence": number }`.
- Update prompts to explicitly forbid returning `"null"`; instruct the model to provide its best-guess ID alongside a confidence score, and treat very low confidence (<0.3) as “unsure” during evaluation rather than relying on nulls.
- Persist field-level matches (`subject`, `topic`, `subtopic`) for each stage so Supabase runs expose granular accuracy in addition to overall pass/fail.
- Adjust `defaultBenchmarkSteps` so every profile (LM Studio local models, OpenAI-compatible remotes, etc.) executes three separate JSON-mode calls; ensure `lmStudioClient` exposes schemas for each stage (new `schemaType` values like `topologySubject`, `topologyTopic`, `topologySubtopic`) so existing models remain compliant without manual profile edits.
- Add 2–3 worked examples per stage to illustrate the intended reasoning, especially for overlapping concepts (graph algorithms vs. data structures, transport-layer protocols vs. application-layer services, digital electronics counters).
- Pre-truncate each stage’s catalog further via keyword filtering to keep prompts comfortably below the smallest model context window.

### Phase 3 — Post-Processing Guardrails (medium-term)
- Implement a validator that, when `subjectId` is not a known subject but *is* a topic, auto-promotes its parent subject and shifts the provided IDs down one level (similarly for `topicId` that maps to a subtopic). Log these corrections so we can iterate on prompting rather than silently masking issues.
- Support soft matching: allow a small whitelist of alternate IDs per question (or per subtopic) using metadata so evaluation can mark near-miss but semantically correct answers as `partial` instead of `fail`.
- Consider a lightweight retriever (BM25 or embedding search) over taxonomy descriptions to propose the top-k candidate branches, then let the model rank them instead of free-form ID generation.

### Phase 4 — Dataset & Tooling (long-term)
- Normalize the taxonomy JSON (or ship it from Supabase) so IDs and names stay in sync between prompt data and evaluation helpers.
- Create a taxonomy management script that can flag dangling IDs (present in dataset but missing in `benchmark-topology.json`) and generate compact subject/topic lookup tables for prompts.
- Build an admin review workflow where misclassified attempts can be labeled manually; feed these corrections back into prompt tuning or question metadata adjustments.

## Next Steps
1. Patch `TOPOLOGY_SCHEMA` to accept `null` subtopics and redeploy the evaluation service.
2. Prototype a “subject-first” prompt using the existing run simulator and replay the latest runs locally to measure improvement before touching production runs.
3. Schedule a taxonomy audit session to validate ground-truth assignments for the current seven questions and decide which alternative branches should be accepted.
4. After instrumentation lands, re-run benchmarks and compare per-field accuracy to the current 20 % / 18 % / 6.7 % baseline.

## Open Questions
- What is the maximum acceptable increase in latency or cost if we split topology classification into multiple API calls?
- Should we persist corrected classifications (post-processing fix-ups) back into Supabase for transparency, or leave the raw model output untouched?
- Do we expect future question sets to live exclusively within the current taxonomy, or do we need a fallback strategy when a question is genuinely out-of-taxonomy?
