/**
 * Escritor mínimo de archivos `.xlsx` (Office Open XML), sin dependencias.
 *
 * Un `.xlsx` es un ZIP de XMLs. Éste se compone en memoria con entradas STORE
 * (sin comprimir): el contenido ya es texto y pesa poco, así el archivo sale
 * determinista —fecha fija dentro del ZIP— y un test puede recorrerlo entero,
 * estructura de ZIP incluida, sin abrir Excel. La alternativa era sumar SheetJS
 * o exceljs (del orden de 1 MB) sólo para unas cuantas pestañas.
 *
 * Cada hoja lleva su encabezado en negritas, la fila 1 congelada y autofiltro
 * sobre el rango usado: son dos elementos de XML que ahorran el scroll en una
 * hoja de cientos de renglones.
 */

export type CeldaExcel = string | number | null

export interface HojaExcel {
  /** Nombre de la pestaña; se sanea a lo que Excel acepta (31 chars, sin `[]:*?/\`). */
  nombre: string
  /** Filas de celdas; `null` deja la celda vacía. La fila 1 es el encabezado. */
  filas: CeldaExcel[][]
}

const NS_HOJA = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_REL_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NS_TIPOS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const codificador = new TextEncoder()

/** Fecha fija dentro del ZIP (2026-01-01 00:00): el archivo no cambia de byte por exportarlo hoy o mañana. */
const FECHA_DOS = (46 << 9) | (1 << 5) | 1
const HORA_DOS = 0

/** XML sólo admite 0x09, 0x0A y 0x0D de la franja de control; el resto se descarta. */
function limpiarXml(texto: string): string {
  // eslint-disable-next-line no-control-regex -- el rango es la lista de caracteres de control que XML prohíbe
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Referencia de celda: (fila 1, columna 1) → A1, columna 27 → AA1. */
function referencia(fila: number, columna: number): string {
  let letras = ''
  let resto = columna
  while (resto > 0) {
    resto--
    letras = String.fromCharCode(65 + (resto % 26)) + letras
    resto = Math.floor(resto / 26)
  }
  return `${letras}${fila}`
}

/**
 * Nombres de pestaña como Excel los acepta: hasta 31 caracteres, sin los
 * caracteres prohibidos de `[]:*?/\`, sin apóstrofes en los bordes y sin
 * repetir (un duplicado tira el archivo entero).
 */
function nombresDeHojas(hojas: HojaExcel[]): string[] {
  const usados = new Set<string>()
  return hojas.map((hoja) => {
    const base =
      hoja.nombre
        .replace(/[[\]:*?/\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^'+|'+$/g, '')
        .trim()
        .slice(0, 31)
        .trim() || 'Hoja'
    let nombre = base
    let sufijo = 2
    while (usados.has(nombre)) {
      nombre = `${base.slice(0, 28)} (${sufijo++})`
    }
    usados.add(nombre)
    return nombre
  })
}

/** Ancho de cada columna en caracteres: lo que mide su celda más larga, acotado a 8–60. */
function anchoColumnas(filas: CeldaExcel[][]): number[] {
  const largos: number[] = []
  for (const fila of filas) {
    fila.forEach((celda, i) => {
      if (celda === null) return
      const largo = String(celda).length
      if (largo > (largos[i] ?? 0)) largos[i] = largo
    })
  }
  return Array.from({ length: largos.length }, (_, i) => Math.min(60, Math.max(8, (largos[i] ?? 0) + 2)))
}

function hojaXml(filas: CeldaExcel[][]): string {
  const columnas = filas.reduce((max, fila) => Math.max(max, fila.length), 0)
  const anchos = anchoColumnas(filas)
  const cols =
    columnas > 0
      ? `<cols>${anchos
          .map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`)
          .join('')}</cols>`
      : ''
  const filasXml: string[] = []
  filas.forEach((fila, i) => {
    const numeroFila = i + 1
    const celdas: string[] = []
    fila.forEach((celda, j) => {
      if (celda === null) return
      const ref = referencia(numeroFila, j + 1)
      // La fila 1 (encabezado) sale en negrita vía el estilo 1 de styles.xml.
      const estilo = numeroFila === 1 ? ' s="1"' : ''
      if (typeof celda === 'number') {
        if (!Number.isFinite(celda)) return
        celdas.push(`<c r="${ref}"${estilo}><v>${celda}</v></c>`)
      } else {
        const texto = escaparXml(limpiarXml(celda))
        celdas.push(`<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`)
      }
    })
    filasXml.push(`<row r="${numeroFila}">${celdas.join('')}</row>`)
  })
  const conEncabezado = filas.length > 0 && columnas > 0
  const vistas = conEncabezado
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    : ''
  const filtro = conEncabezado ? `<autoFilter ref="A1:${referencia(filas.length, columnas)}"/>` : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS_HOJA}">${vistas}${cols}<sheetData>${filasXml.join('')}</sheetData>${filtro}</worksheet>`
}

function estilosXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS_HOJA}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    // Excel exige las dos entradas de relleno: none y gray125.
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  )
}

function workbookXml(nombres: string[]): string {
  const hojas = nombres
    .map((nombre, i) => `<sheet name="${escaparXml(nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS_HOJA}" xmlns:r="${NS_REL}"><sheets>${hojas}</sheets></workbook>`
}

function relsWorkbookXml(total: number): string {
  const hojas = Array.from(
    { length: total },
    (_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PKG}">${hojas}` +
    `<Relationship Id="rId${total + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`
  )
}

function contentTypesXml(total: number): string {
  const hojas = Array.from(
    { length: total },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${NS_TIPOS}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    hojas +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  )
}

function raizRelsXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS_REL_PKG}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/>` +
    '</Relationships>'
  )
}

function coreXml(): string {
  const ahora = new Date().toISOString()
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:creator>EvaLuxor</dc:creator><cp:lastModifiedBy>EvaLuxor</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${ahora}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${ahora}</dcterms:modified>` +
    '</cp:coreProperties>'
  )
}

function appXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    '<Application>EvaLuxor</Application></Properties>'
  )
}

/** CRC-32 con el polinomio 0xEDB88320: la huella que el ZIP pide por entrada. */
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  return tabla
})()

export function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of datos) crc = TABLA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Cabecera local de una entrada ZIP (30 bytes + nombre). */
function encabezadoLocal(nombre: Uint8Array, crc: number, tam: number): Uint8Array {
  const buffer = new Uint8Array(30 + nombre.length)
  const vista = new DataView(buffer.buffer)
  vista.setUint32(0, 0x04034b50, true)
  vista.setUint16(4, 20, true) // versión mínima requerida
  vista.setUint16(6, 0, true) // banderas: nombres ASCII, sin data descriptor
  vista.setUint16(8, 0, true) // método STORE (sin comprimir)
  vista.setUint16(10, HORA_DOS, true)
  vista.setUint16(12, FECHA_DOS, true)
  vista.setUint32(14, crc, true)
  vista.setUint32(18, tam, true)
  vista.setUint32(22, tam, true)
  vista.setUint16(26, nombre.length, true)
  vista.setUint16(28, 0, true)
  buffer.set(nombre, 30)
  return buffer
}

/** Registro del directorio central (46 bytes + nombre). */
function entradaCentral(nombre: Uint8Array, crc: number, tam: number, offset: number): Uint8Array {
  const buffer = new Uint8Array(46 + nombre.length)
  const vista = new DataView(buffer.buffer)
  vista.setUint32(0, 0x02014b50, true)
  vista.setUint16(4, 20, true) // hecho por: DOS, versión 2.0
  vista.setUint16(6, 20, true)
  vista.setUint16(8, 0, true)
  vista.setUint16(10, 0, true)
  vista.setUint16(12, HORA_DOS, true)
  vista.setUint16(14, FECHA_DOS, true)
  vista.setUint32(16, crc, true)
  vista.setUint32(20, tam, true)
  vista.setUint32(24, tam, true)
  vista.setUint16(28, nombre.length, true)
  vista.setUint16(30, 0, true)
  vista.setUint16(32, 0, true)
  vista.setUint16(34, 0, true)
  vista.setUint16(36, 0, true)
  vista.setUint32(38, 0, true)
  vista.setUint32(42, offset, true)
  buffer.set(nombre, 46)
  return buffer
}

/** Fin del directorio central (22 bytes): lo que un lector busca desde el final. */
function finDirectorio(total: number, tamDirectorio: number, offsetDirectorio: number): Uint8Array {
  const buffer = new Uint8Array(22)
  const vista = new DataView(buffer.buffer)
  vista.setUint32(0, 0x06054b50, true)
  vista.setUint16(4, 0, true)
  vista.setUint16(6, 0, true)
  vista.setUint16(8, total, true)
  vista.setUint16(10, total, true)
  vista.setUint32(12, tamDirectorio, true)
  vista.setUint32(16, offsetDirectorio, true)
  vista.setUint16(20, 0, true)
  return buffer
}

function juntar(piezas: Uint8Array[]): Uint8Array {
  const total = piezas.reduce((suma, pieza) => suma + pieza.length, 0)
  const salida = new Uint8Array(total)
  let offset = 0
  for (const pieza of piezas) {
    salida.set(pieza, offset)
    offset += pieza.length
  }
  return salida
}

/**
 * Compone el `.xlsx` completo en memoria, con las hojas en el orden dado.
 * Un libro sin hojas no es un formato válido, así que en ese caso (defensivo,
 * ningún llamador llega ahí) se produce un libro con una hoja vacía.
 */
export function crearXlsx(hojas: HojaExcel[]): Uint8Array {
  const lista: HojaExcel[] = hojas.length ? hojas : [{ nombre: 'Hoja1', filas: [] }]
  const nombres = nombresDeHojas(lista)
  const piezas: { nombre: string; datos: Uint8Array }[] = [
    { nombre: '[Content_Types].xml', datos: codificador.encode(contentTypesXml(lista.length)) },
    { nombre: '_rels/.rels', datos: codificador.encode(raizRelsXml()) },
    { nombre: 'docProps/core.xml', datos: codificador.encode(coreXml()) },
    { nombre: 'docProps/app.xml', datos: codificador.encode(appXml()) },
    { nombre: 'xl/workbook.xml', datos: codificador.encode(workbookXml(nombres)) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: codificador.encode(relsWorkbookXml(lista.length)) },
    { nombre: 'xl/styles.xml', datos: codificador.encode(estilosXml()) },
    ...lista.map((hoja, i) => ({
      nombre: `xl/worksheets/sheet${i + 1}.xml`,
      datos: codificador.encode(hojaXml(hoja.filas))
    }))
  ]
  const locales: Uint8Array[] = []
  const centrales: Uint8Array[] = []
  let offset = 0
  for (const pieza of piezas) {
    const nombre = codificador.encode(pieza.nombre)
    const crc = crc32(pieza.datos)
    const local = encabezadoLocal(nombre, crc, pieza.datos.length)
    centrales.push(entradaCentral(nombre, crc, pieza.datos.length, offset))
    locales.push(local, pieza.datos)
    offset += local.length + pieza.datos.length
  }
  const directorio = juntar(centrales)
  return juntar([...locales, directorio, finDirectorio(piezas.length, directorio.length, offset)])
}
