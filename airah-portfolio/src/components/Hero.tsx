import { ArrowRight, Sparkles, Mail } from 'lucide-react'
import { Button } from './Button'
import { HeroScene } from './HeroScene'
import { Reveal } from './Reveal'
import { useScrollParallax } from '../hooks/useScrollParallax'
import { contact, hero } from '../data/content'

export function Hero() {
  const blobOne = useScrollParallax<HTMLDivElement>(0.12)
  const blobTwo = useScrollParallax<HTMLDivElement>(-0.08)
  const blobThree = useScrollParallax<HTMLDivElement>(0.05)

  return (
    <section id="hero" className="relative overflow-hidden pt-6 pb-16 sm:pt-10 sm:pb-24">
      {/* Decorative parallax background shapes */}
      <div
        ref={blobOne}
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-lavender-200/50 blur-3xl"
      />
      <div
        ref={blobTwo}
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 top-40 h-80 w-80 rounded-full bg-lavender-300/30 blur-3xl"
      />
      <div
        ref={blobThree}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-lavender-100/70 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <div className="flex flex-col items-start gap-6">
          <Reveal>
            <span className="badge-pop inline-flex items-center gap-2 rounded-full border border-lavender-200 bg-white/80 px-4 py-2 text-xs font-semibold text-lavender-700 shadow-sm shadow-lavender-200/60">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {hero.eyebrow}
            </span>
          </Reveal>

          <Reveal delay={1}>
            <h1 className="text-4xl font-extrabold leading-[1.12] tracking-tight text-[#2d2438] sm:text-5xl lg:text-[3.4rem]">
              Reliable <span className="gradient-text">Virtual Assistant</span>, Administrative
              Support Specialist, and ESL Educator
            </h1>
          </Reveal>

          <Reveal delay={2}>
            <p className="max-w-xl text-base leading-relaxed text-[#6b6375] sm:text-lg">
              {hero.subheadline}
            </p>
          </Reveal>

          <Reveal delay={3} className="flex flex-wrap items-center gap-4">
            <Button variant="primary" href={`mailto:${contact.email}`} icon={Mail}>
              Hire Me
            </Button>
            <Button variant="outline" href="#services" icon={ArrowRight} iconPosition="right">
              View Services
            </Button>
          </Reveal>

          <Reveal delay={4} className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm text-[#6b6375]">
            <span>📍 {contact.location}</span>
            <span className="hidden h-1 w-1 rounded-full bg-lavender-300 sm:inline-block" aria-hidden="true" />
            <span>TEFL-Certified ESL Educator</span>
          </Reveal>
        </div>

        <Reveal delay={2} className="relative">
          <HeroScene />
        </Reveal>
      </div>
    </section>
  )
}
