// =============================================================================
// Driver del lector biométrico Anviz D100 (conexión USB).
// =============================================================================
// IMPORTANTE (punto de integración con el dispositivo real):
//
//   El D100 se comunica por USB con el PROTOCOLO PROPIETARIO de Anviz (BioSDK /
//   AnvizNet, DLL nativa de Windows). Esta app NO puede abrir el dispositivo
//   usando Node puro: hace falta el SDK de Anviz. Opciones reales:
//
//     a) Anviz BioSDK / GSDK (Windows, DLL): consumir las funciones del SDK
//        desde Node con bindings nativos (p. ej. `koffi` o `ffi-napi`).
//        El SDK expone eventos de fichaje (IN/OUT) con DNI/ID del trabajador
//        y timestamp, además del estado y serial del lector.
//     b) Sin SDK: exportar el reporte de marcajes con el software de PC de
//        Anviz (Anviz F2 / Anviz Time) a un CSV con el formato
//        `dni;fecha;tipo` y guardarlo en `data/marcajes.csv`. La app lo lee.
//
//   Esta versión viene en MODO DEMO (mock): sirve marcajes de ejemplo para
//   probar de punta a punta la web (puente -> Supabase -> listado en EvaLuxor).
//   Cuando integres el SDK real, completá `leerDispositivoReal` y
//   `leerMarcajesReal` y desactivá el mock en server.js.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CSV_POR_DEFECTO = join(__dirname, '..', 'data', 'marcajes.csv')

export const MODELO = 'D100'
export const MARCA = 'Anviz'

// --- Utilidades ---------------------------------------------------------------

function normalizarFecha(fecha) {
  const f = new Date(fecha)
  if (Number.isNaN(f.getTime())) return null
  return f
}

function enRango(fecha, desde, hasta) {
  const f = normalizarFecha(fecha)
  if (!f) return false
  const d = normalizarFecha(desde)
  const h = normalizarFecha(hasta)
  if (d && f < d) return false
  if (h && f > h) return false
  return true
}

// --- Lectura por CSV (plan B sin SDK) -----------------------------------------

function leerCsvMarcajes(ruta = CSV_POR_DEFECTO) {
  if (!existsSync(ruta)) return []
  const texto = readFileSync(ruta, 'utf8')
  return texto
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1) // salta el encabezado
    .map((linea) => linea.split(';').map((c) => c.trim()))
    .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
    .map(([dni, fecha, tipo]) => ({ dni, fecha, tipo: (tipo || 'OTRO').toUpperCase() }))
}

// --- Modo demo: genera fichajes de los últimos 4 días -------------------------

function generarDemo() {
  const hoy = new Date()
  const personas = [
    { dni: '1712345678' },
    { dni: '1712345679' },
    { dni: '1712345680' }
  ]
  const jornada = [
    [8, 5, 'ENTRADA'],
    [12, 30, 'SALIDA'],
    [13, 0, 'ENTRADA'],
    [17, 45, 'SALIDA']
  ]
  const resultado = []
  for (let i = 1; i <= 4; i++) {
    for (const p of personas) {
      const dia = new Date(hoy)
      dia.setDate(dia.getDate() - i)
      for (const [hh, mm, tipo] of jornada) {
        const f = new Date(dia)
        f.setHours(hh, mm, 0, 0)
        resultado.push({ dni: p.dni, fecha: f.toISOString(), tipo })
      }
    }
  }
  return resultado
}

// --- Lectura real del dispositivo (por implementar con el SDK de Anviz) -------

async function leerDispositivoReal() {
  // TODO: integrar el BioSDK de Anviz. Devolver algo como:
  //   { conectado: true, modelo: 'D100', serial: '...', mensaje: null }
  // Si el lector no está enchufado, tirar un error con un mensaje claro.
  throw new Error(
    'SDK de Anviz no configurado. Completá leerDispositivoReal() en biometrico-bridge/lib/anviz-d100.js ' +
      'o usá el modo demo con data/marcajes.csv.'
  )
}

async function leerMarcajesReal(desde, hasta) {
  // TODO: leer los registros (marcajes) del D100 dentro del rango de fechas.
  // El BioSDK expone eventos IN/OUT con DNI/ID del trabajador y timestamp.
  // Devolver un arreglo de { dni, fecha (ISO), tipo: 'ENTRADA'|'SALIDA'|'OTRO' }.
  void desde
  void hasta
  throw new Error(
    'SDK de Anviz no configurado. Completá leerMarcajesReal() en biometrico-bridge/lib/anviz-d100.js ' +
      'o usá el modo demo con data/marcajes.csv.'
  )
}

// --- API pública del driver ----------------------------------------------------

export async function leerDispositivo(opts) {
  if (opts.mock) {
    return {
      conectado: true,
      modelo: MODELO,
      marca: MARCA,
      serial: 'D100-MOCK-0001',
      mensaje: 'Modo demo (mock). Integrá el SDK de Anviz (leerDispositivoReal) para leer el dispositivo físico.'
    }
  }
  return leerDispositivoReal()
}

export async function leerMarcajes(desde, hasta, opts) {
  const brutos = opts.mock ? [...leerCsvMarcajes(), ...generarDemo()] : await leerMarcajesReal(desde, hasta)
  return brutos.filter((m) => enRango(m.fecha, desde, hasta))
}