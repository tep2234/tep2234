import { CalendarCheck, Mail, MessagesSquare, FileText, GraduationCap } from 'lucide-react'
import { usePointerParallax } from '../hooks/usePointerParallax'

const sceneCards = [
  {
    Icon: FileText,
    label: 'Document Ready',
    style: { top: '6%', left: '4%', width: '160px' },
    depth: 70,
    tilt: -8,
  },
  {
    Icon: CalendarCheck,
    label: 'Schedule Synced',
    style: { top: '0%', right: '2%', width: '150px' },
    depth: 110,
    tilt: 6,
  },
  {
    Icon: MessagesSquare,
    label: 'New Message',
    style: { bottom: '14%', left: '0%', width: '155px' },
    depth: 40,
    tilt: 5,
  },
  {
    Icon: Mail,
    label: 'Inbox Organized',
    style: { bottom: '2%', right: '8%', width: '165px' },
    depth: 90,
    tilt: -5,
  },
  {
    Icon: GraduationCap,
    label: 'Lesson Prepared',
    style: { top: '38%', left: '38%', width: '150px' },
    depth: 150,
    tilt: 0,
  },
] as const

/**
 * CSS-only 3D-inspired visual: layered cards floating in perspective space,
 * gently responding to pointer movement. No Three.js dependency required.
 */
export function HeroScene() {
  const stageRef = usePointerParallax<HTMLDivElement>()

  return (
    <div
      className="scene-3d relative mx-auto h-[420px] w-full max-w-md sm:h-[460px]"
      aria-hidden="true"
    >
      <div
        ref={stageRef}
        className="scene-3d-stage relative h-full w-full"
        style={{
          transform:
            'rotateY(calc(var(--px, 0) * 6deg)) rotateX(calc(var(--py, 0) * -6deg))',
        }}
      >
        {sceneCards.map(({ Icon, label, style, depth, tilt }, index) => (
          <div
            key={label}
            className={`scene-card flex items-center gap-3 border border-white/60 bg-white/80 px-4 py-3 ${
              index % 2 === 0 ? 'float-slow' : 'float-slower'
            }`}
            style={{
              ...style,
              transform: `translateZ(${depth}px) rotate(${tilt}deg) translate(calc(var(--px, 0) * ${
                6 + index * 2
              }px), calc(var(--py, 0) * ${6 + index * 2}px))`,
            }}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender-100 text-lavender-700">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-[#3f2a5b]">{label}</span>
          </div>
        ))}

        <div
          className="absolute inset-0 m-auto h-44 w-44 rounded-full bg-gradient-to-br from-lavender-200 via-lavender-100 to-white opacity-80 blur-2xl"
          style={{ transform: 'translateZ(-40px)' }}
        />
      </div>
    </div>
  )
}
