import { defaultSchema, type Schema } from 'hast-util-sanitize'

/**
 * Let KaTeX / GFM / images work while still passing through GitHub-style cleaning.
 * Code blocks in markdown are then handled by a custom `code` component, not raw HTML in the tree.
 */
export const markdownSchema: Schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp'],
    longDesc: ['http', 'https'],
    src: ['http', 'https', 'data', 'blob'],
  },
  attributes: {
    ...defaultSchema.attributes,
    span: [
      ['className', /^katex/],
      'style',
      'ariaHidden',
    ],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'math',
    'mi',
    'mo',
    'mn',
    'mrow',
    'msup',
    'msub',
    'mfrac',
    'semantics',
    'annotation',
    'mtable',
    'mtr',
    'mtd',
  ],
}
