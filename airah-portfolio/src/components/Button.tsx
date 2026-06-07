import type { AnchorHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'contact'

interface ButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
  icon?: LucideIcon
  iconPosition?: 'left' | 'right'
  children: ReactNode
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold ' +
  'transition-all duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-lavender-500 active:scale-[0.97]'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-lavender-600 to-lavender-500 text-white shadow-lg shadow-lavender-500/30 ' +
    'hover:shadow-xl hover:shadow-lavender-500/40 hover:-translate-y-0.5 hover:from-lavender-700 hover:to-lavender-600',
  outline:
    'border-2 border-lavender-300 text-lavender-700 bg-white/70 hover:bg-lavender-50 ' +
    'hover:border-lavender-400 hover:-translate-y-0.5',
  ghost:
    'text-lavender-700 hover:bg-lavender-100/70 hover:-translate-y-0.5',
  contact:
    'bg-white text-lavender-700 border border-lavender-200 shadow-sm shadow-lavender-200/60 ' +
    'hover:bg-lavender-50 hover:border-lavender-300 hover:-translate-y-0.5 hover:shadow-md',
}

/** Shared CTA button used across the site — anchor-based so links, mailto, and tel all work. */
export function Button({
  variant = 'primary',
  icon: Icon,
  iconPosition = 'left',
  children,
  className = '',
  ...anchorProps
}: ButtonProps) {
  return (
    <a className={`${baseClasses} ${variantClasses[variant]} ${className}`.trim()} {...anchorProps}>
      {Icon && iconPosition === 'left' && <Icon className="h-4 w-4" aria-hidden="true" />}
      <span>{children}</span>
      {Icon && iconPosition === 'right' && <Icon className="h-4 w-4" aria-hidden="true" />}
    </a>
  )
}
