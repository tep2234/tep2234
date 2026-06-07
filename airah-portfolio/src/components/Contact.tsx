import { Mail, Phone, MapPin, ExternalLink, MessageCircleMore } from 'lucide-react'
import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { Button } from './Button'
import { contact } from '../data/content'

const contactCards = [
  {
    Icon: Mail,
    label: 'Email',
    value: contact.email,
    href: `mailto:${contact.email}`,
    cta: 'Email Me',
  },
  {
    Icon: Phone,
    label: 'Phone',
    value: contact.phone,
    href: contact.phoneTel,
    cta: 'Call Airah',
  },
  {
    Icon: MessageCircleMore,
    label: 'Messenger',
    value: 'm.me/maj.grnts',
    href: contact.messenger,
    cta: 'Message on Messenger',
  },
  {
    Icon: ExternalLink,
    label: 'LinkedIn',
    value: 'View professional profile',
    href: contact.linkedin,
    cta: 'View LinkedIn',
    external: true,
  },
]

export function Contact() {
  return (
    <Section id="contact">
      <SectionHeading
        eyebrow="Get In Touch"
        title="Let's talk about how I can support you"
        description="Reach out through whichever channel works best — every message gets a prompt, friendly reply."
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {contactCards.map((card, index) => (
          <Reveal key={card.label} delay={(index % 4) as 0 | 1 | 2 | 3}>
            <div className="lift flex h-full flex-col gap-4 rounded-2xl border border-lavender-100 bg-white p-6 text-left shadow-sm shadow-lavender-200/40">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700">
                <card.Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-lavender-600">{card.label}</p>
                <p className="mt-1 text-sm font-medium text-[#2d2438]">{card.value}</p>
              </div>
              <Button
                variant="contact"
                href={card.href}
                target={card.external ? '_blank' : undefined}
                rel={card.external ? 'noopener noreferrer' : undefined}
                className="mt-auto w-full"
              >
                {card.cta}
              </Button>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={2} className="mx-auto mt-10 flex max-w-md items-center justify-center gap-2 rounded-full border border-lavender-100 bg-lavender-50/70 px-5 py-3 text-sm text-[#5b5266]">
        <MapPin className="h-4 w-4 shrink-0 text-lavender-600" aria-hidden="true" />
        <span>Based in {contact.location} — available for remote work worldwide</span>
      </Reveal>
    </Section>
  )
}
