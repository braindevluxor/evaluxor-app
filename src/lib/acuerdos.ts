/**
 * ACUERDOS COMERCIALES: LAS REGLAS PURAS
 * ---------------------------------------
 * Todo lo que se puede calcular sin tocar la base: de qué fechas se cobra
 * un acuerdo, cuándo una fecha está en mora, si dos acuerdos se cruzan en
 * el tiempo y qué porcentaje de espacios está rentado.
 *
 * La pantalla sólo pinta esto; la base guarda lo ya cobrado
 * (`acuerdo_cobro`) y nada más.
 */

/** El paso de cada FRECUENCIA, en días o en meses. */
type Paso = { dias?: number; meses?: number }

/**
 * El paso de una frecuencia, buscando por PALABRA: el catálogo se puede
 * ampliar desde la pantalla («Quincenal quincenal», «Semestral»…), así que
 * no se amarra a los valores exactos de la semilla. Lo que no se conoce
 * cae en mensual —el paso por defecto— y la pantalla muestra el valor tal
 * cual venga.
 */
function pasoDe(frecuencia: string): Paso {
  const f = frecuencia.trim().toLowerCase()
  if (f.includes('quincenal')) return { dias: 15 }
  if (f.includes('trimestral')) return { meses: 3 }
  if (f.includes('semestr')) return { meses: 6 }
  if (f.includes('mensual')) return { meses: 1 }
  if (f.includes('semanal')) return { dias: 7 }
  if (f.includes('anual')) return { meses: 12 }
  return { meses: 1 }
}

/** Hoy en la zona del navegador, como `YYYY-MM-DD`. */
export function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Suma días (o meses) a una fecha ISO, en horario local. */
function sumar(fechaISO: string, paso: Paso): string {
  const [a, m, d] = fechaISO.split('-').map(Number)
  const fecha = new Date(a, (m ?? 1) - 1, d ?? 1)
  if (paso.dias) fecha.setDate(fecha.getDate() + paso.dias)
  else fecha.setMonth(fecha.getMonth() + (paso.meses ?? 1))
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

/**
 * TODAS las fechas de cobro de un acuerdo: desde `inicio` cada paso hasta
 * `fin` inclusive. Con un tope de 200 para no colgar la pantalla si alguien
 * pega un fin de fecha absurdo.
 */
export function fechasDeCobro(inicio: string, fin: string, frecuencia: string): string[] {
  if (!inicio || !fin || fin < inicio) return []
  const paso = pasoDe(frecuencia)
  const fechas: string[] = []
  let actual = inicio
  while (actual <= fin && fechas.length < 200) {
    fechas.push(actual)
    actual = sumar(actual, paso)
  }
  return fechas
}

/**
 * MORA: la fecha pasó y NO se cobró. Es el color rojo del calendario —
 * no se guarda en ningún lado, se calcula contra el día de hoy.
 */
export function enMora(fecha: string, cobrado: boolean, hoy = hoyISO()): boolean {
  return !cobrado && fecha < hoy
}

/** ¿La fecha de cobro ya pasó? (para separar «vencido» del «próximo»). */
export function vencido(fecha: string, hoy = hoyISO()): boolean {
  return fecha < hoy
}

/**
 * ¿Se cruza un acuerdo nuevo con uno YA EXISTENTE del mismo espacio?
 * Dos contratos del mismo metro cuadrado no pueden pisarse: se solapan si
 * los intervalos [inicio, fin] se tocan.
 */
export function haySolape(
  existentes: { id: string; espacio_id: string; fecha_inicio: string; fecha_fin: string }[],
  espacioId: string,
  inicio: string,
  fin: string,
  excluirId?: string
): boolean {
  return existentes.some(
    (a) =>
      a.espacio_id === espacioId &&
      a.id !== excluirId &&
      a.fecha_inicio <= fin &&
      inicio <= a.fecha_fin
  )
}

/** Un acuerdo vigente HOY: es el que colorea al espacio en el plano. */
export function vigente(acuerdo: { fecha_inicio: string; fecha_fin: string; activo?: boolean }, hoy = hoyISO()): boolean {
  return acuerdo.activo !== false && acuerdo.fecha_inicio <= hoy && hoy <= acuerdo.fecha_fin
}

/** Los tres estados de un espacio sobre el plano (el semáforo). */
export type EstadoEspacio = 'disponible' | 'ocupado' | 'pendiente'

/**
 * Los COLORES del semáforo del plano:
 *  - `disponible` → ROJO: nadie lo tiene.
 *  - `ocupado`    → VERDE: alquilado y con todos los cobros vencidos pagados.
 *  - `pendiente`  → AMARILLO: alquilado pero con cobros vencidos SIN pagar.
 */
export const COLORES_ESTADO: Record<EstadoEspacio, string> = {
  disponible: '#dc2626',
  ocupado: '#16a34a',
  pendiente: '#eab308'
}

/**
 * EL ESTADO DE UN ESPACIO: rojo si está libre, amarillo si está ocupado con
 * cobros pendientes, verde si está ocupado y al día.
 *
 * «Pendiente» es una fecha de cobro que YA PASÓ y no tiene cobro registrado
 * —el día del cobro todavía no es deuda, igual que en `enMora()`, y los
 * futuros no cuentan, o todo estaría amarillo hasta cerrar el contrato—.
 * Todo se deriva de `fechasDeCobro` + lo cobrado, así que no hay nada que
 * sincronizar: cambia solo cuando se registra un cobro o pasa el tiempo.
 */
export function estadoEspacio(
  acuerdo: { fecha_inicio: string; fecha_fin: string; frecuencia: string; activo?: boolean } | null,
  cobradas: Set<string> | string[],
  hoy = hoyISO()
): EstadoEspacio {
  if (!acuerdo || !vigente(acuerdo, hoy)) return 'disponible'
  const cobros = cobradas instanceof Set ? cobradas : new Set(cobradas)
  const hayPendiente = fechasDeCobro(acuerdo.fecha_inicio, acuerdo.fecha_fin, acuerdo.frecuencia).some(
    (fecha) => fecha < hoy && !cobros.has(fecha)
  )
  return hayPendiente ? 'pendiente' : 'ocupado'
}

/** Porcentaje redondeado, con el caso de «sin nada» en 0 (nunca NaN). */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 100)
}

/**
 * La PALETA de los proveedores: se asigna la primera libre al crear. Los
 * tonos están elegidos para verse sobre el plano (fondo blanco o de foto)
 * y para no confundirse con el rojo de mora ni con el verde de cobrado.
 */
export const COLORES_PROVEEDOR = [
  '#0b2545',
  '#2e6ab0',
  '#7c3aed',
  '#0f766e',
  '#b45309',
  '#be123c',
  '#0369a1',
  '#4d7c0f'
] as const

/** El color del proveedor: el suyo, o el primero de la paleta si no trae. */
export function colorDe(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : COLORES_PROVEEDOR[0]
}

/** El primer color de la paleta que no esté en uso. */
export function colorLibre(enUso: (string | null | undefined)[]): string {
  const usados = new Set(enUso.filter(Boolean).map((c) => String(c).toLowerCase()))
  return COLORES_PROVEEDOR.find((c) => !usados.has(c)) ?? COLORES_PROVEEDOR[0]
}

/**
 * El NEÓN del contorno de un espacio: tres capas de `box-shadow` con el
 * MISMO color del estado, de la más corta a la más difusa, más un halo
 * blanco por afuera del borde.
 *
 * Se aplica SÓLO cuando el espacio está resaltado (mouseover en la leyenda
 * o en el plano): en reposo las formas van sin borde ni brillo, sólo el
 * color plano del estado. El blanco de afuera es lo que hace que el halo
 * se lea sobre cualquier fondo de la foto del piso.
 */
export function neon(color: string): string {
  return `#ffffff 0 0 0 2px, ${color} 0 0 3px, ${color} 0 0 14px, ${color} 0 0 34px`
}

/** El % de un anillo del medidor: el valor sobre SU base. */
export function porcentajeAnillo(valor: number, base: number): number | null {
  if (!(base > 0)) return null
  return Math.max(0, valor / base)
}

/** Formato de dinero en USD: `1.234,50` (sin símbolo, la etiqueta lo trae). */export function usd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n)
}

/** Los días de un mes, como `YYYY-MM-DD`, empezando el lunes. */
export function diasDelMes(anio: number, mes: number): string[] {
  const primero = new Date(anio, mes, 1)
  const desdeLunes = (primero.getDay() + 6) % 7
  const ultimo = new Date(anio, mes + 1, 0).getDate()
  const salida: string[] = []
  for (let i = 0; i < desdeLunes; i++) salida.push('')
  for (let d = 1; d <= ultimo; d++) {
    salida.push(`${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return salida
}

const MESES_CORTOS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic'
]

/**
 * El nombre de un mes en formato `YYYY-MM`, para el filtro de fechas:
 * `2026-11` → `Nov 2026`. Si el valor viene raro, se devuelve tal cual en
 * vez de romper el selector.
 */
export function nombreMes(yyyyMM: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMM.trim())
  if (!m) return yyyyMM
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return yyyyMM
  return `${MESES_CORTOS[mes - 1]} ${m[1]}`
}
