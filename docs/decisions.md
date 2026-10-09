# Decisions

Choices the brief leaves open, made so work could continue. Each can be revisited; change the entry rather than deleting it.

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| D1 | 2026-10-07 | npm workspaces monorepo: `packages/core`, `packages/http-server`, `packages/stdio` (npm name `@billofladingdata/mcp`). Core and http-server are private. | Matches the brief's layout with the least tooling; no Turborepo/Nx needed at this size. |
| D2 | 2026-10-07 | TypeScript 6.0 (not 7.0). | `typescript-eslint` 8.x supports TypeScript < 6.1; the lint rule that blocks logging secrets depends on it. Revisit when typescript-eslint supports 7. |
| D3 | 2026-10-07 | Node 24 in CI (`.nvmrc`), `engines: >=22`. | 24 is the current LTS; 22 is still maintained and is what local containers ship. |
| D4 | 2026-10-07 | Zod 4, using its built-in `z.toJSONSchema`. | The brief asks for Zod schemas exported as JSON Schema; Zod 4 does this natively and the MCP SDK accepts Zod 4. |
| D5 | 2026-10-07 | Env var names: `BOLD_TEST_API_KEY` (tests, gate), `BOLD_API_KEY` (stdio), `BOLD_API_BASE_URL`, `BOLD_API_TIMEOUT_MS` (default 25 000). | Brief names the first two; the `BOLD_` prefix avoids clashing with generic names such as `API_TIMEOUT_MS`. |
| D6 | 2026-10-07 | Key-leak check reads the key from the environment / CI secret and searches for its first 8 characters in every tracked or untracked non-ignored file, plus all history in CI. It never prints the prefix. Without the secret (fork PRs) it is skipped; on pushes and same-repo PRs a missing secret fails CI. | The prefix cannot be committed to the repo without defeating the check. |
| D7 | 2026-10-07 | Fixtures: synthetic fixtures (shape from the brief) for all 22 paths now; `npm run fixtures:record` overwrites them with scrubbed staging responses in `test/fixtures/recorded/`, which take precedence. Free paths record by default; paid paths need `--paid`, unlocks need `--unlocks`, with a `--max-credits` cap (default 500). | Lets M0/M1 work proceed without a key while keeping live spending opt-in and bounded. |
| D8 | 2026-10-07 | Until a GitHub repo is available, work happens in a local git repo with a copy in the project's shared files (`bold-mcp/`). | No GitHub account was linked to the build session. |
