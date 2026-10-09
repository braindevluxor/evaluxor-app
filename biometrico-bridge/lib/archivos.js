// =============================================================================
// Lectura de marcajes desde archivos exportados del software de Anviz.
// =============================================================================
// El D100 no entrega los marcajes por USB (ver lib/usb.js): se baja el reporte
// con el software de PC de Anviz y se deja el archivo acá. Como cada versión
// exporta con un formato distinto, el lector es tolerante:
//
//   - separador `;` `,` tab o `|`;
//   - encabezado con o sin nombres de columna, en español o inglés;
//   - fechas en ISO, `YYYY-MM-DD HH:mm:ss`, `DD/MM/YYYY HH:mm` o epoch;
//   - tipo explícito (ENTRADA/SALIDA/Check In/Out) o ausente.
//
// Un registro sin tipo válido no se descarta: queda como OTRO y la web lo
// clasifica por jornada (impar = entrada, par = salida).
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const CARPETA_DATOS = join(__dirname, '..', 'data')

const SEPARADORES = [';', ',', '\t', '|']
const EXTENSIONES = new Set(['.csv', '.txt', '.tsv', '.log'])

// Palabras que identifican cada campo, en cualquier orden y con acentos.
const CLAVES = {
  dni: ['dni', 'documento', 'nro', 'numero', 'nrodocumento', 'id', 'userid', 'user', 'usuario', 'codigo', 'codigousuario', 'no', 'badgenumber', 'employeeno', 'pin'],
  fecha: ['fecha', 'date', 'time', 'hora', 'datetime', 'marcaje', 'marcado', 'checktime', 'eventtime', 'checkintime', 'checkouttime', 'timestamp', 'accessdate', 'authtime'],
  tipo: ['tipo', 'type', 'modo', 'mode', 'estado', 'resultado', 'result', 'action', 'operacion', 'descripcion', 'eventtype', 'inout', 'checktype']
}

/** Nombres de archivo que son el reporte de marcajes y no otra cosa. */
const NOMBRES_UTILES = /marcaje|fichaje|asistencia|attendance|record|report|log|acesso|check|access/i

function sinAcentos(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function partirLinea(linea, sep) {
  const celdas = []
  let actual = ''
  let enComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]
    if (c === '"') {
      if (enComillas && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else enComillas = !enComillas
    } else if (c === sep && !enComillas) {
      celdas.push(actual.trim())
      actual = ''
    } else actual += c
  }
  celdas.push(actual.trim())
  return celdas
}

/** El separador que produce celdas más consistentes en todo el archivo. */
export function detectarSeparador(lineas) {
  let mejor = ';'
  let mejorPuntaje = -1
  for (const sep of SEPARADORES) {
    const conteos = lineas.slice(0, 20).map((l) => partirLinea(l, sep).length)
    const comunes = conteos.filter((n) => n > 1)
    if (!comunes.length) continue
    const primero = comunes[0]
    const consistentes = comunes.filter((n) => n === primero).length
    const puntaje = consistentes * 10 - primero
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejor = sep
    }
  }
  return mejor
}

/** Traduce los encabezados a nuestros tres campos; null si no parece encabezado. */
export function mapearEncabezado(celdas) {
  const mapa = { dni: -1, fecha: -1, tipo: -1 }
  celdas.forEach((celda, i) => {
    const n = sinAcentos(celda).replace(/[^a-z0-9]/g, '')
    if (!n) return
    for (const campo of Object.keys(CLAVES)) {
      if (mapa[campo] === -1 && CLAVES[campo].some((k) => n === k || n.includes(k))) {
        mapa[campo] = i
      }
    }
  })
  // Sin columna de fecha no es un reporte de marcajes.
  return mapa.fecha === -1 ? null : mapa
}

/**
 * Convierte a Date lo que venga en el reporte. Devuelve null si no es fecha,
 * para que el registro se descarte en vez de guardar una fecha inventada.
 */
export function parsearFecha(valor) {
  const s = String(valor ?? '').trim()
  if (!s) return null

  // Epoch en segundos o milisegundos.
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000)
  if (/^\d{13}$/.test(s)) return new Date(Number(s))

  // Con zona explícita (Z o +hh:mm) manda el string: reinterpretarlo como hora
  // local correría la hora del marcaje (en UTC-3, cuatro horas).
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const conZona = new Date(s)
    if (!Number.isNaN(conZona.getTime())) return conZona
  }

  // ISO sin zona (con o sin T) y con/sin segundos: se interpreta en hora local.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))

  // DD/MM/AAAA o MM/DD/AAAA. Si el primer número es > 12, es día sin duda.
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    let [, a, b, anio, hh, mm, ss] = m
    let dia = Number(a)
    let mes = Number(b)
    if (dia > 12) {
      // dd/mm
    } else if (mes > 12) {
      ;[dia, mes] = [mes, dia]
    } // si ambos <= 12, se asume dd/mm (Anviz es dd/mm/yyyy)
    if (anio.length === 2) anio = `20${anio}`
    return new Date(Number(anio), mes - 1, dia, Number(hh), Number(mm), Number(ss ?? 0))
  }

  const directo = new Date(s)
  return Number.isNaN(directo.getTime()) ? null : directo
}

/** Deduce ENTRADA / SALIDA de los textos que usa cada versión del software. */
export function parsearTipo(valor) {
  const s = sinAcentos(String(valor ?? '').trim())
  if (!s) return 'OTRO'
  if (/^(entrada|entrar|ingreso|check ?in|in|login|ent)$/.test(s)) return 'ENTRADA'
  if (/^(salida|salir|retiro|check ?out|out|logout|sal)$/.test(s)) return 'SALIDA'
  if (/^(entrada|salida|in|out)/.test(s)) return s.startsWith('entrada') ? 'ENTRADA' : 'SALIDA'
  return 'OTRO'
}

/** Archivos candidatos en `data/`: los de marcaje, el más reciente primero. */
export function archivosDeMarcajes(carpeta = CARPETA_DATOS) {
  if (!existsSync(carpeta)) return []
  return readdirSync(carpeta)
    .filter((n) => EXTENSIONES.has(extname(n).toLowerCase()))
    .map((n) => {
      const ruta = join(carpeta, n)
      let mtime = 0
      try {
        mtime = statSync(ruta).mtimeMs
      } catch {
        mtime = 0
      }
      return { nombre: n, ruta, mtime }
    })
    .filter((a) => NOMBRES_UTILES.test(a.nombre) || EXTENSIONES.has(extname(a.nombre).toLowerCase()))
    .sort((a, b) => b.mtime - a.mtime)
}

/** Lee un archivo y devuelve `{ marcajes, columnas, huboEncabezado, origen }`. */
export function leerArchivo(ruta) {
  if (!existsSync(ruta)) return { marcajes: [], columnas: null, huboEncabezado: false, origen: ruta }

  const texto = readFileSync(ruta, 'utf8')
  // Los exportadores de Anviz suelen poner BOM UTF-8.
  const lineas = texto
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)

  if (!lineas.length) return { marcajes: [], columnas: null, huboEncabezado: false, origen: ruta }

  const sep = detectarSeparador(lineas)
  const filas = lineas.map((l) => partirLinea(l, sep))

  // El encabezado se reconoce solo si ninguna celda parece una fecha.
  const celdas0 = filas[0]
  const pareceFecha = celdas0.some((c) => parsearFecha(c) !== null && /\d{1,4}[-/.]/.test(c))
  const mapa = pareceFecha ? null : mapearEncabezado(celdas0)
  const cuerpo = mapa ? filas.slice(1) : filas
  const cols = mapa ?? { dni: 0, fecha: 1, tipo: 2 }

  const marcajes = []
  for (const fila of cuerpo) {
    const dni = String(fila[cols.dni] ?? '').trim()
    const fecha = parsearFecha(fila[cols.fecha])
    if (!dni || !fecha || Number.isNaN(fecha.getTime())) continue
    marcajes.push({ dni, fecha: fecha.toISOString(), tipo: parsearTipo(fila[cols.tipo]) })
  }

  return { marcajes, columnas: cols, huboEncabezado: Boolean(mapa), origen: ruta }
}

/**
 * Todos los marcajes de `data/`, sin duplicar entre archivos. Si se pasa un
 * archivo puntual, se lee solo ese.
 */
export function leerMarcajesDeArchivos(carpeta = CARPETA_DATOS, rutasPuntuales = []) {
  const rutas = rutasPuntuales.length ? rutasPuntuales : archivosDeMarcajes(carpeta).map((a) => a.ruta)
  const vistos = new Set()
  const marcajes = []
  const detalle = []

  for (const ruta of rutas) {
    const leido = leerArchivo(ruta)
    detalle.push({
      archivo: ruta.split(/[\\/]/).pop(),
      leidos: leido.marcajes.length,
      encabezado: leido.huboEncabezado,
      columnas: leido.columnas
    })
    for (const m of leido.marcajes) {
      const clave = `${m.dni}|${m.fecha}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      marcajes.push(m)
    }
  }

  return { marcajes, detalle }
}
