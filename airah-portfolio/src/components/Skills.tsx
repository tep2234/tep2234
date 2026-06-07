import { Section, SectionHeading } from './Section'
import { Reveal } from './Reveal'
import { skills } from '../data/content'

export function Skills() {
  return (
    <Section id="skills">
      <SectionHeading
        eyebrow="Strengths"
        title="Skills shaped by teaching and real client support"
        align="left"
      />

      <div className="grid grid-cols-1 gap-x-12 gap-y-7 md:grid-cols-2">
        {skills.map((skill, index) => (
          <Reveal key={skill.name} delay={(index % 4) as 0 | 1 | 2 | 3} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-[#2d2438]">{skill.name}</span>
              <span className="text-xs font-medium text-lavender-600">{skill.level}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-lavender-100">
              <div
                className="reveal-bar h-full rounded-full bg-gradient-to-r from-lavender-500 to-lavender-300 transition-[width] duration-1000 ease-out"
                style={{ width: `${skill.level}%` }}
              />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}
