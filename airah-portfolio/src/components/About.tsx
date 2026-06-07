import { GraduationCap, Languages, Target } from 'lucide-react'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { about } from '../data/content'

const highlights = [
  { Icon: GraduationCap, label: 'Bachelor of Secondary Education — English' },
  { Icon: Languages, label: 'TEFL-Certified ESL Educator' },
  { Icon: Target, label: 'Detail-driven administrative support' },
]

export function About() {
  return (
    <Section id="about">
      <div className="grid items-start gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <Reveal>
          <div className="flex flex-col gap-4">
            <span className="inline-flex w-fit items-center rounded-full bg-lavender-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-lavender-700">
              About Airah
            </span>
            <h2 className="text-3xl font-bold tracking-tight text-[#2d2438] sm:text-4xl">
              Organized, dependable, and ready to support your goals
            </h2>
            <ul className="mt-2 flex flex-col gap-3">
              {highlights.map(({ Icon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm font-medium text-[#5b5266]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender-50 text-lavender-600">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={1} className="flex flex-col gap-5 rounded-3xl border border-lavender-100 bg-white/80 p-8 shadow-sm shadow-lavender-200/40">
          {about.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="text-base leading-relaxed text-[#5b5266]">
              {paragraph}
            </p>
          ))}
        </Reveal>
      </div>
    </Section>
  )
}
