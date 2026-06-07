import { useMemo, useState } from 'react'
import {
  BookOpenCheck,
  Palette,
  FileSpreadsheet,
  Megaphone,
  Headset,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { Button } from './Button'
import { portfolioFilters, portfolioItems, type PortfolioStatus } from '../data/content'

const portfolioIcons: Record<string, LucideIcon> = {
  BookOpenCheck,
  Palette,
  FileSpreadsheet,
  Megaphone,
  Headset,
  FileText,
}

const statusStyles: Record<PortfolioStatus, string> = {
  'Sample Ready': 'bg-lavender-100 text-lavender-700',
  'Coming Soon': 'bg-amber-50 text-amber-700',
}

export function Portfolio() {
  const [activeFilter, setActiveFilter] = useState<(typeof portfolioFilters)[number]>('All')

  const filteredItems = useMemo(() => {
    if (activeFilter === 'All') return portfolioItems
    return portfolioItems.filter((item) => item.category === activeFilter)
  }, [activeFilter])

  return (
    <Section id="portfolio" tone="tinted">
      <SectionHeading
        eyebrow="Portfolio Showcase"
        title="A look at the kind of work I do"
        description="Sample categories that reflect the support, materials, and content Airah can prepare for you."
      />

      <Reveal className="mb-10 flex flex-wrap items-center justify-center gap-2" delay={1}>
        {portfolioFilters.map((filter) => {
          const isActive = filter === activeFilter
          return (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveFilter(filter)}
              aria-pressed={isActive}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lavender-500 ${
                isActive
                  ? 'bg-lavender-600 text-white shadow-md shadow-lavender-400/40'
                  : 'bg-white text-[#5b5266] hover:bg-lavender-100 hover:text-lavender-700'
              }`}
            >
              {filter}
            </button>
          )
        })}
      </Reveal>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filteredItems.map((item, index) => {
          const Icon = portfolioIcons[item.iconName]
          return (
            <Reveal key={item.title} delay={(index % 4) as 0 | 1 | 2 | 3}>
              <article className="lift flex h-full flex-col gap-4 rounded-2xl border border-lavender-100 bg-white p-6 shadow-sm shadow-lavender-200/40">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700">
                    {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>
                    {item.status}
                  </span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[#2d2438]">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[#6b6375]">{item.description}</p>
                </div>
                <Button variant="ghost" href="#contact" className="mt-auto self-start px-4 py-2">
                  View Sample
                </Button>
              </article>
            </Reveal>
          )
        })}
      </div>

      {filteredItems.length === 0 && (
        <p className="mt-10 text-center text-sm text-[#6b6375]">No samples in this category yet — check back soon.</p>
      )}
    </Section>
  )
}
