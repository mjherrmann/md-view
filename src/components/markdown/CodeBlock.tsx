import { useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

const ALIAS: Record<string, string> = {
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  tf: 'hcl',
  rs: 'rust',
}

function normalizeLang(lang: string): string {
  const l = lang.toLowerCase()
  if (l === 'text' || l === 'plain' || l === '') {
    return 'log'
  }
  return ALIAS[l] ?? l
}

type Props = {
  language: string
  code: string
  theme: 'github-dark' | 'github-light'
}

export function CodeBlock({ language, code, theme }: Props) {
  const [html, setHtml] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const lang = normalizeLang(language)
    void (async () => {
      try {
        const out = await codeToHtml(code, {
          lang,
          theme,
        })
        if (!cancelled) {
          setHtml(out)
          setErr(null)
        }
      } catch {
        try {
          const out = await codeToHtml(code, {
            lang: 'log',
            theme,
          })
          if (!cancelled) {
            setHtml(out)
            setErr(null)
          }
        } catch (e) {
          if (!cancelled) {
            setErr((e as Error).message)
            setHtml(
              `<pre class="shiki-fallback" tabindex="0"><code>${escapeHtml(
                code
              )}</code></pre>`
            )
          }
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  if (err && !html) {
    return <pre className="code-block code-block--error">{err}</pre>
  }

  return (
    <div
      className="code-block shiki-outer"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
