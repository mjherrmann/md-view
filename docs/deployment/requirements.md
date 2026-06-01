# Deployment — Requirements

> Status: Accepted
> Accepted by: retroactive documentation
> Accepted on: 2026-06-01

## Glossary

| Term | Definition |
|------|-----------|
| PWA | Progressive Web App — installable, offline-capable web application |
| Service Worker | Background script that intercepts network requests for caching |
| GitHub Pages | Static hosting service from GitHub for repository sites |
| Base URL | Path prefix for all assets when hosted on a subpath |

## Requirements

### Requirement 1: Static Build Output

**User Story:** As a developer, I want a static `dist/` build suitable for any static host, so that deployment requires no server runtime.

#### Acceptance Criteria

1. THE `npm run build` command SHALL produce a `dist/` directory with all assets (JS, CSS, HTML, SVG).
2. THE build SHALL use TypeScript compilation (`tsc -b`) followed by Vite bundling.
3. THE build SHALL support a configurable base URL via `VITE_BASE` environment variable (default: `/`).

### Requirement 2: GitHub Pages Deployment

**User Story:** As a developer, I want automated deployment to GitHub Pages on push to main, so that the app is always up to date.

#### Acceptance Criteria

1. THE repository SHALL include a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys on push to `main` or `master`.
2. THE workflow SHALL set `VITE_BASE` to `/${{ github.event.repository.name }}/` for project-site hosting.
3. THE workflow SHALL use `actions/upload-pages-artifact` + `actions/deploy-pages` for deployment.
4. THE workflow SHALL use Node LTS with npm caching.

### Requirement 3: PWA / Offline Shell

**User Story:** As a user, I want the app shell to load offline after first visit, so that I can access my stored documents without internet.

#### Acceptance Criteria

1. THE system SHALL register a service worker via `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
2. THE service worker SHALL precache all static assets matching `**/*.{js,css,html,ico,svg,woff,woff2}`.
3. THE app SHALL include a web manifest with `display: standalone`, app name "Markdown drop viewer", and dark theme color.
4. THE service worker scope and manifest `start_url` SHALL align with the configured `base` URL.
5. WHILE offline, THE app shell SHALL load and display previously stored documents from IndexedDB.

### Requirement 4: Development Server

**User Story:** As a developer, I want a fast dev server with HMR and PWA enabled in dev mode, so that I can iterate quickly.

#### Acceptance Criteria

1. THE `npm run dev` command SHALL start a Vite dev server with React HMR.
2. THE PWA plugin SHALL be enabled in dev mode (`devOptions.enabled: true`) for service worker testing.
