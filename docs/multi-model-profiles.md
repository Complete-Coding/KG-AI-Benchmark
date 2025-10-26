# Multi-Model Profiles & Vision Preprocessing (Working Plan – Oct 2025)

This doc tracks design + implementation tasks for making benchmark profiles multi-model aware while keeping everything runnable on macOS/LM Studio today. DeepSeek-OCR is the long-term target, but until a Mac/GGUF build lands we stick to Mac-ready models (GOT-OCR 2.0, Qwen2.5-VL 7B, Gemma‑3 Vision).

---

## Goals
- Allow a saved profile to chain capability-specific bindings (image-to-text, text-to-text, etc.).
- Automatically summarize any referenced images before the main text reasoning step.
- Keep configuration simple: Step 1 shows only vision models; Step 2 shows only text models.
- Design everything so DeepSeek-OCR drops in later with minimal rewiring.

---

## Mac-Ready Model Options

| Model | Why it fits | Packaging | Notes |
| --- | --- | --- | --- |
| **GOT-OCR 2.0** | OCR-centric Vision-LM (Qwen backbone) with DocVQA strength | GGUF (`Jerry666/GOT-OCR2_0-716M-BF16-GGUF`) | Lightweight; solid markdown output |
| **Qwen2.5-VL 7B** | General multimodal agent (DocVQA 95.7, OCRBench 864) | LM Studio community GGUF (`lmstudio-community/Qwen2.5-VL-7B-Instruct-GGUF`) | Good fallback for charts/tool prompts |
| **Gemma‑3 Vision** | Google’s multimodal Gemma release (4 B/12 B/27 B) | Community GGUF (`mradermacher/amoral-gemma3-12B-vision-GGUF`) | Friendly to Apple Silicon; detailed captions |

*Future target:* **DeepSeek-OCR** once a GGUF/Metal build appears (currently CUDA only).

---

## Pipeline Design (target state)

1. **Step 1 – Image preprocessing (`image-to-text`)**
   - Detect referenced image URLs in the question payload (prompt/options/solution).
   - Call the configured vision binding once per unique image (batch when possible).
   - Cache summaries keyed by image URL + binding ID (avoid re-OCRing across runs).
   - Return standardized `ImageSummary[]` (id, text, confidence, raw response).

2. **Step 2 – Text reasoning (`text-to-text`)**
   - Merge the image summaries into the prompt template (Markdown/JSON block).
   - Reuse existing benchmark steps (topology + answer).
   - Log both raw model responses and injected image summaries for audit.

---

## Implementation Phases & To‑Dos

### Phase 1 – Data & Type Foundations
**Goal:** Introduce bindings + pipeline metadata while keeping existing profiles compatible.

**Tasks**
- [x] Update `ModelProfile` type to include:
  - `bindings: ModelBinding[]` with `capability`, `transport`, auth, sampling params.
  - `pipeline: ProfilePipelineStep[]` pointing at bindings.
  - `legacy` payload for old single-model fields (provider, baseUrl, etc.).
- [x] Implement normalization helpers:
  - Convert legacy profiles on load (`BenchmarkContext`, storage migration).
  - Ensure at least one text binding exists; optionally add default pipeline steps.
- [x] Update default profile settings (`src/data/defaults.ts`) with:
  - Initial text binding template.
  - Two-step pipeline (image preprocess disabled by default, text main).
- [x] Adjust Supabase storage layer to persist new structure (keep name/model metadata for quick queries).
- [x] Update discovery logic (`lmStudioDiscovery`, `BenchmarkContext`) to work off bindings instead of profile globals.
- [ ] Refresh profile creation/adoption UI to edit bindings (text + optional vision).

**Deliverables**
- New `ModelBinding`/`ProfilePipelineStep` types.
- Profile editor storing bindings/pipeline into context/storage.
- No behavioural change yet (vision step still disabled).

### Phase 2 – Services & Diagnostics
**Goal:** Make service clients and diagnostics operate on bindings.

**Tasks**
- [x] Update `lmStudioClient.sendChatCompletion` to accept a binding (baseUrl/modelId/auth, sampling params).
- [x] Rework `fetchModels` to use binding details for discovery.
- [x] Patch diagnostics (`performHandshake`, `performReadinessCheck`) to:
  - Fail early if no text binding.
  - Use binding settings for API calls.
  - Record binding metadata in diagnostic logs.
- [x] Patch compatibility check to:
  - Use text binding.
  - Persist binding info into result metadata.
- [x] Update Supabase run metadata if needed (e.g., store current binding IDs in run payloads).

**Deliverables**
- Services/diagnostics run against configured text binding.
- JSON-mode detection/handshake unchanged functionally, just binding-aware.
- Run attempts now record the binding id/transport for auditing, matching Supabase payload expectations.

### Phase 3 – Question Assets & OCR Preprocessing
**Goal:** Capture image references and wire the vision step into run execution.

**Tasks**
- [x] Extend question loader (`src/data/questions.ts`) to emit:
  - `BenchmarkQuestion.media.images[]` capturing URL, source, alt text.
  - `metadata.hasImages` reliability check (fallback to scanning for `<img>` & markdown links).
- [x] Add `ImageSummary` type and attach to `BenchmarkAttempt`.
- [x] Implement preprocessing module:
  - Check pipeline for enabled `image-to-text` binding.
  - Fetch each image (download/resolve relative URL to blob if needed).
  - Call vision binding (new helper, similar to `sendChatCompletion` but with image payload).
  - Cache responses (in-memory per run + persistent optional?).
- [x] Modify prompt construction (`benchmarkEngine`) to inject image summaries (decide on Markdown vs JSON structure for now).
- [x] Extend logging to show OCR text + raw outputs in run detail view.

**Deliverables**
- Run execution automatically calls vision binding when configured.
- Text prompt includes summarized image context.
- Attempt records show image summaries for audit/debug.

### Phase 4 – UI & Workflow Polish
**Goal:** Surface bindings/pipeline in UI, make configuration intuitive, and guard invalid states.

**Tasks**
- [x] Update Profiles list/detail to show binding summary (vision model, status, last OCR run).
- [x] Add gating in run creation:
  - Step 1 only list profiles with valid image binding for image-enabled runs.
  - Provide warnings if pipeline disabled but dataset has images.
- [x] Enhance discovery/adoption UI to allow selecting binding capability when importing from LM Studio.
- [x] Update run detail view:
  - Show which binding handled each step (vision vs text).
- [x] Add helpful defaults (e.g., recommended prompts for GOT/Qwen/Gemma).

**Deliverables**
- Profile editor and run screens reflect multi-binding design.
- Users can toggle vision step on/off and pick appropriate models.

### Phase 5 – DeepSeek-OCR Enablement (Future)
**Goal:** Rapidly integrate DeepSeek-OCR once Mac/GGUF build exists.

**Tasks**
- [x] Add DeepSeek-specific binding template (extra params like compress mode).
- [ ] Implement custom client if DeepSeek requires non-standard HTTP payload (e.g., PDF support).
- [ ] Update documentation + UI hints for conversion/compression settings.

---

## Open Questions
- **Prompt format between steps:** Markdown bullet list vs JSON block vs templated string? Need consistent token-safe format for text models.
- **Image fetching:** Where do we store downloaded images? Do we prefetch from remote URLs or rely on local cache? Consider storage limits.
- **Caching scope:** In-run only, or cross-run caching keyed by image hash? Need invalidation plan.
- **Diagnostics coverage for vision step:** Should we add a mini-vision handshake (sample image prompt) once Phase 3 lands?
- **Rate limiting:** Do we need per-binding concurrency controls to avoid starving LM Studio when multiple runs hit the same model?

---

## Reference Links
- GOT-OCR 2.0 model card: https://huggingface.co/stepfun-ai/GOT-OCR2_0
- GOT-OCR GGUF build: https://huggingface.co/Jerry666/GOT-OCR2_0-716M-BF16-GGUF
- Qwen2.5-VL 7B model card: https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- Qwen2.5-VL GGUF (LM Studio): https://huggingface.co/lmstudio-community/Qwen2.5-VL-7B-Instruct-GGUF
- Gemma3 Vision release (PyTorch): https://github.com/google/gemma_pytorch/blob/main/README.md
- Gemma3 GGUF: https://huggingface.co/mradermacher/amoral-gemma3-12B-vision-GGUF
- LM Studio docs (GGUF support): https://github.com/lmstudio-ai/docs/blob/main/0_app/0_root/index.md
- DeepSeek-OCR model card: https://huggingface.co/deepseek-ai/DeepSeek-OCR (future re-integration)
