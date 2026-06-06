---
inclusion: always
---

# Prefer package.json Scripts

All build, test, lint, and project commands MUST use `package.json` scripts (`npm run <script>`). Never invoke tools directly via `npx`, `node_modules/.bin/`, or bare CLI.

## Why

- Scripts centralise flags, config paths, and environment variables in one place.
- Everyone (CI, contributors, agent) uses the same invocation.
- Avoids version mismatches between globally/locally installed binaries.

## Rules

- Use `npm run build`, `npm run test`, `npm run lint`, etc.
- Adding new scripts to `package.json` requires explicit user permission first.
- Never use `npx vitest`, `npx tsc`, `npx eslint`, or similar when an equivalent script exists.
- For scoped test runs, prefer the script with extra args: `npm run test -- --run src/path/to/file.test.ts`.
