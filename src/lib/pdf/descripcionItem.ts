/**
 * La descripción de un ítem (`items.descripcion`) pintada en el PDF de
 * «Qué mide y cómo se mide».
 *
 * El texto se guarda como markdown mínimo (ver `src/lib/markdown.ts`), así que
 * acá se vuelve a parsear y se dibuja con la familia visual del documento:
 *
 *   - la **negrita** y la *cursiva* salen con su estilo. jsPDF no mezcla dos
 *     estilos dentro de un mismo `text`, así que cada renglón se mide palabra
 *     por palabra y se pinta agrupando los tramos seguidos del mismo estilo;
 *     el corte es por renglón, no por bloque, así una descripción larga no se
 *     cae entera a la página siguiente dejando un hueco;
 *   - las listas salen con su viñeta o número y el texto sangrado (la
 *     continuación del ítem queda alineada bajo el texto, no bajo el punto);
 *   - las tablas usan `ESTILO_TABLA`, iguales a las del resto del PDF.
 *
 * Lo que no sea texto (una celda con formato) se aplanó antes en el parser:
 * en el papel no queda ni un `**` ni un pipe.
 */
import autoTable from 'jspdf-autotable'
import type { jsPDF } from 'jspdf'
import { aTextoPlanoNodos, parsearMarkdown, type BloqueMD, type InlineMD } from '../markdown'
import { ESTILO_TABLA, MARGEN, TINTA, type Geometria } from './composicion'
import type { RGB } from './graficos'

type Estilo = 'normal' | 'bold' | 'italic' | 'bolditalic'
interface Tramo {
  texto: string
  estilo: Estilo
}
/** Palabra suelta con su estilo, la unidad con la que se envuelve un renglón. */
interface Palabra {
  texto: string
  estilo: Estilo
}

export interface OpcionesDescripcion {
  /** Tamaño de la letra (pt). */
  size?: number
  /** Aire que deja el bloque hacia lo que sigue (mm). */
  gap?: number
  color?: RGB
  /** Sangría inicial, para anidar dentro de otro bloque. */
  sangria?: number
}

/** Suma de estilos: `**_negrita cursiva_**` es la de los dos. */
function combinar(base: Estilo, hijo: 'negrita' | 'cursiva'): Estilo {
  if (hijo === 'negrita') return base === 'italic' || base === 'bolditalic' ? 'bolditalic' : 'bold'
  return base === 'bold' || base === 'bolditalic' ? 'bolditalic' : 'italic'
}

function tramosDe(hijos: InlineMD[], estilo: Estilo = 'normal'): Tramo[] {
  return hijos.flatMap((h): Tramo[] => {
    if (h.t === 'texto') return [{ texto: h.v, estilo }]
    return tramosDe(h.hijos, combinar(estilo, h.t))
  })
}

/** Parte los tramos por los saltos de línea escritos a mano. */
function porLineas(tramos: Tramo[]): Tramo[][] {
  const lineas: Tramo[][] = [[]]
  for (const t of tramos) {
    t.texto.split('\n').forEach((parte, i) => {
      if (i > 0) lineas.push([])
      if (parte) lineas[lineas.length - 1].push({ texto: parte, estilo: t.estilo })
    })
  }
  return lineas
}

function aPalabras(tramos: Tramo[]): Palabra[] {
  const palabras: Palabra[] = []
  for (const t of tramos) {
    // Los espacios van como trozos propios: así el ancho del renglón es la
    // suma exacta de sus partes y la palabra que no cabe se corta limpio.
    for (const parte of t.texto.split(/(\s+)/)) {
      if (parte) palabras.push({ texto: parte, estilo: t.estilo })
    }
  }
  return palabras
}

/**
 * Pinta la descripción entera y devuelve la nueva posición del cursor.
 *
 * `geo` se pasa como objeto vivo: si hay que abrir hoja, se repinta en la
 * siguiente y el builder de afuera sigue con la `y` que devolvemos acá.
 */
export function pintarDescripcionItem(
  pdf: jsPDF,
  descripcion: string,
  geo: Geometria,
  opciones: OpcionesDescripcion = {}
): number {
  const size = opciones.size ?? 9
  const gap = opciones.gap ?? 2
  const color = opciones.color ?? TINTA
  const sangriaBase = opciones.sangria ?? 0
  const altoLinea = size * 0.42
  let y = geo.y

  const anchoPalabra = (p: Palabra): number => {
    pdf.setFont('helvetica', p.estilo)
    pdf.setFontSize(size)
    return pdf.getTextWidth(p.texto)
  }

  /**
   * Envuelve y pinta un bloque de texto. `marcador` (viñeta o número) va sólo
   * en el primer renglón, a la izquierda, y el texto arranca después: así la
   * continuación de un ítem largo queda sangrada bajo su texto.
   */
  const pintarTexto = (lineas: Tramo[][], marcador?: string): number => {
    let anchoMarcador = 0
    if (marcador) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(size)
      anchoMarcador = pdf.getTextWidth(marcador) + 1.5
    }
    // Todo lo del documento arranca en el margen: `sangriaBase` es aire
    // adentro del bloque, no la posición de la hoja.
    const xBase = MARGEN + sangriaBase
    const xTexto = xBase + anchoMarcador
    const anchoUtil = geo.anchoUtil - sangriaBase - anchoMarcador
    let conMarcador = !!marcador

    const pintarRenglon = (grupo: Palabra[]) => {
      if (y + altoLinea > geo.alto - MARGEN) {
        pdf.addPage()
        y = MARGEN
      }
      let x = conMarcador ? xBase : xTexto
      let trozo = ''
      let estiloActual = grupo[0].estilo
      // La viñeta entra en el mismo `text` que la primera palabra si ambas
      // van con el mismo estilo: el papel queda legible al copiar y al buscar.
      if (conMarcador) {
        if (estiloActual === 'normal') trozo = marcador ?? ''
        else {
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(size)
          pdf.setTextColor(...color)
          pdf.text(marcador ?? '', x, y)
        }
        x = xTexto
        conMarcador = false
      }
      const cerrar = () => {
        if (!trozo) return
        pdf.setFont('helvetica', estiloActual)
        pdf.setFontSize(size)
        pdf.setTextColor(...color)
        pdf.text(trozo, x, y)
        x += pdf.getTextWidth(trozo)
        trozo = ''
      }
      for (const palabra of grupo) {
        if (palabra.estilo !== estiloActual) {
          cerrar()
          estiloActual = palabra.estilo
        }
        trozo += palabra.texto
      }
      cerrar()
      y += altoLinea
    }

    for (const linea of lineas) {
      const palabras = aPalabras(linea)
      // Un renglón vacío (doble salto) igual avanza: si no, los párrafos
      // separados en blanco se aplastarían uno contra el otro.
      if (!palabras.length) {
        if (y + altoLinea > geo.alto - MARGEN) {
          pdf.addPage()
          y = MARGEN
        }
        y += altoLinea
        continue
      }
      let grupo: Palabra[] = []
      const anchoDe = (ps: Palabra[]) => ps.reduce((a, p) => a + anchoPalabra(p), 0)
      for (const palabra of palabras) {
        const ancho = anchoPalabra(palabra)
        if (grupo.length && anchoDe(grupo) + ancho > anchoUtil) {
          pintarRenglon(grupo)
          grupo = []
          // El espacio del corte no arranca un renglón.
          if (!palabra.texto.trim()) continue
        }
        grupo.push(palabra)
      }
      if (grupo.length) pintarRenglon(grupo)
    }
    return y
  }

  const pintarTabla = (bloque: { cabecera: InlineMD[][]; filas: InlineMD[][][] }) => {
    const cabecera = bloque.cabecera.map((c) => aTextoPlanoNodos(c))
    if (!cabecera.length) return
    autoTable(pdf, {
      ...ESTILO_TABLA,
      head: [cabecera],
      body: bloque.filas.map((fila) => fila.map((c) => aTextoPlanoNodos(c))),
      startY: y,
      margin: { top: MARGEN, right: MARGEN, bottom: MARGEN, left: MARGEN }
    })
    y = (pdf as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
    y += 3
  }

  const pintarBloque = (bloque: BloqueMD) => {
    if (bloque.t === 'parrafo') {
      y = pintarTexto(porLineas(tramosDe(bloque.hijos)))
      return
    }
    if (bloque.t === 'lista') {
      bloque.items.forEach((item, i) => {
        const marcador = bloque.ordenada ? `${i + 1}. ` : '• '
        y = pintarTexto(porLineas(tramosDe(item)), marcador)
      })
      return
    }
    pintarTabla(bloque)
  }

  for (const bloque of parsearMarkdown(descripcion)) {
    pintarBloque(bloque)
    y += gap
  }
  return y
}
