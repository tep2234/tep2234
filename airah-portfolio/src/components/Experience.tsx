import { Briefcase } from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { experience } from '../data/content'

export function Experience() {
  return (
    <Section id="experience">
      <SectionHeading eyebrow="Experience" title="Hands-on experience supporting learners and clients" align="left" />

      <ol className="relative flex flex-col gap-8 border-l border-lavender-200 pl-8">
        {experience.map((item, index) => (
          <li key={item.role}>
            <Reveal delay={(index % 4) as 0 | 1 | 2 | 3} className="relative">
              <span className="absolute -left-[2.55rem] top-1 flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-lavender-500 to-lavender-300 text-white shadow-md shadow-lavender-300/50">
                <Briefcase className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="rounded-2xl border border-lavender-100 bg-white p-6 shadow-sm shadow-lavender-200/40">
                <p className="text-xs font-semibold uppercase tracking-wider text-lavender-600">{item.period}</p>
                <h3 className="mt-1 text-lg font-semibold text-[#2d2438]">{item.role}</h3>
                <p className="text-sm font-medium text-[#7549ad]">{item.org}</p>
                <p className="mt-3 text-sm leading-relaxed text-[#6b6375]">{item.description}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </Section>
  )
}
