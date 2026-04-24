import {
  useMemo,
  type ImgHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { type Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { CodeBlock } from './markdown/CodeBlock'
import { MermaidBlock } from './markdown/MermaidBlock'
import { markdownSchema } from './markdown/sanitizeSchema'
import 'katex/dist/katex.min.css'

type CodeProps = {
  className?: string
  children?: React.ReactNode
  node?: object
  ref?: React.Ref<HTMLElement>
} & React.HTMLAttributes<HTMLElement>

const remarkPlugins = [
  [remarkGfm, { singleTilde: false }],
  [remarkMath, { singleDollarTextMath: true }],
]

const rehypePlugins = [
  [rehypeKatex, { errorColor: 'var(--md-math-error)', strict: 'ignore' }],
  [rehypeSanitize, markdownSchema],
]

type PaneProps = {
  markdown: string
  useDarkShiki: boolean
}

function buildComponents(useDarkShiki: boolean): Components {
  return {
    // Avoid <pre> wrapping a block that already contains <pre> from Shiki
    pre: ({ children }) => <div className="md-pre-wrap">{children}</div>,
    img: (p) => {
      const { src, alt, title, node, ref, children, ...rest } = p as ImgHTMLAttributes<HTMLImageElement> & {
        node?: unknown
        ref?: Ref<HTMLImageElement>
        children?: ReactNode
      }
      void node
      void ref
      void children
      if (src == null) {
        return null
      }
      return (
        <img
          src={src}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
          decoding="async"
          className="md-image"
          {...rest}
        />
      )
    },
    code(props: CodeProps) {
      const { className, children, ...rest } = props
      const isInline = !String(className ?? '').includes('language-')
      if (isInline) {
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        )
      }
      const text = String(children).replace(/\n$/, '')
      const match = /language-(\w+)/.exec(className ?? '')
      const lang = match ? match[1] : 'text'
      if (lang.toLowerCase() === 'mermaid') {
        return <MermaidBlock code={text} />
      }
      return (
        <CodeBlock
          code={text}
          language={lang}
          theme={useDarkShiki ? 'github-dark' : 'github-light'}
        />
      )
    },
  }
}

export function MarkdownPane({ markdown, useDarkShiki }: PaneProps) {
  const components = useMemo(
    () => buildComponents(useDarkShiki),
    [useDarkShiki]
  )

  return (
    <article className="markdown-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
