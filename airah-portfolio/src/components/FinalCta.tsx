import { Mail, ExternalLink, Globe } from 'lucide-react'
import { Reveal } from './Reveal'
import { Button } from './Button'
import { contact } from '../data/content'

export function FinalCta() {
  return (
    <section id="final-cta" className="relative overflow-hidden px-6 py-20 md:py-28">
      <div
        aria-hidden="true"
        className="float-slow pointer-events-none absolute -left-16 top-6 h-56 w-56 rounded-full bg-lavender-200/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="float-slower pointer-events-none absolute -right-10 bottom-0 h-64 w-64 rounded-full bg-lavender-300/30 blur-3xl"
      />

      <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-3xl border border-lavender-100 bg-gradient-to-br from-white via-lavender-50 to-white px-8 py-14 text-center shadow-lg shadow-lavender-200/50 sm:px-14">
        <span className="inline-flex items-center gap-2 rounded-full bg-lavender-100 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-lavender-700">
          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
          Available for Remote Support
        </span>
        <h2 className="text-3xl font-bold tracking-tight text-[#2d2438] sm:text-4xl">
          Ready to bring more order to your day?
        </h2>
        <p className="max-w-xl text-base leading-relaxed text-[#6b6375]">
          Available for remote support across web-based tools, online classrooms, and digital
          communication platforms. Let's build a workflow that works for you.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Button variant="primary" href={`mailto:${contact.email}`} icon={Mail}>
            Work With Me
          </Button>
          <Button
            variant="outline"
            href={contact.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            icon={ExternalLink}
            iconPosition="right"
          >
            View LinkedIn
          </Button>
        </div>
      </Reveal>
    </section>
  )
}
