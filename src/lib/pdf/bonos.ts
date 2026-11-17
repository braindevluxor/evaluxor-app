import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { nombreDeCargo, type BonoCargo } from '../data/bonos'
import { cedula } from '../data/colaboradores'
import { ESTILO_TABLA, MARGEN, pintarBanda, pintarTextoLinea, pintarTituloSeccion, type Geometria } from './composicion'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

/**
 * LOS PAPELES DE BONOS, EN PDF
 * -----------------------------
 * Dos documentos distintos con el mismo oficio: dejar rastro en papel de una
 * decisión que hoy vive sólo en la pantalla.
 *
 *  1. `relacionCargoMonto`: la lista Cargo · Sucursal · Monto que va firmada
 *     por PRESIDENCIA —lo que se paga y cuánto, en cada tienda—.
 *  2. `autorizacionExcepcion`: el soporte de la AUTORIZACIÓN de una persona
 *     que ocupa por excepción un cargo con bono (está apoyándose o
 *     preparándose para ocuparlo, y en la nómina figura con otro).
 *
 * Composición: la familia de `composicion.ts` (banda, títulos, tabla) y el pie
 * con la marca, igual que el resto de los PDF. Las dos firmas de cada papel
 * salen del mismo ayudante de este archivo: son el motivo de existir.
 */

/* --- Firma ----------------------------------------------------------------- */

/**
 * El paladar de firma: dos renglones con su etiqueta debajo. El bloque se
 * salta de hoja si no entra entero —una firma partida en dos páginas no la
 * firma nadie—.
 */
function pintarFirmas(pdf: jsPDF, geo: Geometria, izquierda: string, derecha: string): void {
  const yFinal = geo.y
  if (yFinal + 30 > geo.alto - MARGEN) {
    pdf.addPage()
    geo.y = MARGEN
  }
  const anchoCampo = (geo.anchoUtil - 14) / 2
  const segundaColumna = MARGEN + anchoCampo + 14
  const lineaY = geo.y + 18
  const firma = (etiqueta: string, x: number) => {
    pdf.setDrawColor(100, 116, 139)
    pdf.setLineWidth(0.25)
    pdf.line(x, lineaY, x + anchoCampo, lineaY)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor(45, 52, 64)
    pdf.text(etiqueta, x, lineaY + 5)
  }
  firma(izquierda, MARGEN)
  firma(derecha, segundaColumna)
}

/** El pie de todos los papeles de bonos, en todas sus hojas. */
function pintarPie(pdf: jsPDF, texto: string): void {
  const alto = pdf.internal.pageSize.getHeight()
  for (let hoja = 1; hoja <= pdf.getNumberOfPages(); hoja++) {
    pdf.setPage(hoja)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(130, 140, 150)
    ponerLogoAlPie(pdf, MARGEN, alto - 7)
    pdf.text(texto, xTextoDelPie(MARGEN), alto - 7)
  }
}

/** El `finalY` de la última tabla pintada, para seguir escribiendo debajo. */
function ultimaY(pdf: jsPDF, y: number): number {
  return (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
}

const hoy = (): string => new Date().toLocaleDateString('es')

const hoyISO = (): string => new Date().toISOString().slice(0, 10)

const montoTexto = (monto: number): string => monto.toLocaleString('es-VE', { maximumFractionDigits: 2 })

/* --- Relación cargo · sucursal · monto ------------------------------------- */

/** Una fila de la relación: qué cargo, en qué tienda y con cuánto. */
export interface RelacionFila {
  /** Cargo como se muestra (alias si tiene) y, entre paréntesis, su área. */
  cargo: string
  sucursal: string
  monto: number
}

/**
 * La relación aplanada para la tabla del PDF: UNA FILA POR (cargo, tienda).
 *
 * Sólo cargos ACTIVOS, porque lo que se firma por Presidencia es lo que se
 * paga. Un cargo SIN alcance es una sola fila con «Todas las sucursales» y el
 * monto base; CON alcance, una fila por tienda con el monto propio o, si esa
 * fila no trae uno, el base —la misma regla de `montoParaSucursal` que usa el
 * cálculo del gasto, así que el papel y la pantalla nunca discrepan.
 *
 * Las tiendas de cada cargo van ordenadas alfabéticamente: el documento se
 * firma una vez y tiene que leerse igual para todos.
 */
export function filasRelacionCargoMonto(
  cargos: readonly BonoCargo[],
  sucursales: readonly { id: string; nombre: string }[]
): RelacionFila[] {
  const nombrePorId = new Map(sucursales.map((s) => [s.id, s.nombre]))
  const filas: RelacionFila[] = []
  for (const c of cargos) {
    if (!c.activo) continue
    const rotulo = c.departamento ? `${nombreDeCargo(c)} (${c.departamento})` : nombreDeCargo(c)
    if (!c.sucursales.length) {
      filas.push({ cargo: rotulo, sucursal: 'Todas las sucursales', monto: c.monto })
      continue
    }
    const tiendas = c.sucursales
      .map((s) => ({
        sucursal: nombrePorId.get(s.sucursal_id) ?? s.sucursal_id,
        monto: s.monto ?? c.monto
      }))
      .sort((a, b) => a.sucursal.localeCompare(b.sucursal, 'es'))
    for (const t of tiendas) filas.push({ cargo: rotulo, sucursal: t.sucursal, monto: t.monto })
  }
  return filas
}

/**
 * La relación Cargo · Sucursal · Monto, lista para imprimir y firmar.
 *
 * Es el papel que pide Presidencia para autorizar la partida de bonos: tres
 * columnas y nada más —si la relación trajera huecos (excluidos, notas,
 * períodos) dejaría de ser lo que se firma y pasaría a ser un reporte.
 */
export function buildRelacionCargoMonto(filas: readonly RelacionFila[]): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN
  const geo: Geometria = { y, anchoUtil, ancho, alto }

  const cargos = new Set(filas.map((f) => f.cargo)).size
  y = pintarBanda(
    pdf,
    'Relación de cargos y montos',
    `Cargo, sucursal y monto · ${cargos} ${cargos === 1 ? 'cargo activo' : 'cargos activos'} · ${filas.length} ${
      filas.length === 1 ? 'fila' : 'filas'
    } · ${hoy()}`,
    geo
  )
  geo.y = y

  y = pintarTextoLinea(
    pdf,
    'Documento para firma de Presidencia. Cada fila indica el cargo que goza de bono, la sucursal donde se paga y el monto que le corresponde en esa tienda. Los cargos sin sucursales marcadas figuran una sola vez como «Todas las sucursales», con el monto base.',
    geo,
    { size: 9, gap: 8, color: [100, 116, 139] }
  )
  geo.y = y

  if (!filas.length) {
    y = pintarTextoLinea(pdf, 'No hay cargos activos configurados: no hay nada que relacionar.', geo, { gap: 6 })
    geo.y = y
  } else {
    y = pintarTituloSeccion(pdf, 'Detalle', geo)
    geo.y = y
    autoTable(pdf, {
      ...ESTILO_TABLA,
      head: [['Cargo', 'Sucursal', 'Monto']],
      body: filas.map((f) => [
        f.cargo,
        f.sucursal,
        { content: montoTexto(f.monto), styles: { halign: 'right' as const } }
      ]),
      startY: geo.y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
      columnStyles: { 0: { cellWidth: 76 }, 1: { cellWidth: 66 }, 2: { cellWidth: 40, halign: 'right' } }
    })
    y = ultimaY(pdf, geo.y)
    geo.y = y + 4
  }

  y = pintarTituloSeccion(pdf, 'Firmas', geo)
  geo.y = y
  pintarFirmas(pdf, geo, 'Presidencia', 'Fecha')
  geo.y += 30
  y = pintarTextoLinea(pdf, 'Con la firma de Presidencia queda autorizada la relación anterior.', geo, {
    size: 9,
    color: [100, 116, 139]
  })
  geo.y = y

  pintarPie(pdf, `Relación de cargos y montos | ${hoy()}`)
  return pdf
}

/** Genera y descarga la relación Cargo · Sucursal · Monto. */
export function descargarRelacionCargoMonto(filas: readonly RelacionFila[]): void {
  buildRelacionCargoMonto(filas).save(`relacion-cargos-montos-${hoyISO()}.pdf`)
}

/* --- Autorización de ocupante por excepción -------------------------------- */

/** Todo lo que dice el papel de autorización de UNA excepción. */
export interface AutorizacionExcepcionDatos {
  /** El cargo con bono que la persona ocupa por excepción (nombre a mostrar). */
  cargo: string
  /** Área a la que acota ese cargo, si lo está. */
  departamento: string | null
  /** El cargo con el que la persona figura HOY en la nómina: la razón. */
  cargoNomina: string
  trabajador: { nombre: string; nacionalidad: string; dni: number }
  /** La tienda donde cobra ESTE bono (dentro del alcance del cargo). */
  sucursal: string
  /** El monto del bono en esa sucursal. */
  monto: number
}

/**
 * El soporte de la AUTORIZACIÓN de una excepción, en PDF.
 *
 * La excepción es la puerta para quien está apoyándose o preparándose para
 * ocupar un cargo con bono: en la nómina figura con OTRO cargo, así que el
 * cruce exacto no lo contaría. En pantalla es un clic; en papel necesita un
 * documento que nombre a la persona, al cargo, a la tienda y al monto, y que
 * alguien firme que lo autoriza.
 *
 * La constancia dice dos cosas que el papel no puede dejar implícitas: POR QUÉ
 * es excepción (su cargo real en la nómina) y QUÉ significa (cuenta, genera
 * fila de pago y cobra el monto de esa tienda, con la misma nota mínima que
 * el resto del cargo).
 */
export function buildAutorizacionExcepcion(datos: AutorizacionExcepcionDatos): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN
  const geo: Geometria = { y, anchoUtil, ancho, alto }

  y = pintarBanda(
    pdf,
    'Autorización de ocupante por excepción',
    `${datos.trabajador.nombre} · C.I. ${cedula(datos.trabajador)}`,
    geo
  )
  geo.y = y

  const area = datos.departamento ? datos.departamento : 'Sin área acotada'
  autoTable(pdf, {
    ...ESTILO_TABLA,
    head: [['Dato', 'Detalle']],
    body: [
      ['Cargo con bono', datos.cargo],
      ['Área del cargo', area],
      ['Cargo en la nómina', datos.cargoNomina || 'Sin cargo registrado en la nómina'],
      ['Trabajador', datos.trabajador.nombre],
      ['Cédula', cedula(datos.trabajador)],
      ['Sucursal donde cobra', datos.sucursal],
      ['Monto del bono', montoTexto(datos.monto)],
      ['Emitido el', hoy()]
    ],
    startY: y,
    margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
    columnStyles: { 0: { cellWidth: 58 } }
  })
  y = ultimaY(pdf, y)
  geo.y = y + 4

  y = pintarTituloSeccion(pdf, 'Autorización', geo)
  geo.y = y
  y = pintarTextoLinea(
    pdf,
    `Se autoriza a ${datos.trabajador.nombre}, ${cedula(datos.trabajador)}, a ocupar por excepción el cargo «${datos.cargo}»${
      datos.departamento ? `, del área de ${datos.departamento}` : ''
    }, en ${datos.sucursal}, por estar apoyándose o preparándose para ocuparlo. En la nómina la persona figura hoy como ${
      datos.cargoNomina ? `«${datos.cargoNomina}»` : 'sin cargo registrado'
    }, de modo que el cruce exacto con la nómina no la contaría como ocupante de este cargo.`,
    geo,
    { gap: 6 }
  )
  geo.y = y
  y = pintarTextoLinea(
    pdf,
    `Mientras dure esta excepción, la persona cuenta como ocupante del cargo —en el conteo y en el gasto proyectado— y genera su fila de pago en cada período con el monto de ${datos.sucursal} (${montoTexto(
      datos.monto
    )}), sujeta a la misma nota mínima y periodicidad que el resto del cargo.`,
    geo,
    { gap: 6 }
  )
  geo.y = y
  y = pintarTextoLinea(
    pdf,
    'Si la persona deja de cumplir el rol, la excepción se retira desde la pantalla de ocupantes del cargo y sus pagos pendientes se limpian.',
    geo,
    { size: 9, gap: 10, color: [100, 116, 139] }
  )
  geo.y = y

  y = pintarTituloSeccion(pdf, 'Firmas', geo)
  geo.y = y
  pintarFirmas(pdf, geo, 'Presidencia', 'Ocupante(a)')
  geo.y += 30
  y = pintarTextoLinea(pdf, 'Con la firma de Presidencia queda autorizada esta excepción.', geo, {
    size: 9,
    color: [100, 116, 139]
  })
  geo.y = y

  pintarPie(pdf, `${datos.sucursal} | Excepción de ocupante | ${datos.trabajador.nombre}`)
  return pdf
}

/** Genera y descarga la autorización de UNA excepción, con la cédula en el nombre. */
export function descargarAutorizacionExcepcion(datos: AutorizacionExcepcionDatos): void {
  const dni = `${datos.trabajador.nacionalidad || 'V'}${datos.trabajador.dni}`
  buildAutorizacionExcepcion(datos).save(`excepcion-${dni}-${hoyISO()}.pdf`)
}
