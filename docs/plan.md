# Static Markdown drop viewer (React + TypeScript)

> Plan snapshot. Source: `md_drop_viewer_pwa` (Cursor). Implementation lives in this repository.

## Goals

- **Drop zone**: Full-page (or prominent) area that accepts `.md` (and optionally plain text) via drag-and-drop; **each new drop replaces the rendered content** in the main view.
- **Render**: "AI-grade" Markdown — **GFM** (tables, task lists, strikethrough, autolinks), **fenced code** with **syntax highlighting**, **` ```mermaid `** diagrams, **inline/display math** (LaTeX-style), and **images** (HTTPS, HTTP, and `data:` URLs). Output must stay **as safe as practical** (sanitized HTML; see below).
- **Persistence**: **IndexedDB** stores **files and version history** so content can be reopened **offline** later.
- **Delivery**: **Static** build (no server): `vite build` emits **`dist/`** suitable for **GitHub Pages** and other static hosts. Configure Vite’s **[`base`](https://vitejs.dev/config/shared-options.html#base)** to match the hosting path (see below).

## Recommended stack

| Concern | Choice | Rationale |
|--------|--------|-----------|
| Tooling | [Vite](https://vitejs.dev/) + React + TypeScript | Fast dev server, static `dist/`; set `base: '/REPO/'` for **project** GitHub Pages (`user.github.io/REPO/`) or `base: '/'` for **user/org** site (`user.github.io`) |
| MD core | `react-markdown` + **remark** plugins | Unify parser pipeline with `remark-gfm` for GFM |
| Math | `remark-math` + `rehype-katex` + `katex` CSS | AIs often emit `$inline$` and `$$block$$` math; KaTeX is a standard fit in React |
| Code | **Shiki** (via `rehype-shiki` or a custom `code` component with `@shikijs/rehype` / `shiki` + `hast` bridge) or `react-syntax-highlighter` + Prism | High-fidelity highlighting for many languages; pick one consistent approach |
| Mermaid | `mermaid` (npm) + **custom** handling of ` ```mermaid` fences | Map fenced `language-mermaid` to a client-rendered container; call `mermaid.run()` after content mounts (or use a small wrapper that re-runs on content change) |
| Images | Default `img` in `react-markdown` with **`loading`/`decoding`** and optional max-width CSS | Support `https:`, `http:`, and `data:image/...;base64,...` in `src` |
| Sanitization | `rehype-sanitize` with a **custom schema** | Default schema strips KaTeX/MathML-ish nodes; extend allowlists for **KaTeX output** (e.g. `span`/`math` with safe class prefixes), **code**/`pre` classes for Shiki, and safe `img[src]` patterns only (e.g. http/https/blob/data image). Avoid `rehype-raw` unless you add a very strict sub-schema—raw HTML in MD is a common XSS path |
| Frontmatter (optional) | `remark-frontmatter` + `remark-matter` or `gray-matter` in a pre-step | Many AI exports start with `---` YAML; strip or show as metadata so body still renders |
| Browser DB | [Dexie](https://dexie.org/) (IndexedDB) | Small API, good for "files + versions" queries |
| Offline shell (optional) | `vite-plugin-pwa` | Service worker precaches the app so the **UI loads offline**; **user data** still lives in IndexedDB (survives offline by design). Must use the **same `base` as Vite** so the SW and assets resolve under `https://user.github.io/REPO/` |

## GitHub Pages hosting

- **Build output**: `npm run build` (or `pnpm build`) produces **`dist/`** with hashed assets; upload that folder’s **contents** to the Pages source (or let Actions do it).
- **`base` URL** (required for project sites):
  - **Project site** at `https://<user>.github.io/<repo>/` → in [`vite.config.ts`](https://vitejs.dev/config/) set `base: '/<repo>/'` (trailing slash per Vite convention).
  - **User/organization** site at `https://<user>.github.io/` (repo often `username.github.io`) → `base: '/'`.
- **Environment**: Prefer `import.meta.env.BASE_URL` in code if any links need the prefix; Vite injects this from `base`.
- **Router**: This app is a **single view** with no client-side routes, so you **do not** need the common `404.html` → `index.html` SPA hack for deep links—only `base` matters for asset URLs.
- **Deploy options** (pick one in implementation):
  - **GitHub Actions** with [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact) + [actions/deploy-pages](https://github.com/actions/deploy-pages) (official "GitHub Pages" workflow), *or* push `dist` to a `gh-pages` branch, *or* use a tool like `gh-pages` / `peaceiris/actions-gh-pages`.
- **PWA on a subpath**: `vite-plugin-pwa` (if enabled) should register the service worker with **`scope` / `base` alignment** so precaching matches `/REPO/`; verify offline after deploy, not only on `localhost`.

## Rich rendering pipeline (what "anything an AI might put in" implies)

- **Fenced code**: All common `` ```lang `` blocks get **syntax highlighting**; unknown languages fall back to a plain pre/code.
- **Mermaid**: Fences with `mermaid` as the info string render as diagrams, not as highlighted text.
- **Math**: Delimiters per `remark-math` (typically `\(...\)` / `\[...\]` and `$...$` / `$$...$$` with options)—configure to match what you see in ChatGPT/Claude-style exports.
- **Images & links**: `![](url)` and `[text](url)` work for remote URLs. **Caveat (browser security)**: Markdown that references **relative** paths like `![](./shot.png`) **cannot** load those bytes from a single dropped `.md` file unless the user also drops a folder or you add a file-picker flow—**keep in plan as known limitation**; same-folder assets are a future enhancement.
- **Diagrams (non-Mermaid)**: If you need **PlantUML**, Graphviz, etc., treat as a follow-up (extra WASM/binaries or server). Mermaid alone covers a large share of AI outputs.
- **Styling**: Include KaTeX and Mermaid theme-friendly CSS; ensure **dark/light** does not break diagrams (Mermaid `theme` API or CSS variables).

## Data model (IndexedDB)

Use two concepts so "replace on drop" and "history" both work:

1. **`files`** — logical file record: `id`, `name` (from `File.name`), `currentVersionId` (or latest blob ref).
2. **`versions`** — append-only snapshots: `id`, `fileId`, `content` (string), `createdAt` (timestamp), optional `source` (`'drop' | 'restore'`).

**On each drop**: Resolve or create `file` by **filename**; **append** a new `version` with full text; set **current** to that version; **replace** the React view with this content.

**Retrieval UI** (minimal but useful): a **sidebar or drawer** listing **recent files**; selecting one loads its **latest** (or a chosen version from a small version list). Deleting old versions can be a follow-up.

## Key implementation details

- **Read dropped file**: `DataTransferItem.getAsFile()` / `e.dataTransfer.files[0]`, then `file.text()` for UTF-8 (note: very large files may need streaming later—out of scope unless you want a cap + warning).
- **Replace behavior**: single piece of React state, e.g. `activeContent` + `activeMeta` (filename, versionId); new drop overwrites that state only (history remains in IDB).
- **Persistence errors**: if IDB is unavailable, still render from the drop; surface a non-blocking message.
- **Styling**: minimal CSS (or your preferred utility stack) for a clear drop affordance, readable **prose** width for MD, and **Mermaid** container overflow (horizontal scroll for wide diagrams if needed).
- **Plugin order**: `remark` plugins first (`gfm`, `math`, frontmatter as needed) → `rehype` plugins (KaTeX, then Shiki if using rehype form, then `rehype-sanitize` last so it runs on the final HAST). If Shiki is implemented purely via a custom `components.code` in `react-markdown`, you may not need a rehype Shiki plugin—**pick one** approach to avoid double-processing.
- **Mermaid lifecycle**: Re-run Mermaid on each markdown string change; use a **stable id** or `mermaid`’s `destroy` if switching diagrams to avoid duplicate IDs in the DOM.

## Project layout (suggested)

- `index.html`, `vite.config.ts` — **`base`** for GitHub Pages, PWA plugin (if any)
- `.github/workflows/` — optional `deploy.yml` to build and publish `dist` to GitHub Pages
- `src/main.tsx`, `src/App.tsx`
- `src/components/DropZone.tsx`, `MarkdownPane.tsx`, `FileLibrary.tsx` (names flexible)
- `src/components/markdown/` — optional split: `MermaidBlock.tsx`, `CodeBlock.tsx`, `markdownOptions.ts` (unified `ReactMarkdown` plugins and components)
- `src/db/schema.ts` — Dexie database class and types
- `src/hooks/useMarkdownFile.ts` — drop handler + persist flow (optional; logic may live in `App` instead)

## Verification

- Manual: drop a sample with **headings, lists, GFM table, task list**, **fenced TypeScript/JSON/python**, a **` ```mermaid` ** flowchart, **inline and block LaTeX**, and a **remote** `![]()` image; confirm each renders.
- Replace: drop a second file; main pane updates; library shows both.
- Refresh + library: restore prior file/version; mermaid and math still render.
- Airplane mode: app shell loads (if PWA enabled); library still lists stored text and reopens; **new** remote images that were never loaded may fail until online (expected) — **data URLs and previously cached** assets behave better.
- **GitHub Pages**: run a production build with the target `base`, serve `dist` locally with a static server that **prefixes the path** (e.g. `preview` on `/REPO/`) or push to a test repo; confirm **JS/CSS load** and **no broken asset paths** in the network tab.

## Out of scope (unless you want them next)

- **Relative local assets** next to a dropped `.md` (e.g. `![](./img.png)`) without an explicit folder/zip import or file picker — browser cannot infer filesystem paths from a single file drop
- Edit-in-browser and save new versions from edits
- **Raw HTML in markdown** (optional future: `rehype-raw` with aggressive sanitization)
- Exotic **non-Mermaid** diagram notations (PlantUML, etc.) without extra deps
- Sync across devices (would need a backend)
