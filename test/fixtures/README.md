# Fixtures

- `synthetic/` — one file per global path, shaped from `docs/BRIEF.md`, plus `_errors.json` (400, 401, 402, 403, 404, 500). Marked `"synthetic": true`.
- `recorded/` — scrubbed live responses written by `npm run fixtures:record` (17 paths recorded 9 Oct 2026; KYB paths not yet, see docs/api-notes.md item 4). Contact paths are redacted of personal data by `scripts/redact-personal.ts`. Tests use the synthetic fixtures; `test/contract/recorded.test.ts` runs the tools against the recorded ones (decisions D47). The local mock API prefers recorded files.

Each file: `{ _meta: { path, synthetic }, request, responses: { ok, empty, ... } }`. Recorded fixtures never contain the API key; the recorder scrubs the key and its first 8 characters, and the CI key-leak check enforces it. Paged requests use `page_size` 1–2 (testing budget).
