# Fixtures

- `synthetic/` — one file per global path, shaped from `docs/BRIEF.md`, plus `_errors.json` (400, 401, 402, 403, 404, 500). Marked `"synthetic": true`.
- `recorded/` — scrubbed staging responses written by `npm run fixtures:record`. A recorded file replaces the synthetic one for the same path.

Each file: `{ _meta: { path, synthetic }, request, responses: { ok, empty, ... } }`. Recorded fixtures never contain the API key; the recorder scrubs the key and its first 8 characters, and the CI key-leak check enforces it. Paged requests use `page_size` 1–2 (testing budget).
