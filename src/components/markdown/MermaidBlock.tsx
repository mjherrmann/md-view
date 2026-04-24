import mermaid from 'mermaid'
import { useId, useLayoutEffect, useRef, useState } from 'react'

let initDone = false

function ensureMermaid() {
  if (initDone) {
    return
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'default',
  })
  initDone = true
}

type Props = { code: string }

export function MermaidBlock({ code }: Props) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useLayoutEffect(() => {
    ensureMermaid()
    const el = ref.current
    if (!el) {
      return
    }
    const renderId = `mmd-${id.replace(/:/g, '')}-${el.offsetWidth}`
    setErr(null)
    let cancelled = false
    mermaid
      .render(renderId, code)
      .then(({ svg, bindFunctions }) => {
        if (cancelled || !ref.current) {
          return
        }
        ref.current.innerHTML = svg
        bindFunctions?.(ref.current)
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setErr(e.message)
        }
      })
    return () => {
      cancelled = true
      if (el) {
        el.innerHTML = ''
      }
    }
  }, [code, id])

  if (err) {
    return <pre className="mermaid-block mermaid-block--error">{err}</pre>
  }
  return <div className="mermaid-block" ref={ref} />
}
