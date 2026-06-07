import { Mail, Phone, MessageCircleMore, ExternalLink } from 'lucide-react'
import { contact } from '../data/content'

const links = [
  { Icon: Mail, label: 'Email', href: `mailto:${contact.email}` },
  { Icon: Phone, label: 'Call', href: contact.phoneTel },
  { Icon: MessageCircleMore, label: 'Messenger', href: contact.messenger },
  { Icon: ExternalLink, label: 'LinkedIn', href: contact.linkedin, external: true },
]

export function Footer() {
  return (
    <footer className="border-t border-lavender-100 bg-white/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-sm text-[#6b6375] sm:flex-row sm:justify-between">
        <p>© {new Date().getFullYear()} Airah Jade Grantus. All rights reserved.</p>

        <ul className="flex items-center gap-3">
          {links.map(({ Icon, label, href, external }) => (
            <li key={label}>
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                aria-label={label}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-lavender-50 text-lavender-700 transition-colors duration-200 hover:bg-lavender-100"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}
