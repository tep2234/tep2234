import { ShieldCheck, MessageSquareText, LayoutGrid, GraduationCap } from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { whyWorkWithMe } from '../data/content'

const icons: Record<string, typeof ShieldCheck> = {
  ShieldCheck,
  MessageSquareText,
  LayoutGrid,
  GraduationCap,
}

export function WhyWorkWithMe() {
  return (
    <Section id="why-work-with-me">
      <SectionHeading
        eyebrow="Why Work With Me"
        title="Trustworthy support you can count on"
        description="Every engagement is approached with care, organization, and genuine commitment to your goals."
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {whyWorkWithMe.map((reason, index) => {
          const Icon = icons[reason.iconName]
          return (
            <Reveal key={reason.title} delay={(index % 4) as 0 | 1 | 2 | 3}>
              <article className="lift flex h-full flex-col items-start gap-4 rounded-2xl border border-lavender-100 bg-gradient-to-b from-white to-lavender-50/60 p-6 shadow-sm shadow-lavender-200/40">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-lavender-700 shadow-sm shadow-lavender-200/60">
                  {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
                </span>
                <h3 className="text-base font-semibold text-[#2d2438]">{reason.title}</h3>
                <p className="text-sm leading-relaxed text-[#6b6375]">{reason.description}</p>
              </article>
            </Reveal>
          )
        })}
      </div>
    </Section>
  )
}
