// Genera public/plantilla-menu.xlsx: hoja «Carta» con los tres encabezados
// que reconoce filasDesdeMatriz() y hoja «Instrucciones». Se corre a mano
// cuando cambian los encabezados —
//     node scripts/generar_plantilla_menu.mjs
// — y lo verifica src/lib/data/plantillaMenu.test.ts contra el archivo real.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RUTA = fileURLToPath(new URL('../public/plantilla-menu.xlsx', import.meta.url))

const xml = (cuerpo) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${cuerpo}`

const ENCABEZADOS = ['ID del producto', 'comentario', 'configuración (MTN)']

const INSTRUCCIONES = [
  'PLANTILLA DEL MENÚ — cómo llenarla',
  '',
  '1. Llenar sólo la hoja «Carta».',
  'Columna A — ID del producto: el código de barra o el ID que busca la consola.',
  'Columna B — comentario: el texto que muestra la carta (opcional).',
  'Columna C — configuración: las letras que aplican, juntas o separadas.',
  '             M = mañana (06:00 a 11:59), T = tarde (12:00 a 17:59),',
  '             N = noche (18:00 a 05:59). Vacío o «todo el día» = M, T y N.',
  '             Ejemplos válidos: MTN · M, N · TN · Noche · Todo el día.',
  '',
  '2. En la consola (Menú de la sucursal) tocar «Elegir archivo».',
  'La consola pregunta si quiere crear lo que no existe, actualizar lo que',
  'existe y eliminar lo que no esté en el archivo, antes de tocar nada.',
  '',
  '3. Los IDs que la API de precios no conoce se saltan y se listan al final.',
  '',
  'Los productos que ya estaban conservan su categoría y su foto.'
]

const celdaTexto = (ref, texto) =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</t></is></c>`

const hojaCarta = xml(
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData><row r="1">` +
    ENCABEZADOS.map((t, i) => celdaTexto(`${String.fromCharCode(65 + i)}1`, t)).join('') +
    `</row></sheetData></worksheet>`
)

const hojaInstrucciones = xml(
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>` +
    INSTRUCCIONES.map((t, i) => `<row r="${i + 1}">${celdaTexto(`A${i + 1}`, t)}</row>`).join('') +
    `</sheetData></worksheet>`
)

const styles = xml(
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
    `</styleSheet>`
)

const contentTypes = xml(
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`
)

const raizRels = xml(
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`
)

const workbook = xml(
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    `<sheet name="Carta" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Instrucciones" sheetId="2" r:id="rId2"/>` +
    `</sheets></workbook>`
)

const workbookRels = xml(
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
)

const partes = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', raizRels],
  ['xl/workbook.xml', workbook],
  ['xl/_rels/workbook.xml.rels', workbookRels],
  ['xl/styles.xml', styles],
  ['xl/worksheets/sheet1.xml', hojaCarta],
  ['xl/worksheets/sheet2.xml', hojaInstrucciones]
]

/* ------------------------------ el zip (método 0) ------------------------------ */
const tabla = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  tabla[n] = c >>> 0
}
const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ tabla[(crc ^ bytes[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
const locales = []
const centrales = []
let offset = 0
for (const [nombre, contenido] of partes) {
  const nb = enc.encode(nombre)
  const datos = enc.encode(contenido)
  const crc = crc32(datos)

  const local = new Uint8Array(30 + nb.length)
  const vl = new DataView(local.buffer)
  vl.setUint32(0, 0x04034b50, true)
  vl.setUint16(4, 20, true)
  vl.setUint16(6, 0x0800, true)
  vl.setUint16(8, 0, true)
  vl.setUint16(10, 0, true)
  vl.setUint16(12, 0x2821, true) // 2026-01-01 00:00
  vl.setUint32(14, crc, true)
  vl.setUint32(18, datos.length, true)
  vl.setUint32(22, datos.length, true)
  vl.setUint16(26, nb.length, true)
  local.set(nb, 30)

  const central = new Uint8Array(46 + nb.length)
  const vc = new DataView(central.buffer)
  vc.setUint32(0, 0x02014b50, true)
  vc.setUint16(4, 20, true)
  vc.setUint16(6, 20, true)
  vc.setUint16(8, 0x0800, true)
  vc.setUint16(10, 0, true)
  vc.setUint16(12, 0, true)
  vc.setUint16(14, 0x2821, true)
  vc.setUint32(16, crc, true)
  vc.setUint32(20, datos.length, true)
  vc.setUint32(24, datos.length, true)
  vc.setUint16(28, nb.length, true)
  vc.setUint32(42, offset, true)
  central.set(nb, 46)

  locales.push(local, datos)
  centrales.push(central)
  offset += local.length + datos.length
}

const tamCentral = centrales.reduce((s, c) => s + c.length, 0)
const fin = new Uint8Array(22)
const vf = new DataView(fin.buffer)
vf.setUint32(0, 0x06054b50, true)
vf.setUint16(8, partes.length, true)
vf.setUint16(10, partes.length, true)
vf.setUint32(12, tamCentral, true)
vf.setUint32(16, offset, true)

const zip = Buffer.concat([...locales, ...centrales, fin])
writeFileSync(RUTA, zip)
console.log(`escrito: ${RUTA} (${zip.length} bytes, ${partes.length} partes)`)
