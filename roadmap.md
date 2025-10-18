# KG AI Benchmark – UI Enhancement Roadmap

## Executive Summary

**Current State:**
KG AI Benchmark is a React 19 + TypeScript application for benchmarking local LLMs hosted in LM Studio (or any OpenAI-compatible runtime) using a curated GATE PYQ dataset. The app is fully client-side with all state persisted to browser localStorage.

**Technology Stack:**
- React 19.2.0 with functional components and hooks
- TypeScript with strict mode
- React Router 7.9.4
- Recharts 3.3.0 for data visualization
- Pure CSS (no framework currently)
- Vite build system

**Purpose of This Document:**
This roadmap tracks our UI enhancement initiative focusing on:
1. **Tailwind CSS Migration** - Replace 1100+ lines of custom CSS with utility-first framework
2. **Theme System** - Add auto-detecting dark/light mode with manual override
3. **Intelligent Defaults** - Implement hybrid form defaults and expand LM Studio parameters
4. **Layout Improvements** - Fix modals, improve spacing consistency, enhance visual hierarchy

---

## Previously Completed Features

✅ **Model Profile Management**
- Create/edit/delete profiles with LM Studio connection configs
- Save profiles to localStorage with normalization
- Two-tier diagnostics system:
  - Level 1 (Handshake): Validates connectivity and JSON-mode support
  - Level 2 (Readiness): Runs full pipeline with sample question
- Diagnostics history tracking per profile

✅ **Benchmark Execution Engine**
- Question selection with filtering (topology, type, year, tags)
- Progress tracking with attempt-level metrics
- JSON-mode fallback handling (auto-retry without response_format)
- Evaluation engine supporting MCQ, MSQ, NAT, TRUE_FALSE question types
- Runs persist to localStorage with full attempt details

✅ **Dashboard & Analytics**
- KPI summary cards (accuracy, latency, pass/fail counts)
- Trend charts with Recharts (accuracy vs latency)
- Recent runs table with filtering
- Run detail view with attempt breakdown

✅ **Question Dataset**
- 100 GATE PYQ questions loaded from JSON
- Topology catalog (subject/topic/subtopic)
- Metadata including year, exam, branch, tags
- Plain-string prompts and options (legacy rich-text removed Oct 2025)

✅ **UI Architecture**
- React Router with layout wrapper
- Centralized BenchmarkContext for state management
- Reducer pattern with actions (UPSERT_PROFILE, UPSERT_RUN, etc.)
- Automatic localStorage sync via storage service

---

## Current UI Enhancement Initiative

### Phase 1: Tailwind CSS Migration

**Goal:** Replace custom CSS with Tailwind utility classes for better maintainability and consistency.

- [ ] Install dependencies (tailwindcss, postcss, autoprefixer)
- [ ] Create `tailwind.config.js` with custom theme configuration
  - Colors: Indigo (accent), Green (success), Red (danger), Amber (warning), Slate (neutrals)
  - Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48, 64px
  - Font family: Inter + system fonts
  - Custom shadows matching current design
  - Enable dark mode with `class` strategy
- [ ] Create `postcss.config.js` with Tailwind and Autoprefixer
- [ ] Update `vite.config.ts` to ensure PostCSS processing
- [ ] Replace `src/styles/global.css` with Tailwind directives + minimal custom styles
  - Keep scrollbar styling and base font settings
  - Remove all 1100+ lines of component CSS

---

### Phase 2: Theme System Implementation

**Goal:** Add auto-detecting dark/light mode with manual override and localStorage persistence.

- [ ] Create `src/context/ThemeContext.tsx`
  - ThemeProvider component with `useTheme()` hook
  - Auto-detection via `window.matchMedia('(prefers-color-scheme: dark')`
  - Listen to system theme changes
  - Manual toggle support: 'light' | 'dark' | 'auto'
  - Store preference in localStorage as `theme-preference`
  - Apply/remove `dark` class on `<html>` element
- [ ] Configure dark mode colors in `tailwind.config.js`
  - Light mode: Default Tailwind colors
  - Dark mode: Custom slate-900/950 backgrounds, slate-100 text, slate-700 borders
- [ ] Update `src/main.tsx` to wrap app in ThemeProvider
- [ ] Add theme toggle button in `src/components/AppLayout.tsx`
  - Three-state toggle: ☀️ Light → 🌙 Dark → Auto
  - Display in sidebar header
  - Show current state with tooltip

---

### Phase 3: Intelligent Defaults System

**Goal:** Add intelligent defaults to profile creation form and expand LM Studio parameters.

**3.1 Enhanced Defaults Configuration**
- [ ] Update `src/data/defaults.ts`
  - Add new parameter defaults:
    - `topP: 0.9` (nucleus sampling threshold)
    - `frequencyPenalty: 0.0` (token repetition penalty)
    - `presencePenalty: 0.0` (topic repetition penalty)
  - Create `DEFAULT_PROFILE_VALUES` constant for reuse
  - Add JSDoc comments explaining each parameter

**3.2 Type Definitions**
- [ ] Update `src/types/benchmark.ts` - Add to ModelProfile interface:
  - `topP?: number`
  - `frequencyPenalty?: number`
  - `presencePenalty?: number`

**3.3 Profile Form with Hybrid Defaults**
- [ ] Update `src/pages/Profiles.tsx`
  - **Pre-filled fields** (critical parameters):
    - Name: "New Profile"
    - Provider: "LM Studio"
    - Base URL: "http://localhost:1234"
    - Temperature: 0.2
    - Max Output Tokens: 512
    - Request Timeout: 120000ms
    - Top P: 0.9
    - Frequency Penalty: 0.0
    - Presence Penalty: 0.0
  - **Placeholder-only fields** (optional):
    - API Key: "api-key (optional)"
    - Model ID: "e.g., openai/gpt-oss-120b"
    - Notes: "Add notes about this profile..."
  - Add new parameter inputs in grid layout:
    - Top P (0-1, step 0.1)
    - Frequency Penalty (0-2, step 0.1)
    - Presence Penalty (0-2, step 0.1)
  - Add helper text below inputs:
    - Temperature: "Lower = more focused, higher = more creative"
    - Top P: "Nucleus sampling for response diversity"
    - Frequency Penalty: "Reduce token repetition in responses"
    - Presence Penalty: "Reduce topic repetition in responses"

**3.4 LM Studio Client Updates**
- [ ] Update `src/services/lmStudioClient.ts`
  - Include new parameters in chat completion payload:
    ```typescript
    top_p: profile.topP,
    frequency_penalty: profile.frequencyPenalty,
    presence_penalty: profile.presencePenalty
    ```

---

### Phase 4: Component Migration to Tailwind

**Goal:** Convert all components from custom CSS to Tailwind utility classes.

**4.1 Reusable UI Components**
- [ ] Create `src/components/Modal.tsx`
  - Backdrop: `fixed inset-0 bg-black/75 dark:bg-black/90 backdrop-blur-md`
  - Panel: `bg-white dark:bg-slate-800` with slide-in animation
  - Escape key handler and click-outside-to-close
  - Focus trap for modal content
  - Props: `isOpen`, `onClose`, `title`, `children`
- [ ] Create `src/components/ui/Button.tsx`
  - Variants: primary (indigo), danger (red), ghost (transparent)
  - Sizes: sm, md, lg
  - Disabled state styling
- [ ] Create `src/components/ui/Card.tsx`
  - Base card: `bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6`
  - Optional hover effect

**4.2 Layout Components**
- [ ] Migrate `src/components/AppLayout.tsx` to Tailwind
  - Grid layout: `grid grid-cols-[280px_1fr] lg:grid-cols-1`
  - Sidebar: `bg-gradient-to-b from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black`
  - Navigation links: `hover:bg-white/10 transition-colors`
  - Active state: `bg-indigo-600`
  - Add theme toggle button

**4.3 Page Components**
- [ ] Migrate `src/pages/Dashboard.tsx` to Tailwind
  - Summary cards: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6`
  - Card styling: `bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 hover:-translate-y-0.5 transition-transform`
  - Value text: `text-4xl font-bold text-slate-900 dark:text-slate-100`
  - Label text: `text-sm text-slate-600 dark:text-slate-400`
  - Charts section: `grid lg:grid-cols-[1.15fr_0.85fr] gap-6`
- [ ] Migrate `src/pages/Profiles.tsx` to Tailwind
  - Two-column layout: `grid grid-cols-[minmax(260px,320px)_1fr] lg:grid-cols-1 gap-6`
  - Profile list: `space-y-2`
  - Profile item: `backdrop-blur-md bg-white/10 dark:bg-slate-800/50 rounded-lg p-4 cursor-pointer hover:bg-white/20 transition-colors`
  - Form grid: `grid grid-cols-1 md:grid-cols-2 gap-4`
  - Wide fields (system prompt, notes): `md:col-span-2`
  - Input styling: `bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500`
  - Labels: `text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5`
- [ ] Migrate `src/pages/Runs.tsx` to Tailwind
  - **IMPORTANT:** Replace `<aside>` NewRunPanel with `<Modal>` component
  - Add proper modal state management (open/close)
  - Table: `bg-white dark:bg-slate-800 rounded-lg overflow-hidden`
  - Table rows: `even:bg-slate-50 dark:even:bg-slate-900/50 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors`
  - Table cells: `px-5 py-4`
  - Status pills:
    - Base: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium`
    - Ready: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
    - Failed: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
- [ ] Migrate `src/pages/RunDetail.tsx` to Tailwind
  - Summary cards: Same grid as Dashboard
  - Attempt cards: `border-l-4` with color coding
    - Pass: `border-green-500 dark:border-green-400`
    - Fail: `border-red-500 dark:border-red-400`
  - Attempt metrics: `grid grid-cols-2 sm:grid-cols-4 gap-4`
  - Explanation box: `bg-slate-50 dark:bg-slate-900/50 rounded-md p-4`
  - Error messages: `text-red-600 dark:text-red-400`

---

### Phase 5: Visual Hierarchy & Polish

**Goal:** Enhance visual hierarchy, improve spacing consistency, and add polish.

- [ ] Apply consistent Tailwind spacing scale
  - Container gaps: `gap-6` (24px) or `gap-8` (32px)
  - Card padding: `p-6` (24px)
  - Section margins: `space-y-6`
  - Form field spacing: `space-y-4`
  - Button groups: `gap-3` (12px)
- [ ] Enhance card and panel styling
  - Hover effects: `hover:-translate-y-0.5 transition-transform duration-200`
  - Shadow on hover: `hover:shadow-md`
  - Border styling: `border border-slate-200 dark:border-slate-700`
- [ ] Improve status pill contrast
  - High contrast colors with dark mode variants
  - Pass/success: `bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400`
  - Fail/error: `bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400`
  - Ready/info: `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400`
- [ ] Add table hover effects
  - Row hover: `hover:bg-indigo-50 dark:hover:bg-indigo-900/20`
  - Smooth transitions: `transition-colors duration-150`
- [ ] Improve form field styling
  - Labels: Increase size to `text-sm`, bold `font-medium`
  - Focus rings: `focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2`
  - Helper text: `text-xs text-slate-500 dark:text-slate-400 mt-1`
- [ ] Add smooth transitions
  - All color changes: `transition-colors duration-200`
  - Transform effects: `transition-transform duration-200`
  - Theme switching: CSS transitions on background/color/border

---

## Technical Specifications

### Tailwind Configuration

**Color Palette:**
```javascript
colors: {
  accent: colors.indigo,
  success: colors.green,
  danger: colors.red,
  warning: colors.amber,
  // Extend with custom shades if needed
}
```

**Dark Mode:**
- Strategy: `darkMode: 'class'`
- Light backgrounds: `slate-50`, `white`
- Dark backgrounds: `slate-900`, `slate-950`
- Light text: `slate-900`
- Dark text: `slate-100`
- Borders light: `slate-200`, `slate-300`
- Borders dark: `slate-700`, `slate-600`

**Spacing Scale:**
Custom spacing maintained via Tailwind defaults (4, 8, 12, 16, 20, 24, 32, 48, 64px)

**Typography:**
```javascript
fontFamily: {
  sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
}
```

### New LM Studio Parameters

| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `topP` | number | 0.9 | 0-1 | Nucleus sampling threshold for response diversity |
| `frequencyPenalty` | number | 0.0 | 0-2 | Penalize token repetition (0 = no penalty) |
| `presencePenalty` | number | 0.0 | 0-2 | Penalize topic repetition (0 = no penalty) |

**Existing Parameters:**
- `temperature`: 0.2 (0-2 range)
- `maxOutputTokens`: 512 (min 16, step 16)
- `requestTimeoutMs`: 120000 (min 1000, step 1000)

### Theme System Architecture

**ThemeContext State:**
```typescript
type ThemeMode = 'light' | 'dark' | 'auto';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}
```

**Storage:**
- Key: `theme-preference`
- Values: `'light'` | `'dark'` | `'auto'`
- Default: `'auto'` (respects system preference)

**Implementation:**
- System detection: `window.matchMedia('(prefers-color-scheme: dark)')`
- Listen for changes: `matchMedia.addEventListener('change', handler)`
- Apply theme: Toggle `dark` class on `document.documentElement`

### Hybrid Form Defaults Strategy

**Pre-filled Fields (Critical):**
Fields that users typically need immediately and should have sensible defaults visible in the input.
- Connection config: Name, Provider, Base URL
- Model parameters: Temperature, Max Tokens, Timeout, Top P, Frequency Penalty, Presence Penalty

**Placeholder-only Fields (Optional):**
Fields that are either optional or require user-specific values.
- API Key (optional for LM Studio)
- Model ID (user must specify their model)
- Notes (optional metadata)

**Rationale:**
This approach reduces friction for new users while making it clear which fields are required vs optional.

---

## Progress Tracking

| Phase | Task | Status | Notes |
|-------|------|--------|-------|
| **1** | Install Tailwind dependencies | ✅ Completed | tailwindcss, postcss, autoprefixer installed |
| **1** | Create tailwind.config.js | ✅ Completed | Custom theme with accent/success/danger colors, dark mode enabled |
| **1** | Create postcss.config.js | ✅ Completed | Configured with Tailwind and Autoprefixer |
| **1** | Update vite.config.ts | ✅ Completed | No changes needed - Vite auto-processes PostCSS |
| **1** | Replace src/styles/global.css | ✅ Completed | Reduced from 1104 to 72 lines - only Tailwind directives + scrollbar styling |
| **2** | Create ThemeContext | ✅ Completed | Auto-detection, localStorage persistence, system listener |
| **2** | Configure dark mode in Tailwind | ✅ Completed | Already done in Phase 1 (darkMode: 'class') |
| **2** | Update main.tsx with ThemeProvider | ✅ Completed | App wrapped in ThemeProvider |
| **2** | Add theme toggle in AppLayout | ✅ Completed | Cycle button (Light→Dark→Auto) with icons, migrated to Tailwind |
| **3** | Update defaults.ts | ✅ Completed | Added DEFAULT_PROFILE_VALUES with topP, penalties, JSDoc comments |
| **3** | Update benchmark.ts types | ✅ Completed | Added topP, frequencyPenalty, presencePenalty to ModelProfile |
| **3** | Update Profiles.tsx form | ✅ Completed | Hybrid defaults (pre-filled critical, placeholders optional), added topP/penalties inputs |
| **3** | Add helper text to inputs | ✅ Completed | Added helper text for Temperature, Top P, Frequency/Presence Penalty |
| **3** | Update lmStudioClient.ts | ✅ Completed | Added top_p, frequency_penalty, presence_penalty to payload |
| **4** | Create Modal component | ✅ Completed | Translucent backdrop (blur), escape/click-outside handlers, slide-in animation |
| **4** | Create Button component | ✅ Completed | Variants: primary, danger, ghost, default; Sizes: sm, md, lg |
| **4** | Create Card component | ✅ Completed | Base card with optional hover effect |
| **4** | Migrate AppLayout to Tailwind | ✅ Completed | Already done in Phase 2 with theme toggle |
| **4** | Migrate Dashboard to Tailwind | ✅ Completed | All sections migrated: summary cards, charts, dataset, recent runs table |
| **4** | Migrate Profiles to Tailwind | ✅ Completed | Profile list, form inputs, textareas, benchmark steps, buttons, diagnostics all migrated |
| **4** | Migrate Runs to Tailwind | ✅ Completed | NewRunPanel converted to Modal component, filters/table/form all migrated |
| **4** | Migrate RunDetail to Tailwind | ✅ Completed | Header, summary cards, charts, dataset, attempt breakdown all migrated |
| **5** | Apply consistent spacing scale | ⬜ Not Started | |
| **5** | Enhance cards and panels | ⬜ Not Started | |
| **5** | Improve status pills | ⬜ Not Started | |
| **5** | Add table hover effects | ⬜ Not Started | |
| **5** | Improve form field styling | ⬜ Not Started | |
| **5** | Add smooth transitions | ⬜ Not Started | |

**Status Legend:**
- ⬜ Not Started
- 🟡 In Progress
- ✅ Completed
- ⏭️ Skipped (if applicable)

---

## Important Notes & Decisions

### Modal Requirements
- All modals MUST have translucent backdrop with `backdrop-blur-md` or `backdrop-blur-lg`
- Current issue: NewRunPanel in Runs page is an `<aside>` element, not a proper modal
- Fix: Convert to Modal component with overlay, escape handler, and click-outside-to-close

### JSON Mode Fallback
- LM Studio client automatically retries without `response_format` if server rejects it
- Level 2 diagnostics rely on this fallback for OSS models
- Fallback status tracked in `profile.metadata.supportsJsonMode`

### Theme Preference Behavior
- Auto mode: Respects system preference and updates in real-time
- Manual mode: User override persists in localStorage
- Toggle sequence: Light → Dark → Auto (cycles through states)

### Scope Limitations
- **No keyboard navigation enhancements** - Not a priority per user request
- **No accessibility improvements** - Focusing on visual and functional improvements only
- **No backend integration** - App remains client-side with localStorage

### Design Consistency
- All components should use Tailwind utility classes
- Avoid inline styles unless absolutely necessary
- Custom CSS limited to global base styles and scrollbar styling
- Maintain BEM naming for any remaining custom classes

---

## Next Steps

1. ✅ Document created and approved
2. ⬜ Begin Phase 1: Tailwind CSS setup
3. ⬜ Update this document's progress table after each completed task
4. ⬜ Mark tasks 🟡 when starting, ✅ when completed

**How to Use This Document:**
- Reference this roadmap before starting each task
- Update the Progress Tracking table as you work
- Add notes in the rightmost column for any blockers or decisions
- Keep technical specifications updated if implementation details change

---

**Last Updated:** 2025-10-18 (Phase 4 complete - 8/8 tasks | Phase 5 remaining - 0/6 tasks)
