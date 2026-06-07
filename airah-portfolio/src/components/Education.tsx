import { GraduationCap, Award } from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { education } from '../data/content'

export function Education() {
  return (
    <Section id="education" tone="tinted">
      <SectionHeading
        eyebrow="Education & Certification"
        title="A strong foundation in education and ESL instruction"
        align="left"
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {education.map((entry, index) => (
          <Reveal key={entry.school} delay={(index % 4) as 0 | 1 | 2 | 3}>
            <article className="lift flex h-full flex-col gap-4 rounded-2xl border border-lavender-100 bg-white p-7 shadow-sm shadow-lavender-200/40">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700">
                <GraduationCap className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-lavender-600">{entry.period}</p>
                <h3 className="mt-1 text-lg font-semibold text-[#2d2438]">{entry.school}</h3>
                <p className="text-sm font-medium text-[#7549ad]">{entry.program}</p>
              </div>
              <ul className="mt-auto flex flex-col gap-2">
                {entry.notes.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-sm text-[#6b6375]">
                    <Award className="mt-0.5 h-4 w-4 shrink-0 text-lavender-500" aria-hidden="true" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
