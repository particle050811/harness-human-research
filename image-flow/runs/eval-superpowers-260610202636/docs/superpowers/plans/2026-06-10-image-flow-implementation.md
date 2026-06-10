# Image Flow VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete VS Code extension that generates AI images from Markdown files via Grsai API, with a React webview sidebar for task management, asset browsing, and configuration.

**Architecture:** Extension backend (CommonJS, esbuild) communicates with a React 19 + Radix UI webview sidebar via postMessage. Async image generation uses a single polling timer with persistence in globalState for resume-after-restart. Configuration is split across secrets (apiKey), globalState (settings), and workspaceState (asset folders).

**Tech Stack:** TypeScript, esbuild, React 19, Radix UI, Mocha + @vscode/test-cli, ESLint flat config

---

## File Structure

- `src/extension.ts` — Activation entry point, command registration, sidebar registration
- `src/shared.ts` — Message types, config interfaces, shared constants
- `src/config.ts` — Configuration read/write (secrets, globalState, workspaceState)
- `src/api.ts` — Grsai API client (generate POST, result GET)
- `src/markdown-parser.ts` — Markdown image syntax parsing and reference image extraction
- `src/task-manager.ts` — Async task lifecycle, polling timer, persistence, resume
- `src/asset-library.ts` — Manual + auto asset library scanning and management
- `src/preview.ts` — Preview request document generation
- `src/utils.ts` — Image whitelist, mime types, pixel table, URL helpers
- `src/sidebar-provider.ts` — Webview view provider, message handling
- `media/sidebar.tsx` — React webview application
- `media/sidebar.css` — Webview styles
- `test/` — Unit tests for pure logic functions

---

## Milestones

### M1: Scaffold + End-to-End Generation
- [ ] Create package.json, tsconfig files, esbuild config, eslint config
- [ ] Create .vscode/launch.json
- [ ] Implement markdown-parser.ts (image syntax parsing, reference image extraction)
- [ ] Implement api.ts (Grsai API client, multi-model size field logic)
- [ ] Implement extension.ts entry with commands and activation
- [ ] Build and verify end-to-end sync generation

### M2: Sidebar + Configuration System
- [ ] Implement config.ts (secrets, globalState, workspaceState)
- [ ] Implement sidebar-provider.ts (webview provider, CSP, postMessage)
- [ ] Create media/sidebar.tsx React app (three tabs: workbench, tasks, settings)
- [ ] Create media/sidebar.css
- [ ] Wire up configuration to sidebar

### M3: Async Task Mechanism
- [ ] Implement task-manager.ts (async submission, polling timer, persistence, resume)
- [ ] Update sidebar to show task progress
- [ ] Handle job lifecycle (submitting → running → succeeded/failed)
- [ ] Timeout and cleanup logic

### M4: Asset Library
- [ ] Implement asset-library.ts (manual + auto scanning)
- [ ] Add asset library UI to workbench tab
- [ ] Right-click insert reference with path handling

### M5: Preview Request
- [ ] Implement preview.ts (shared prompt assembly, preview document)
- [ ] Wire preview button in workbench and command

### M6: Prompt Injection
- [ ] Implement modelInjections config with seed logic
- [ ] IMAGES.md injection
- [ ] Apply to both submit and preview

### M7: UX Polish
- [ ] Background submission (instant card, no network wait)
- [ ] Progress bar and per-second timer in task cards
- [ ] Active MD following (preserve on non-MD tabs)
- [ ] Task/history merged reverse-chronological list

### M8: Robustness + Tests
- [ ] Runtime response validation
- [ ] Transient error retry detection
- [ ] Empty folder cleanup
- [ ] Polling re-entry lock
- [ ] Unit tests for all pure functions
- [ ] npm run compile, check-types, lint, test all passing
