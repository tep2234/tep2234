import {
  Briefcase,
  ClipboardCheck,
  Headset,
  Mail,
  CalendarClock,
  Database,
  Search,
  FileText,
  PenSquare,
  GraduationCap,
  BookOpenCheck,
} from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { services } from '../data/content'

const serviceIcons = [
  Briefcase,
  ClipboardCheck,
  Headset,
  Mail,
  CalendarClock,
  Database,
  Search,
  FileText,
  PenSquare,
  GraduationCap,
  BookOpenCheck,
]

export function Services() {
  return (
    <Section id="services" tone="tinted">
      <SectionHeading
        eyebrow="What I Offer"
        title="Services built around your workflow"
        description="Reliable help for admin, communication, and learning support — so you can focus on what matters most."
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service, index) => {
          const Icon = serviceIcons[index % serviceIcons.length]
          return (
            <Reveal key={service} delay={((index % 3) as 0 | 1 | 2)}>
              <article className="lift group flex h-full flex-col gap-4 rounded-2xl border border-lavender-100 bg-white p-6 shadow-sm shadow-lavender-200/40">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700 transition-colors duration-300 group-hover:bg-lavender-600 group-hover:text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold text-[#2d2438]">{service}</h3>
              </article>
            </Reveal>
          )
        })}
      </div>
    </Section>
  )
}
