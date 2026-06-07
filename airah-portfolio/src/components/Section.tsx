import type { ReactNode } from 'react'
import { Reveal } from './Reveal'

interface SectionProps {
  id: string
  children: ReactNode
  className?: string
  tone?: 'plain' | 'tinted'
}

export function Section({ id, children, className = '', tone = 'plain' }: SectionProps) {
  const toneClasses = tone === 'tinted' ? 'bg-lavender-50/60' : 'bg-transparent'

  return (
    <section id={id} className={`relative scroll-mt-24 ${toneClasses} ${className}`.trim()}>
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">{children}</div>
    </section>
  )
}

interface SectionHeadingProps {
  eyebrow?: string
  title: string
  description?: string
  align?: 'left' | 'center'
}

export function SectionHeading({ eyebrow, title, description, align = 'center' }: SectionHeadingProps) {
  const alignClasses = align === 'center' ? 'text-center items-center' : 'text-left items-start'

  return (
    <Reveal className={`mb-12 flex flex-col gap-3 ${alignClasses}`}>
      {eyebrow && (
        <span className="inline-flex items-center rounded-full bg-lavender-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-lavender-700">
          {eyebrow}
        </span>
      )}
      <h2 className="text-3xl font-bold tracking-tight text-[#2d2438] sm:text-4xl">{title}</h2>
      {description && (
        <p className={`max-w-2xl text-base leading-relaxed text-[#6b6375] ${align === 'center' ? 'mx-auto' : ''}`}>
          {description}
        </p>
      )}
    </Reveal>
  )
}
