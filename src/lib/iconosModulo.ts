import {
  ClipboardCheck,
  ClipboardList,
  MonitorCog,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Users,
  Utensils,
  Wrench,
  type LucideIcon
} from 'lucide-react'

export const ICONOS_MODULO: { id: string; etiqueta: string; Icono: LucideIcon }[] = [
  { id: 'clipboard-list', etiqueta: 'Lista', Icono: ClipboardList },
  { id: 'clipboard-check', etiqueta: 'Verificación', Icono: ClipboardCheck },
  { id: 'store', etiqueta: 'Sucursal', Icono: Store },
  { id: 'package-check', etiqueta: 'Inventario', Icono: PackageCheck },
  { id: 'shield-check', etiqueta: 'Seguridad', Icono: ShieldCheck },
  { id: 'sistemas', etiqueta: 'Sistemas', Icono: MonitorCog },
  { id: 'truck', etiqueta: 'Transporte', Icono: Truck },
  { id: 'users', etiqueta: 'Personal', Icono: Users },
  { id: 'utensils', etiqueta: 'Alimentos', Icono: Utensils },
  { id: 'wrench', etiqueta: 'Mantenimiento', Icono: Wrench }
]

export const iconosPorId = new Map([
  ...ICONOS_MODULO.map((opcion) => [opcion.id, opcion.Icono] as const),
  ['sparkles', Sparkles]
])
