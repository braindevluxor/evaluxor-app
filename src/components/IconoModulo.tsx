import { createElement } from 'react'
import { ClipboardList } from 'lucide-react'
import { iconosPorId } from '../lib/iconosModulo'

export function IconoModulo({
  nombre,
  className
}: {
  nombre?: string | null
  className?: string
}) {
  return createElement(iconosPorId.get(nombre ?? '') ?? ClipboardList, {
    'aria-hidden': true,
    className
  })
}
