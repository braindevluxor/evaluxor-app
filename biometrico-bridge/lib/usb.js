// =============================================================================
// Detección del lector biométrico por USB en Windows.
// =============================================================================
// El puente no inventa el estado del equipo: lo lee del administrador de
// dispositivos. Cuando el D100 está enchufado y el sistema lo reconoce, acá
// aparece; cuando no, `conectado` es false con el motivo.
//
// Importante: que el equipo esté enchufado NO significa que por USB se puedan
// leer los marcajes. Según el modelo y el modo en que se lo enchufe, Windows lo
// ve como CD-ROM virtual, como puerto serie, como teclado (HID) o como placa de
// red. Este módulo clasifica en cuál de esos casos estamos y lo dice, en vez de
// prometer marcajes que todavía no se pueden leer.
//
// Los marcajes del D100 salen por el software de PC de Anviz (o por el SDK de
// Anviz), que es lo que se instala y usa para bajar el reporte. Ver README.md.
// =============================================================================

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ejecutar = promisify(execFile)

const FIRMA_POR_DEFECTO = 'data/dispositivo.json'

/**
 * Firmas de los lectores que sabemos reconocer. Las tres primeras se leyeron de
 * una D100 conectada a esta máquina; las demás son familia Anviz conocida.
 * Se pueden ampliar sin tocar código con `data/dispositivo.json`.
 */
export const FIRMAS_POR_DEFECTO = [
  { id: 'anviz-d100-usbstor', vendor: 'FINGER', modelo: 'D100 (módulo de huellas)', transporte: 'cdrom-virtual' },
  { id: 'anviz-compuesto', vid: 'C0F4', pid: '10F5', modelo: 'Anviz (dispositivo compuesto)', transporte: 'usb-compuesto' }
]

/** Cómo se traduce la clase del dispositivo a un transporte legible. */
function transporteDe(entrada) {
  const id = entrada.DeviceID ?? ''
  if (/^USBSTOR\\/i.test(id)) return 'cdrom-virtual'
  if (entrada.PNPClass === 'Ports') return 'puerto-serie'
  if (entrada.PNPClass === 'Net') return 'red'
  if (entrada.PNPClass === 'HIDClass') return 'teclado-hid'
  if (entrada.Service === 'usbccgp') return 'usb-compuesto'
  return 'usb'
}

/** Descripción de qué se puede hacer con cada transporte, para no prometer más. */
export const TRANSPORTES = {
  'cdrom-virtual': {
    etiqueta: 'CD-ROM virtual',
    sirve: false,
    explicacion:
      'El equipo aparece como un CD-ROM virtual (lo típico: el instalador del software de Anviz). No es un canal de datos, así que por USB no se leen marcajes.'
  },
  'puerto-serie': {
    etiqueta: 'Puerto serie',
    sirve: true,
    explicacion: 'Es un puerto serie: se puede leer el protocolo del equipo directamente desde el puente.'
  },
  red: {
    etiqueta: 'Placa de red',
    sirve: true,
    explicacion: 'El equipo tiene su propia IP en la red: se le puede consultar por HTTP sin USB.'
  },
  'teclado-hid': {
    etiqueta: 'Teclado (HID)',
    sirve: false,
    explicacion: 'El equipo emula un teclado: se le puede escribir, no leer. No sirve para bajar marcajes.'
  },
  'usb-compuesto': {
    etiqueta: 'USB compuesto',
    sirve: false,
    explicacion: 'Agrupa varias funciones del equipo, pero no expone los marcajes por USB.'
  },
  usb: {
    etiqueta: 'USB',
    sirve: false,
    explicacion: 'Conectado por USB, sin un canal de datos reconocible para los marcajes.'
  }
}

function firmas() {
  const ruta = join(__dirname, '..', FIRMA_POR_DEFECTO)
  if (!existsSync(ruta)) return FIRMAS_POR_DEFECTO
  try {
    const propias = JSON.parse(readFileSync(ruta, 'utf8'))
    return Array.isArray(propias) && propias.length ? propias : FIRMAS_POR_DEFECTO
  } catch {
    return FIRMAS_POR_DEFECTO
  }
}

function coincide(entrada, firma) {
  const id = (entrada.DeviceID ?? '').toUpperCase()
  const nombre = (entrada.Name ?? '').toUpperCase()
  if (firma.vendor && !id.includes(`VEN_${firma.vendor.toUpperCase()}`) && !nombre.includes(firma.vendor.toUpperCase())) {
    return false
  }
  if (firma.vid && !id.includes(`VID_${firma.vid.toUpperCase()}`)) return false
  if (firma.pid && !id.includes(`PID_${firma.pid.toUpperCase()}`)) return false
  return Boolean(firma.vendor || firma.vid || firma.pid)
}

/** Lista los dispositivos USB que Windows ve, ya filtrados a los lectores. */
async function dispositivosUsb() {
  const script =
    "Get-CimInstance Win32_PnPEntity | " +
    "Where-Object { $_.PNPDeviceID -like 'USB*' } | " +
    'Select-Object Name,DeviceID,PNPClass,Service,Status | ConvertTo-Json -Compress -Depth 3'

  const { stdout } = await ejecutar(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 20000 }
  )

  const datos = JSON.parse(stdout.trim() || '[]')
  return (Array.isArray(datos) ? datos : [datos]).filter(Boolean)
}

const SIN_WINDOWS = {
  conectado: false,
  disponible: false,
  mensaje:
    'La detección por USB solo funciona en Windows. En este sistema, usá el software de Anviz para exportar los marcajes a `data/marcajes.csv`.'
}

/**
 * Estado real del lector.
 *
 * Devuelve `conectado` solo si el equipo está presente, y además `sirve` para
 * decir si por ese transporte se pueden leer marcajes o hay que usar el
 * software de Anviz.
 */
export async function detectarLector() {
  if (process.platform !== 'win32') return { ...SIN_WINDOWS, disponible: false }

  let usb
  try {
    usb = await dispositivosUsb()
  } catch (e) {
    return {
      conectado: false,
      disponible: false,
      mensaje: `No se pudo consultar el administrador de dispositivos: ${e instanceof Error ? e.message : 'error desconocido'}`
    }
  }

  const lista = firmas()
  // Un equipo puede exponer varias interfaces (el módulo de huellas, un HID, un
  // compuesto). Armamos la lista en el ORDEN de las firmas para que la más
  // específica (el lector D100) quede primera, no la que venga de Windows.
  const encontrados = lista
    .map((f) => {
      const d = usb.find((x) => coincide(x, f))
      if (!d) return null
      const t = f.transporte ?? transporteDe(d)
      return {
        id: f.id ?? 'desconocido',
        nombre: d.Name ?? 'Lector biométrico',
        modelo: f.modelo ?? null,
        transporte: t,
        transporteEtiqueta: TRANSPORTES[t]?.etiqueta ?? t,
        sirve: TRANSPORTES[t]?.sirve === true,
        estado: d.Status ?? 'desconocido',
        deviceId: d.DeviceID ?? null
      }
    })
    .filter(Boolean)

  if (!encontrados.length) {
    return {
      conectado: false,
      disponible: true,
      mensaje:
        'No se detectó ningún lector biométrico por USB. Revisá el cable (usá el puerto que alimente el equipo) y que la pantalla del lector esté encendida.'
    }
  }

  const principal = encontrados.find((e) => e.sirve) ?? encontrados[0]
  const info = TRANSPORTES[principal.transporte]

  return {
    conectado: true,
    disponible: true,
    modelo: principal.modelo ?? principal.nombre,
    nombre: principal.nombre,
    serial: principal.deviceId,
    transporte: principal.transporte,
    transporteEtiqueta: principal.transporteEtiqueta,
    sirve: principal.sirve,
    mensaje: principal.sirve
      ? `${info.explicacion}`
      : `${info.explicacion} Para bajar los marcajes usá el software de PC de Anviz y exportá el reporte a data/marcajes.csv.`,
    hallazgos: encontrados
  }
}
