import type { ReactNode } from 'react'
import { useReveal } from '../hooks/useReveal'

interface RevealProps {
  children: ReactNode
  delay?: 0 | 1 | 2 | 3 | 4
  className?: string
}

/** Fades and slides content into view as it enters the viewport. */
export function Reveal({ children, delay = 0, className = '' }: RevealProps) {
  const ref = useReveal<HTMLDivElement>()
  const delayClass = delay ? `reveal-delay-${delay}` : ''

  return (
    <div ref={ref} className={`reveal ${delayClass} ${className}`.trim()}>
      {children}
    </div>
  )
}
