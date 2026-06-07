import { useEffect, useRef } from 'react'

/**
 * Tracks pointer position within an element and exposes it as CSS custom
 * properties (--px, --py, range -1..1) so children can transform via CSS.
 */
export function usePointerParallax<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const handleMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect()
      const px = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const py = ((event.clientY - rect.top) / rect.height) * 2 - 1
      node.style.setProperty('--px', px.toFixed(3))
      node.style.setProperty('--py', py.toFixed(3))
    }

    const handleLeave = () => {
      node.style.setProperty('--px', '0')
      node.style.setProperty('--py', '0')
    }

    node.addEventListener('pointermove', handleMove)
    node.addEventListener('pointerleave', handleLeave)
    return () => {
      node.removeEventListener('pointermove', handleMove)
      node.removeEventListener('pointerleave', handleLeave)
    }
  }, [])

  return ref
}
