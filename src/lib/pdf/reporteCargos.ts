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
 *
 * Cada pendiente sale con SU observación y SU evidencia pegadas al punto que
 * le falló: la observación va en la tabla, en la columna «Comentario» (sólo
 * si hay alguna, la misma regla que el informe general), y las fotos van en
 * bloques debajo de la tabla, rotuladas con el nombre del punto cuando hay
 * más de un punto con fotos (ver `evidenciasDeFalla`).
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { etiquetaTipo, redondear3, type FallaResponsable } from '../scoring'
import { evidenciasDeFalla, type EvidenciaPunto } from '../evidencias'
import { esVideoPath } from '../fotos'
import { puntosFalladosDeCargo } from '../data/seguimientoEvaluaciones'
import type { ConjuntoDatos } from '../data/indicadores'
import { supabase } from '../supabase'
import {
  ESTILO_TABLA,
  MARGEN,
  pintarBanda,
  pintarTextoLinea,
  pintarTituloSeccion,
  type Geometria
} from './composicion'
import { barra, FONDO, formatoFecha, GRIS, GRIS_CLARO, MARINO, MARINO_CLARO, ROJO } from './graficos'
import { ESTADO_NO_APROBADO } from './estados'
import { ponerLogoAlPie, xTextoDelPie } from './marcaPie'

/**
 * Qué le pasó a UN punto en el histórico del cargo, en esa unidad.
 *
 * Van juntas la falta y la reincidencia porque el número sólo se entiende
 * acompañado: «reincidente» sin decir «5 faltas en el histórico» es un juicio
 * sin contexto, y «5 faltas» sin decir cuántas se repitieron esconde que tres
 * de ellas cayeron seguidas.
 */
export interface HistorialPunto {
  /** Cuántas veces le falló ese punto en el histórico del cargo en esa unidad. */
  faltas: number
  /** Cuántas de esas faltas se repitieron en la evaluación inmediata anterior. */
  reincidencias: number
  /** ¿Esta falla se repitió en la evaluación anterior? Es el chip de «reincidente». */
  esReincidente: boolean
}

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
   * Lo que LE COSTÓ a este cargo cada punto de `checks`, en el mismo orden.
   *
   * El reporte sólo sabía cuánto costaba el ÍTEM entero (`perdidos`); la
   * columna «Puntos» de cada fila salía vacía. Éste es ese número repartido:
   * si el ítem configura peso por punto se respeta, si no se reparte en partes
   * iguales, y en los dos casos la fila da exactamente `perdidos` — la columna
   * suma el TOTAL de abajo, que es lo que hace que el número se pueda leer en
   * una reunión.
   *
   * Vacío cuando no hay con qué repartir (reporte armado sin contexto, o las
   * listas de nombres e ids de puntos sin alinear): la fila imprime «—» y el
   * TOTAL sigue diciendo cuánto costó el ítem.
   */
  puntos: number[]
  /**
   * Cuántas veces le falló CADA punto en el histórico de esa unidad, y cuántas
   * de esas faltas se repitieron (la clave es el nombre del punto; `''` en los
   * ítems sin checks, donde la falla es del ítem entero).
   *
   * Es lo que hace que la pantalla pública pueda decir «reincidente»: sin el
   * histórico de la unidad no se puede decidir, así que viene vacío cuando el
   * reporte se arma sin él y el documento sale igual, sólo que sin ese chip.
   */
  historial: Record<string, HistorialPunto>
  /**
   * Lo de CADA punto del pendiente: su observación y sus fotos, en el mismo
   * orden en que se imprimen. Es lo que hace que una foto salga debajo del
   * punto al que pertenece y no en una grilla mezclada al final del ítem.
   *
   * Vacío cuando el reporte se arma sin respuestas (`armarReporteCargos`
   * sin contexto): el documento sale igual, sin observaciones ni fotos.
   */
  evidencias: EvidenciaPunto[]
  /**
   * Rutas de las fotos en Storage, la vista PLANA de `evidencias` (todas
   * juntas, sin repetir). Es la que usa `cargarImagenesReporte` para bajarlas
   * de una sola pasada; la que se imprime es la agrupada.
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
    opciones?: {
      columnStyles?: Record<
        number,
        {
          cellWidth?: number
          halign?: 'left' | 'center' | 'right'
          /** Color de texto: el mismo tipo de tupla que usa jsPDF (`RGB` de graficos). */
          textColor?: [number, number, number]
          fontStyle?: 'normal' | 'bold' | 'italic' | 'bolditalic'
        }
      >
    }
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

  /**
   * La evidencia de UN pendiente, punto por punto: el rótulo del punto, su
   * observación y SUS fotos, una debajo de la otra.
   *
   * Ése es el cambio respecto de la grilla mezclada de antes: una foto sale
   * debajo del nombre del punto al que pertenece, no en un bloque al final
   * del ítem donde no se sabe de qué punto es.
   *
   * El rótulo sólo aparece cuando hay MÁS de un punto con algo que imprimir:
   * con uno solo la tabla de arriba ya lo nombró, y en los ítems de falla
   * única (todas las evidencias son del mismo ítem) no hay con qué rotular —
   * ahí manda la observación, que es la que distingue una de la otra.
   *
   * `observacionesEnTabla` dice si la observación ya salió impresa en la
   * columna «Comentario»: si salió acá sería la segunda vez que el lector
   * ve el mismo texto.
   */
  const pintarEvidencias = (pendiente: PendienteCargo, observacionesEnTabla: boolean) => {
    const bloques = pendiente.evidencias.filter(
      (e) => e.fotos.length || (e.comentario && !observacionesEnTabla)
    )
    if (!bloques.length) return
    const conRotulo = new Set(bloques.map((b) => b.punto).filter(Boolean)).size > 1
    bloques.forEach((bloque, i) => {
      if (i) y += 3
      if (conRotulo && bloque.punto) {
        textoLinea(bloque.punto, { bold: true, size: 9, gap: 3, color: MARINO })
      }
      if (bloque.comentario && !observacionesEnTabla) {
        textoLinea(`Observación: ${bloque.comentario}`, { size: 8.5, gap: 3, color: GRIS })
      }
      pintarFotos(bloque.fotos)
    })
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
      'Los puntos no cumplidos son los que se le descontaron por los ítems de cada bloque; en cada ' +
      'tabla, la columna Puntos reparte ese total entre los puntos que fallaron y por eso suma el TOTAL.',
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

      // La observación que el evaluador dejó en el punto, en la columna del
      // propio punto. Misma regla que el informe general: la columna aparece
      // sólo si hay alguna —una columna de guiones en todas las filas es ruido
      // en el papel—.
      const observaciones = new Map(
        pendiente.evidencias.filter((e) => e.comentario).map((e) => [e.punto, e.comentario])
      )
      const conObservaciones = pendiente.checks.length > 0 && observaciones.size > 0

      if (pendiente.checks.length) {
        // El estado va con la MISMA palabra que el informe general: el lector
        // no puede tener que adivinar que acá «sin fila roja» significa lo
        // mismo que «NO APROBADO» allá.
        const anchos: Record<number, { cellWidth?: number; halign?: 'left' | 'center' | 'right' }> = {
          1: { cellWidth: 36, halign: 'center' },
          2: { cellWidth: 22, halign: 'right' }
        }
        // La observación se lleva el ancho que sobra: el nombre del punto
        // sigue siendo la columna más ancha, que es la que hay que poder leer.
        if (conObservaciones) anchos[3] = { cellWidth: 64 }
        tabla(
          conObservaciones
            ? ['Punto sin cumplir', 'Estado', 'Puntos', 'Comentario']
            : ['Punto sin cumplir', 'Estado', 'Puntos'],
          [
            ...pendiente.checks.map((check, i) => [
              check,
              { content: ESTADO_NO_APROBADO, styles: { fontStyle: 'bold', textColor: ROJO } },
              // Lo que le costó ESTE punto a ESTE cargo. Si no hay con qué
              // repartir sale un guion y no una celda en blanco: un hueco
              // parece un dato faltante, un guion dice «no aplica».
              pendiente.puntos[i] == null ? '—' : fmt(pendiente.puntos[i]),
              ...(conObservaciones ? [observaciones.get(check) || '—'] : [])
            ]),
            [
              // La fila de cierre destaca por su fondo, no por una línea negra
              // más gruesa: mismo criterio que el resto del documento.
              {
                content: 'TOTAL del ítem',
                colSpan: conObservaciones ? 3 : 2,
                styles: { fontStyle: 'bold', fillColor: MARINO_CLARO, textColor: MARINO }
              },
              {
                content: fmt(pendiente.perdidos),
                styles: { fontStyle: 'bold', halign: 'right', fillColor: MARINO_CLARO, textColor: MARINO }
              }
            ]
          ],
          {
            columnStyles: anchos
          }
        )
      } else {
        // Ítems binarios y de plano: el ítem entero es la falla. Se imprime una
        // sola fila con los puntos, sin repetir «el ítem falló», que sería
        // tautológico. Sus observaciones salen en los bloques de abajo, cada
        // una pegada a sus fotos.
        tabla(
          ['Falla', 'Estado', 'Puntos'],
          [
            [
              {
                content: `Ítem completo (${etiquetaTipo(pendiente.tipo)})`,
                styles: { fontStyle: 'bold', fillColor: FONDO }
              },
              {
                content: ESTADO_NO_APROBADO,
                styles: { fontStyle: 'bold', textColor: ROJO, fillColor: FONDO }
              },
              {
                content: fmt(pendiente.perdidos),
                styles: { fontStyle: 'bold', halign: 'right', fillColor: FONDO, textColor: MARINO }
              }
            ]
          ],
          { columnStyles: { 1: { cellWidth: 36, halign: 'center' }, 2: { cellWidth: 22, halign: 'right' } } }
        )
      }
      // La evidencia de cada punto, después de lo que falló: es la evidencia
      // de esa misma tabla, así que va pegada a ella y no en un anexo aparte.
      pintarEvidencias(pendiente, conObservaciones)
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
 * De dónde salen las observaciones y las fotos de cada punto del reporte.
 *
 * Son datos crudos de la evaluación, no cálculos: la pantalla junta lo que ya
 * tiene (las respuestas y las fotos de la tabla `fotos`) y el documento
 * resuelve qué le toca a cada cargo con `evidenciasDeFalla`, el mismo
 * criterio con el que hoy reparte las fotos entre cargos.
 *
 * Sin contexto el reporte sale igual, pero sin observaciones ni fotos: es lo
 * que hace que un armado a mano en una prueba no dependa de tener respuestas.
 */
export interface ContextoReporteCargos {
  /** Respuestas de la evaluación: de acá salen las observaciones de cada punto. */
  respuestas: { item_id: string; valor: unknown }[]
  /** Fotos de la tabla `fotos`, que se guardan contra el ítem y no contra un punto. */
  fotos?: { item_id: string; path: string }[]
  /**
   * Los ítems con sus opciones: de ahí sale el PESO de cada punto, para poder
   * repartir los puntos perdidos del ítem entre los puntos que le fallaron.
   * Sin ellos la fila imprime «—» y el TOTAL sigue diciendo cuánto costó.
   */
  items?: { id: string; opciones?: { id: string; puntos?: number }[] | null }[]
  /**
   * El histórico de la unidad, para el **historial de reincidencias** de cada
   * punto: es lo que permite decir «esto ya falló la vez pasada».
   *
   * Sin él los pendientes salen con `historial` vacío y el documento se imprime
   * igual, sólo que sin ese dato. No es opcional por gusto: calcularlo exige
   * las evaluaciones anteriores de la sucursal, que no están en el detalle de
   * una sola evaluación.
   */
  historial?: { datos: ConjuntoDatos; unidadId: string; evaluacionId: string }
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
  contexto?: ContextoReporteCargos
): ReporteCargosDatos {
  const nombreModulo = new Map(modulos.map((m) => [m.id, m.nombre]))
  const respuestasDe = porItem(contexto?.respuestas ?? [], (r) => r.item_id)
  const fotosDe = porItem(contexto?.fotos ?? [], (f) => f.item_id)
  const opcionesDe = new Map((contexto?.items ?? []).map((i) => [i.id, i.opciones ?? []]))
  return {
    ...encabezado,
    cargos: elegidos.map((e) => {
      // El historial de reincidencias es POR CARGO: `puntosFalladosDeCargo`
      // mide a ese cargo contra el histórico de esa unidad y devuelve sólo los
      // puntos que cayeron en ESTA evaluación.
      const porPunto = new Map<string, HistorialPunto>()
      if (contexto?.historial) {
        const puntos = puntosFalladosDeCargo(
          contexto.historial.datos,
          e.cargo,
          contexto.historial.unidadId,
          contexto.historial.evaluacionId
        )
        // La clave es el nombre del punto (dentro de un ítem son únicos); en
        // los ítems sin checks el punto es el ítem entero y `check` viene
        // null, que viaja como cadena vacía.
        for (const p of puntos) {
          porPunto.set(p.check ?? '', {
            faltas: p.faltas,
            reincidencias: p.reincidencias,
            esReincidente: p.esReincidente
          })
        }
      }
      return {
        cargo: e.cargo,
        porciento: e.porciento,
        perdidos: e.fallas.reduce((suma, f) => suma + f.perdidos, 0),
        pendientes: [...e.fallas]
          .sort((a, b) => b.perdidos - a.perdidos)
          .map((f) => {
            // Las fotos y las observaciones se resuelven UNA vez por pendiente,
            // contra las respuestas del ítem: en los ítems de lista cada punto
            // tiene las suyas, y darle las del ítem entero sería imprimirle a un
            // cargo evidencia de un punto que no es suyo.
            const evidencias = contexto
              ? evidenciasDeFalla({
                  tipo: f.tipo,
                  checkIds: f.checkIds,
                  checks: f.checks,
                  respuestas: respuestasDe.get(f.item_id) ?? [],
                  pathsDeTabla: (fotosDe.get(f.item_id) ?? []).map((foto) => foto.path)
                })
              : []
            const historial: Record<string, HistorialPunto> = {}
            for (const check of f.checks.length ? f.checks : ['']) {
              const h = porPunto.get(check)
              if (h) historial[check] = h
            }
            return {
              item: f.texto,
              modulo: f.modulo_id ? (nombreModulo.get(f.modulo_id) ?? null) : null,
              tipo: f.tipo,
              perdidos: f.perdidos,
              checks: f.checks,
              puntos: contexto ? repartirPuntos(f, opcionesDe.get(f.item_id) ?? []) : [],
              evidencias,
              historial,
              fotos: evidencias.flatMap((ev) => ev.fotos)
            }
          })
      }
    })
  }
}

/**
 * Reparte `perdidos` —lo que costó el ÍTEM a ESTE cargo— entre LOS PUNTOS QUE
 * LE CAYERON, para que la columna «Puntos» tenga número y cierre contra el
 * TOTAL de su bloque.
 *
 * Dos pesos, según cómo puntúa el ítem (el mismo criterio con el que se
 * calculó `perdidos`):
 *
 *  * **Proporcional**: cuando TODAS las opciones del ítem traen `puntos > 0`,
 *    el ítem puntúa por peso y cada punto cuesta lo que vale —el mismo número
 *    que muestra el módulo en su badge «N pts», escalado por lo que perdió.
 *  * **En partes iguales**: si una sola opción no tiene peso no hay con qué
 *    compararlas, el ítem es completo o no, y el corte es por cantidad.
 *
 * En los dos casos la columna suma EXACTO el TOTAL: la última fila se lleva
 * el resto del redondeo, que es la única promesa que hace este número (si no,
 * un lector que sume la columna y no dé con el total deja de creerle al
 * documento entero).
 *
 * Devuelve `[]` cuando no hay con qué repartir: si los nombres (`checks`) y
 * los ids (`checkIds`) de los puntos no vienen alineados, no se puede saber
 * qué número va en qué fila, y un número en la fila equivocado es peor que
 * un guion.
 */
function repartirPuntos(
  falla: { perdidos: number; checks: string[]; checkIds: string[] },
  opciones: { id: string; puntos?: number }[]
): number[] {
  const cantidad = falla.checks.length
  if (!cantidad || falla.checkIds.length !== cantidad) return []
  const proporcional = opciones.length > 0 && opciones.every((o) => typeof o.puntos === 'number' && o.puntos > 0)
  const pesos = falla.checkIds.map((id) =>
    proporcional ? (opciones.find((o) => o.id === id)?.puntos ?? 1) : 1
  )
  const suma = pesos.reduce((a, b) => a + b, 0)
  if (!(suma > 0)) return []

  const filas: number[] = []
  let acumulado = 0
  for (let i = 0; i < cantidad; i++) {
    const bruto = i === cantidad - 1 ? falla.perdidos - acumulado : (falla.perdidos * pesos[i]) / suma
    // Nunca un número negativo en el papel: en el borde del redondeo el resto
    // podría quedar chico, y un guion sigue siendo mejor que −0,001.
    const valor = Math.max(0, redondear3(bruto))
    filas.push(valor)
    acumulado = redondear3(acumulado + valor)
  }
  return filas
}

/** Agrupa las filas de un lado por `item_id` de una sola pasada. */
function porItem<T>(filas: T[], itemDe: (fila: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const fila of filas) {
    const id = itemDe(fila)
    const lista = mapa.get(id)
    if (lista) lista.push(fila)
    else mapa.set(id, [fila])
  }
  return mapa
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
  // Los videos quedan fuera: el PDF sólo sabe pegar imágenes (`addImage`) y un
  // video no tiene un cuadro que imprimir. Siguen disponibles en la app, en la
  // misma evidencia del punto.
  const paths = Array.from(new Set(datos.cargos.flatMap((c) => c.pendientes.flatMap((p) => p.fotos))))
    .filter((p) => !esVideoPath(p))
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
