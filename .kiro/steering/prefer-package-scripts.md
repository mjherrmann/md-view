# Prefer package.json Scripts

Run build, test, lint, and other project commands via `package.json` scripts (`npm run <script>`) rather than invoking tools directly with `npx`, `node_modules/.bin/`, or bare CLI commands.

## Why

- Scripts centralise flags, config paths, and environment variables in one place.
- Everyone (CI, contributors, agent) uses the same invocation.
- Avoids version mismatches between globally/locally installed binaries.

## Rules

- Use `npm run build`, `npm run test`, `npm run lint`, etc.
- if there are new scripts that are needed for development workflow then permission needs to be requested before adding them to package.json scripts
- Never use `npx vitest`, `npx tsc`, `npx eslint`, or similar when an equivalent script exists.
- For scoped test runs, prefer the script with extra args: `npm run test -- --run src/path/to/file.test.ts`.
