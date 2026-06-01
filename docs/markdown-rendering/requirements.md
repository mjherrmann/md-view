# Markdown Rendering — Requirements

> Status: Accepted
> Accepted by: retroactive documentation
> Accepted on: 2026-06-01

## Glossary

| Term | Definition |
|------|-----------|
| GFM | GitHub Flavored Markdown — tables, task lists, strikethrough, autolinks |
| KaTeX | Fast math typesetting library for LaTeX-style expressions |
| Shiki | Syntax highlighter using TextMate grammars |
| Mermaid | Diagram-as-code library for flowcharts, sequence diagrams, etc. |
| Frontmatter | YAML metadata block delimited by `---` at the start of a markdown file |
| Sanitization | HTML cleaning pass that removes unsafe elements/attributes |

## Requirements

### Requirement 1: GFM Support

**User Story:** As a user, I want standard GitHub Flavored Markdown rendered correctly, so that tables, task lists, strikethrough, and autolinks display as expected.

#### Acceptance Criteria

1. WHEN markdown contains a pipe-delimited table, THE system SHALL render an HTML table with proper alignment.
2. WHEN markdown contains `- [ ]` or `- [x]` items, THE system SHALL render task list checkboxes.
3. WHEN markdown contains `~~text~~`, THE system SHALL render strikethrough text.
4. WHEN markdown contains bare URLs, THE system SHALL render clickable autolinks.
5. THE system SHALL NOT treat single-tilde `~text~` as strikethrough (singleTilde: false).

### Requirement 2: Math Rendering

**User Story:** As a user, I want LaTeX-style math expressions rendered visually, so that AI-generated documents with formulas display correctly.

#### Acceptance Criteria

1. WHEN markdown contains `$...$` inline delimiters, THE system SHALL render inline math via KaTeX.
2. WHEN markdown contains `$$...$$` block delimiters, THE system SHALL render display math via KaTeX.
3. IF KaTeX encounters a parse error, THE system SHALL display the expression with an error color indicator rather than crashing.
4. THE system SHALL include KaTeX CSS for proper typesetting.

### Requirement 3: Syntax-Highlighted Code Blocks

**User Story:** As a user, I want fenced code blocks highlighted by language, so that code is readable and visually distinct.

#### Acceptance Criteria

1. WHEN a fenced code block specifies a language (e.g. ` ```typescript `), THE system SHALL highlight it using Shiki with the specified language grammar.
2. IF the specified language is unknown to Shiki, THE system SHALL fall back to `log` language highlighting.
3. IF Shiki fails entirely, THE system SHALL render a plain `<pre><code>` block with escaped HTML.
4. THE system SHALL support common language aliases: `sh`→`bash`, `zsh`→`bash`, `yml`→`yaml`, `md`→`markdown`, `tf`→`hcl`, `rs`→`rust`.
5. WHEN the OS color scheme is dark, THE system SHALL use `github-dark` theme; otherwise `github-light`.

### Requirement 4: Mermaid Diagrams

**User Story:** As a user, I want ` ```mermaid ` fenced blocks rendered as diagrams, so that AI-generated architecture and flow diagrams display visually.

#### Acceptance Criteria

1. WHEN a fenced code block has language `mermaid`, THE system SHALL render it as an SVG diagram using the Mermaid library.
2. IF Mermaid rendering fails, THE system SHALL display the error message in a `<pre>` block.
3. THE system SHALL initialize Mermaid with `startOnLoad: false` and `securityLevel: 'loose'`.
4. THE system SHALL select Mermaid theme (`dark` or `default`) based on OS color scheme preference.
5. WHEN the user clicks an inline Mermaid diagram, THE system SHALL open a lightbox dialog with zoom controls.
6. THE lightbox SHALL support zoom in, zoom out, reset, and Ctrl/Cmd+wheel zoom (range 25%–400%).
7. THE lightbox SHALL close on Escape key, Close button, or clicking the backdrop.

### Requirement 5: Image Rendering

**User Story:** As a user, I want images in markdown rendered from remote URLs and data URIs, so that embedded visuals display.

#### Acceptance Criteria

1. WHEN markdown contains `![alt](url)` with an `https:`, `http:`, or `data:` src, THE system SHALL render an `<img>` element.
2. THE system SHALL set `loading="lazy"` and `decoding="async"` on images.
3. THE system SHALL apply a `md-image` CSS class for styling constraints.

### Requirement 6: Frontmatter Handling

**User Story:** As a user, I want YAML frontmatter stripped from the rendered body and optionally viewable, so that metadata does not pollute the document display.

#### Acceptance Criteria

1. WHEN a markdown file begins with `---` YAML frontmatter, THE system SHALL parse it using `gray-matter` and exclude it from the rendered body.
2. IF frontmatter contains keys, THE system SHALL display a collapsible "Front matter (YAML)" details section above the rendered content.
3. IF frontmatter parsing fails, THE system SHALL render the raw content without crashing.

### Requirement 7: HTML Sanitization

**User Story:** As a user, I want rendered HTML sanitized against XSS, so that malicious markdown cannot execute scripts.

#### Acceptance Criteria

1. THE system SHALL run `rehype-sanitize` as the final rehype plugin in the pipeline.
2. THE sanitization schema SHALL allow KaTeX-related elements: `math`, `mi`, `mo`, `mn`, `mrow`, `msup`, `msub`, `mfrac`, `semantics`, `annotation`, `mtable`, `mtr`, `mtd`.
3. THE sanitization schema SHALL allow `span` elements with className matching `/^katex/` and `style` attribute for KaTeX output.
4. THE sanitization schema SHALL allow `img[src]` with protocols: `http`, `https`, `data`, `blob`.
5. THE sanitization schema SHALL allow `href` protocols: `http`, `https`, `irc`, `ircs`, `mailto`, `xmpp`.

### Requirement 8: Dark/Light Theme Reactivity

**User Story:** As a user, I want the rendering to adapt to my OS color scheme, so that code and diagrams are readable in both modes.

#### Acceptance Criteria

1. THE system SHALL detect OS color scheme via `prefers-color-scheme` media query on load.
2. WHEN the OS color scheme changes at runtime, THE system SHALL update Shiki theme and re-render code blocks accordingly.
