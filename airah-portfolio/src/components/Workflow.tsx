import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { iconRegistry } from '../lib/icons'
import { supportAreas, workflowSteps } from '../data/content'

export function Workflow() {
  return (
    <Section id="workflow" tone="tinted">
      <SectionHeading
        eyebrow="How It Works"
        title="How I Support Your Workflow"
        description="A simple, connected approach to keeping your day-to-day running smoothly."
      />

      {/* Canvas-style connected workflow cards */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="timeline-line absolute left-1/2 top-10 hidden h-[calc(100%-5rem)] w-px -translate-x-1/2 lg:block"
        />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {workflowSteps.map((step, index) => {
            const Icon = iconRegistry[step.iconName]
            return (
              <Reveal key={step.title} delay={(index % 4) as 0 | 1 | 2 | 3} className="relative">
                <article className="lift group flex h-full flex-col gap-4 rounded-2xl border border-lavender-100 bg-white p-6 shadow-sm shadow-lavender-200/40">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-lavender-500 to-lavender-300 text-white shadow-md shadow-lavender-300/50 transition-transform duration-300 group-hover:scale-110">
                    {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
                  </span>
                  <h3 className="text-lg font-semibold text-[#2d2438]">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-[#6b6375]">{step.description}</p>
                </article>
                {index < workflowSteps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-3 top-1/2 hidden h-px w-6 -translate-y-1/2 bg-lavender-200 sm:block lg:hidden"
                  />
                )}
              </Reveal>
            )
          })}
        </div>
      </div>

      {/* Parallel support-area "dashboard" */}
      <div className="mt-20">
        <Reveal className="mb-8 flex flex-col items-center gap-2 text-center">
          <span className="inline-flex items-center rounded-full bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-lavender-700 shadow-sm shadow-lavender-200/50">
            Parallel Support
          </span>
          <h3 className="text-2xl font-bold tracking-tight text-[#2d2438] sm:text-3xl">Support Areas Running Side by Side</h3>
          <p className="max-w-xl text-sm leading-relaxed text-[#6b6375]">
            Multiple support streams handled in parallel, so your priorities keep moving forward.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {supportAreas.map((area, index) => {
            const Icon = iconRegistry[area.iconName]
            return (
              <Reveal key={area.title} delay={(index % 4) as 0 | 1 | 2 | 3}>
                <div className="lift flex items-start gap-4 rounded-2xl border border-lavender-100 bg-white/90 p-5">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700">
                    {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-lavender-400 ring-2 ring-white" aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-[#2d2438]">{area.title}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#6b6375]">{area.description}</p>
                  </div>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
