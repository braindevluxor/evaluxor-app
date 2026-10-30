/**
 * Reporte POR CARGOS de una evaluación, en PDF.
 *
 * Responde a «quiero ver, para los cargos que yo elija, todos sus pendientes»:
 * un bloque por cargo seleccionado con los ítems en los que quedó mal, los
 * checks concretos que fallaron y cuántos puntos le costaron. Es el mismo
 * detalle que abre el modal «Fallas de…» del detalle de la evaluación, pero
 * impreso y con varios cargos juntos, para llevarlo a una reunión o dejarlo
 * como constancia.
 *
 * El dato NO se recalcula acá: el detalle pasa las fallas ya resueltas con
 * `fallasDeResponsable` (el mismo cálculo que pinta el modal y que reparte los
 * puntos igual que la tarjeta de porcentaje). Este archivo sólo compone el
 * documento.
 *
 * Composición: la familia visual de `composicion.ts` — banda de marca arriba,
 * títulos en marino con regla suave y tablas con cabecera coloreada y filas
 * alternadas, no negro sobre blanco con rejilla. Sin `·` ni otros caracteres
 * que jsPDF no escribe bien con las fuentes WinAnsi.
 * Las fotos de evidencia van debajo del ítem al que pertenecen
 * (ver `cargarImagenesReporte`).
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { etiquetaTipo, type FallaResponsable } from '../scoring'
import { supabase } from '../supabase'
import {
  ESTILO_TABLA,
  MARGEN,
  pintarBanda,
  pintarTextoLinea,
  pintarTituloSeccion,
  type Geometria
} from './composicion'
import { barra, FONDO, formatoFecha, GRIS, GRIS_CLARO, MARINO, MARINO_CLARO } from './graficos'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

/** Un ítem que le salió mal a un cargo, tal como lo muestra el modal del detalle. */
export interface PendienteCargo {
  /** Ítem del que se descontó. */
  item: string
  /** Módulo al que pertenece el ítem; null si no se pudo resolver. */
  modulo: string | null
  /** Tipo de ítem (`CHECKLIST`, `CUMPLE_NO_CUMPLE`, …) para ubicar el origen. */
  tipo: string
  /** Puntos que este cargo tenía en el ítem y no logró. */
  perdidos: number
  /** Checks concretos que fallaron y se le atribuyen. Vacío si el ítem no es de checks. */
  checks: string[]
  /**
   * Rutas de las fotos en Storage, en el mismo orden en que las pinta la
   * pantalla: en ítems de lista, sólo las de los puntos que le fallaron a ESTE
   * cargo. Vacío cuando no hay: el documento sale igual, sin fotos.
   */
  fotos: string[]
}

/** Un cargo del reporte, con lo que se le descontó. */
export interface CargoReporte {
  /** Nombre del cargo tal como aparece en la evaluación. */
  cargo: string
  /** Porcentaje logrado del cargo (0..100), o null si nunca se le midió nada. */
  porciento: number | null
  /** Suma de `perdidos` de sus pendientes. */
  perdidos: number
  /** Los ítems en los que quedó mal, del que más puntos costó al que menos. */
  pendientes: PendienteCargo[]
}

export interface ReporteCargosDatos {
  /** Nombre de la sucursal o departamento evaluado. */
  unidad: string
  /** Código o número de tienda, si lo hay. */
  referencia?: string | null
  /** Fecha de la evaluación (YYYY-MM-DD). */
  fecha: string
  /** Puntaje general de la evaluación (0..100), si ya está cerrada. */
  puntajeGeneral: number | null
  /** Los cargos elegidos para el reporte, en el orden en que se van a imprimir. */
  cargos: CargoReporte[]
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100

const fmt = (n: number): string => (Number.isInteger(n) ? `${n}` : `${redondear2(n)}`)

const pct = (valor: number | null): string => (valor == null ? '-' : `${valor}%`)

export function buildReporteCargos(
  datos: ReporteCargosDatos,
  /** Fotos ya bajadas de Storage, por path. Sin ellas el documento sale igual, sin fotos. */
  imagenes: Record<string, string> = {}
): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false })
  const ancho = pdf.internal.pageSize.getWidth()
  const alto = pdf.internal.pageSize.getHeight()
  const anchoUtil = ancho - MARGEN * 2
  let y = MARGEN

  /** La posición actual del cursor y las medidas de la hoja, para `composicion.ts`. */
  const geo = (): Geometria => ({ y, anchoUtil, ancho, alto })

  const textoLinea = (
    value: string,
    options: { bold?: boolean; size?: number; gap?: number; color?: [number, number, number] } = {}
  ) => {
    y = pintarTextoLinea(pdf, value, geo(), options)
  }

  /**
   * Renglón de cifras sobre fondo suave: lo que se quiere que salte a la vista
   * (la nota del cargo, sus puntos) en pastilla en vez de texto flotando.
   *
   * Va en UNA sola llamada de texto: el PDF se lee con búsquedas y con tests
   * que esperan la frase entera, y partirla en varias llamadas la rompería.
   */
  const dato = (texto: string, size = 9) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(size)
    const lineas = pdf.splitTextToSize(texto, anchoUtil - 8) as string[]
    const altoLinea = size * 0.5
    const altoPastilla = lineas.length * altoLinea + 5.5
    if (y + altoPastilla - 4 > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    pdf.setFillColor(...MARINO_CLARO)
    pdf.roundedRect(MARGEN, y - 4, anchoUtil, altoPastilla, 2.2, 2.2, 'F')
    pdf.setTextColor(...MARINO)
    lineas.forEach((linea, i) => pdf.text(linea, MARGEN + 4, y + i * altoLinea))
    y += altoPastilla - 4
  }

  /** Título de sección: el de `composicion.ts`, en marino con regla suave. */
  const tituloSeccion = (value: string) => {
    y = pintarTituloSeccion(pdf, value, geo())
  }

  /**
   * Rótulo de un ítem dentro del bloque de un cargo: el módulo y el tipo
   * quedan como bajada gris, que es lo único que aportan —lo que importa es el
   * nombre del ítem.
   */
  const subtitulo = (value: string, detalle: string) => {
    const espacioAnterior = y > MARGEN + 1 ? 3 : 0
    if (y + espacioAnterior + 16 > alto - MARGEN) {
      pdf.addPage()
      y = MARGEN
    }
    y += espacioAnterior
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10.5)
    pdf.setTextColor(...MARINO)
    const lineas = pdf.splitTextToSize(value, anchoUtil) as string[]
    pdf.text(lineas, MARGEN, y)
    y += lineas.length * 4.8
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(...GRIS)
    const resumen = pdf.splitTextToSize(detalle, anchoUtil) as string[]
    pdf.text(resumen, MARGEN, y)
    y += resumen.length * 3.8 + 2
  }

  type Celda = string | { content: string; colSpan?: number; styles?: Record<string, unknown> }

  /**
   * Tabla del reporte: el estilo de `composicion.ts` (cabecera marino, filas
   * alternadas, separadores de 0,1 mm). La rejilla negra de antes era lo que
   * hacía que cada bloque pareciera una planilla de contabilidad.
   */
  const tabla = (
    headers: string[],
    rows: Celda[][],
    opciones?: { columnStyles?: Record<number, { cellWidth?: number; halign?: 'left' | 'center' | 'right' }> }
  ) => {
    if (!rows.length) return
    autoTable(pdf, {
      ...ESTILO_TABLA,
      head: [headers],
      body: rows,
      startY: y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN },
      columnStyles: opciones?.columnStyles ?? {}
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 3
  }

  /**
   * Las fotos de un pendiente, en grilla debajo de su tabla: tres por fila y
   * con la proporción original, para que una foto de celular no salga estirada.
   *
   * Sólo se pegan las que ya se bajaron (`imagenes`): una foto que no se pudo
   * leer —sin conexión, borrada, sin permiso— no tumba el reporte, simplemente
   * no sale impresa. Y si una fila no cabe, se corta la hoja: nunca se pega una
   * foto a medias en el margen.
   */
  const pintarFotos = (paths: string[]) => {
    const conImagen = paths.filter((path) => imagenes[path])
    if (!conImagen.length) return

    const anchoFoto = 56
    const hueco = 6
    const porFila = Math.max(1, Math.floor((anchoUtil + hueco) / (anchoFoto + hueco)))

    let x = MARGEN
    let yFila = y
    let altoFila = 0
    let pintadas = 0

    for (const path of conImagen) {
      const dataUrl = imagenes[path]
      try {
        const props = pdf.getImageProperties(dataUrl)
        if (!props.width || !props.height) continue
        const altoFoto = (anchoFoto * props.height) / props.width
        if (pintadas % porFila === 0 && pintadas > 0) {
          x = MARGEN
          yFila += altoFila + hueco
          altoFila = 0
        }
        if (yFila + altoFoto > alto - MARGEN) {
          pdf.addPage()
          x = MARGEN
          yFila = MARGEN
          altoFila = 0
        }
        pdf.addImage(dataUrl, dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, yFila, anchoFoto, altoFoto)
        // Marco suave: la foto se desprende del fondo sin el recuadro negro.
        pdf.setDrawColor(...GRIS_CLARO)
        pdf.setLineWidth(0.3)
        pdf.rect(x, yFila, anchoFoto, altoFoto)
        x += anchoFoto + hueco
        altoFila = Math.max(altoFila, altoFoto)
        pintadas++
      } catch {
        // Imagen ilegible o que jsPDF no puede decodificar: se salta, no rompe
        // el documento.
      }
    }

    if (pintadas) y = yFila + altoFila + 4
  }

  // --- Encabezado -----------------------------------------------------------
  // Banda de marca: el documento arranca con el color de la casa y no con una
  // línea negra sobre fondo blanco. Baja la unidad y la fecha, que es lo que
  // hace falta para saber qué evaluación se está mirando.
  y = pintarBanda(pdf, 'Reporte por cargos: pendientes', `${datos.unidad} | ${formatoFecha(datos.fecha)}`, geo())

  const referencia = datos.referencia?.trim()
  tabla(
    ['Dato', 'Detalle'],
    [
      ...(referencia ? [['Referencia', referencia]] : []),
      [
        'Puntaje general',
        datos.puntajeGeneral == null ? 'Sin puntaje (evaluación abierta)' : `${fmt(datos.puntajeGeneral)}%`
      ],
      ['Cargos en el reporte', `${datos.cargos.length}`],
      ['Generado', new Date().toLocaleDateString('es')]
    ],
    { columnStyles: { 0: { cellWidth: 52 } } }
  )

  if (!datos.cargos.length) {
    textoLinea('No se seleccionó ningún cargo.')
    return conPie(pdf, alto)
  }

  // --- Resumen por cargo ----------------------------------------------------
  tituloSeccion('Resumen por cargo')
  tabla(
    ['Cargo', 'Nota', 'Ítems con pendientes', 'Puntos no cumplidos'],
    datos.cargos.map((cargo) => [
      cargo.cargo,
      { content: pct(cargo.porciento), styles: { halign: 'right' } },
      { content: `${cargo.pendientes.length}`, styles: { halign: 'right' } },
      { content: fmt(cargo.perdidos), styles: { halign: 'right' } }
    ]),
    {
      columnStyles: {
        1: { cellWidth: 20, halign: 'right' },
        2: { cellWidth: 36, halign: 'right' },
        3: { cellWidth: 34, halign: 'right' }
      }
    }
  )
  textoLinea(
    'La nota del cargo es logrado sobre lo posible, con los mismos pesos que el resto de la app. ' +
      'Los puntos no cumplidos son los que se le descontaron por los ítems de cada bloque.',
    { size: 8, gap: 7, color: GRIS }
  )

  // --- Un bloque por cargo --------------------------------------------------
  for (const cargo of datos.cargos) {
    tituloSeccion(`Cargo: ${cargo.cargo}`)
    // Las tres cifras del cargo juntas en una pastilla: es lo primero que se
    // mira de cada bloque, y suelto en texto se perdían entre los títulos.
    dato(
      `Nota del cargo: ${pct(cargo.porciento)}  |  Puntos no cumplidos: ${fmt(
        cargo.perdidos
      )}  |  Ítems con pendientes: ${cargo.pendientes.length}`
    )
    if (cargo.porciento != null) {
      // Misma barra y mismos colores que la app para el puntaje: verde arriba,
      // ámbar en riesgo, rojo abajo.
      barra(pdf, MARGEN, y + 3, anchoUtil, 2.6, cargo.porciento)
      y += 9
    }

    if (!cargo.pendientes.length) {
      textoLinea('Este cargo no tiene ítems con pendientes en esta evaluación.', { color: GRIS })
      continue
    }

    for (const pendiente of cargo.pendientes) {
      // El ítem va como subtítulo y los checks (o el tipo, si no es de checks)
      // en la tabla: decir sólo «Checklist de higiene» no explica nada, los
      // checks concretos sí, y son la razón de ser de este reporte.
      subtitulo(pendiente.item, `${pendiente.modulo ?? 'Sin módulo'} | ${etiquetaTipo(pendiente.tipo)}`)

      if (pendiente.checks.length) {
        tabla(
          ['Punto sin cumplir', 'Puntos'],
          [
            ...pendiente.checks.map((check) => [check, '']),
            [
              // La fila de cierre destaca por su fondo, no por una línea negra
              // más gruesa: mismo criterio que el resto del documento.
              { content: 'TOTAL del ítem', styles: { fontStyle: 'bold', fillColor: MARINO_CLARO, textColor: MARINO } },
              {
                content: fmt(pendiente.perdidos),
                styles: { fontStyle: 'bold', halign: 'right', fillColor: MARINO_CLARO, textColor: MARINO }
              }
            ]
          ],
          { columnStyles: { 1: { cellWidth: 22, halign: 'right' } } }
        )
      } else {
        // Ítems binarios y de plano: el ítem entero es la falla. Se imprime una
        // sola fila con los puntos, sin repetir «el ítem falló», que sería
        // tautológico.
        tabla(
          ['Falla', 'Puntos'],
          [
            [
              {
                content: `Ítem completo (${etiquetaTipo(pendiente.tipo)})`,
                styles: { fontStyle: 'bold', fillColor: FONDO }
              },
              {
                content: fmt(pendiente.perdidos),
                styles: { fontStyle: 'bold', halign: 'right', fillColor: FONDO, textColor: MARINO }
              }
            ]
          ],
          { columnStyles: { 1: { cellWidth: 22, halign: 'right' } } }
        )
      }
      // Las fotos del ítem, después de lo que falló: es la evidencia de esa
      // misma tabla, así que van pegadas a ella y no en un anexo aparte.
      pintarFotos(pendiente.fotos)
    }
  }

  return conPie(pdf, alto)

  /**
   * Marca y texto al pie de todas las hojas. Se hace al final porque recién
   * entonces se sabe cuántas páginas tiene el documento.
   */
  function conPie(documento: jsPDF, altoHoja: number): jsPDF {
    const etiquetaCargos = datos.cargos.length === 1 ? '1 cargo' : `${datos.cargos.length} cargos`
    const pie = `${datos.unidad} | ${formatoFecha(datos.fecha)} | Reporte por cargos | ${etiquetaCargos}`
    for (let hoja = 1; hoja <= documento.getNumberOfPages(); hoja++) {
      documento.setPage(hoja)
      documento.setFont('helvetica', 'normal')
      documento.setFontSize(7)
      documento.setTextColor(130, 140, 150)
      ponerLogoAlPie(documento, MARGEN, altoHoja - 7)
      documento.text(pie, xTextoDelPie(MARGEN), altoHoja - 7)
    }
    return documento
  }
}

/**
 * Arma los datos del reporte a partir de las fallas YA resueltas por el
 * detalle: acá no se recalcula nada (ni puntos ni checks), sólo se convierte la
 * salida de `fallasDeResponsable` en la forma que imprimen el PDF y el Excel.
 *
 * Está afuera de la pantalla a propósito: es la frontera entre «lo que la
 * pantalla calcula» y «lo que el documento imprime», y con ella se prueba que
 * los dos formatos reciben exactamente los mismos pendientes que el modal de
 * fallas, sin tener que montar la página entera.
 *
 * Los pendientes quedan ordenados del más costoso al más barato, que es el
 * orden en que conviene leerlos en una reunión.
 */
export function armarReporteCargos(
  encabezado: Omit<ReporteCargosDatos, 'cargos'>,
  elegidos: { cargo: string; porciento: number | null; fallas: FallaResponsable[] }[],
  modulos: { id: string; nombre: string }[],
  /**
   * Qué fotos entran en cada pendiente, resueltas por la pantalla con
   * `pathsDeFotosFalla`: las del punto que le falló A ESE CARGO. Sin función,
   * los pendientes salen sin fotos.
   */
  fotosDeFalla: (falla: FallaResponsable) => string[] = () => []
): ReporteCargosDatos {
  const nombreModulo = new Map(modulos.map((m) => [m.id, m.nombre]))
  return {
    ...encabezado,
    cargos: elegidos.map((e) => ({
      cargo: e.cargo,
      porciento: e.porciento,
      perdidos: e.fallas.reduce((suma, f) => suma + f.perdidos, 0),
      pendientes: [...e.fallas]
        .sort((a, b) => b.perdidos - a.perdidos)
        .map((f) => ({
          item: f.texto,
          modulo: f.modulo_id ? (nombreModulo.get(f.modulo_id) ?? null) : null,
          tipo: f.tipo,
          perdidos: f.perdidos,
          checks: f.checks,
          fotos: fotosDeFalla(f) ?? []
        }))
    }))
  }
}

function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function descargarReporteCargos(datos: ReporteCargosDatos, imagenes: Record<string, string> = {}): void {
  const pdf = buildReporteCargos(datos, imagenes)
  const unidad = slug(datos.unidad) || 'evaluacion'
  pdf.save(`pendientes-por-cargo-${unidad}-${datos.fecha}.pdf`)
}

/**
 * Baja las fotos del reporte desde Storage y las deja como data-URL, la forma
 * en que jsPDF las pega en el documento.
 *
 * Toma sólo los paths que el reporte va a imprimir (los de los cargos
 * elegidos): en una evaluación con cien fotos, pedir todas sería cien
 * descargas para las que el PDF no tiene lugar.
 *
 * UNA FOTO QUE NO BAJA NO TUMBA EL REPORTE: si el bucket no responde, la ruta
 * no existe o el archivo está corrupto, esa foto queda fuera y el documento se
 * genera igual con las que sí se pudieron leer. Un informe que falla entero
 * porque una imagen de hace seis meses ya no está sería peor que uno sin ella.
 */
export async function cargarImagenesReporte(datos: ReporteCargosDatos): Promise<Record<string, string>> {
  const paths = Array.from(new Set(datos.cargos.flatMap((c) => c.pendientes.flatMap((p) => p.fotos))))
  const imagenes: Record<string, string> = {}
  if (!paths.length) return imagenes

  await Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await supabase.storage.from('evidencias').download(path)
        if (error || !data) return
        imagenes[path] = await blobADataUrl(data)
      } catch {
        // Sin conexión o archivo ilegible: sigue sin esa foto.
      }
    })
  )
  return imagenes
}

function blobADataUrl(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader()
    lector.onload = () => resolver(String(lector.result))
    lector.onerror = () => rechazar(lector.error)
    lector.readAsDataURL(blob)
  })
}
