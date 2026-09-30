import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsearFecha, parsearTipo, partirLinea, detectarSeparador, mapearEncabezado, leerArchivo } from '../../biometrico-bridge/lib/archivos.js'
import { detectarLector } from '../../biometrico-bridge/lib/usb.js'

function puente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('biometrico · fechas del reporte', () => {
  it('entiende los formatos que usan las exportaciones', () => {
    // ISO
    expect(parsearFecha('2026-09-30T08:05:00Z')?.toISOString()).toBe('2026-09-30T08:05:00.000Z')
    // Un ISO con zona no se corre a hora local (si no, el marcaje se atrasa horas).
    expect(parsearFecha('2026-09-30T08:05:00-04:00')?.toISOString()).toBe('2026-09-30T12:05:00.000Z')
    // YYYY-MM-DD HH:mm:ss
    expect(parsearFecha('2026-09-30 08:05:00')).toBeInstanceOf(Date)
    // DD/MM/AAAA (formato de Anviz)
    const ddmma = parsearFecha('30/09/2026 08:05')
    expect(ddmma?.getDate()).toBe(30)
    expect(ddmma?.getMonth()).toBe(8) // septiembre
    expect(ddmma?.getHours()).toBe(8)
    // MM/DD cuando el primero no puede ser día (mes > 12)
    const mmdd = parsearFecha('09/30/2026 08:05')
    expect(mmdd?.getMonth()).toBe(8)
    expect(mmdd?.getDate()).toBe(30)
    // Epoch
    expect(parsearFecha('1717171717')).toBeInstanceOf(Date)
    // Basura: null, para descartar el registro y no guardar fecha inventada
    expect(parsearFecha('no es fecha')).toBeNull()
    expect(parsearFecha('')).toBeNull()
    expect(parsearFecha(null)).toBeNull()
  })
})

describe('biometrico · tipo del marcaje', () => {
  it('reconoce entrada/salida en español e inglés', () => {
    expect(parsearTipo('ENTRADA')).toBe('ENTRADA')
    expect(parsearTipo('entrada')).toBe('ENTRADA')
    expect(parsearTipo('Check In')).toBe('ENTRADA')
    expect(parsearTipo('IN')).toBe('ENTRADA')
    expect(parsearTipo('SALIDA')).toBe('SALIDA')
    expect(parsearTipo('Check Out')).toBe('SALIDA')
    expect(parsearTipo('out')).toBe('SALIDA')
    // Lo que no reconoce queda OTRO (la web lo clasifica por jornada)
    expect(parsearTipo('algo raro')).toBe('OTRO')
    expect(parsearTipo(null)).toBe('OTRO')
  })
})

describe('biometrico · separador y encabezados', () => {
  it('parte CSV con comillas y separador variable', () => {
    expect(partirLinea('a;b;c', ';')).toEqual(['a', 'b', 'c'])
    expect(partirLinea('"García, Juan";123', ';')).toEqual(['García, Juan', '123'])
  })

  it('detecta el separador de la exportación', () => {
    expect(detectarSeparador(['dni;fecha;tipo', '1;2;3'])).toBe(';')
    expect(detectarSeparador(['dni,fecha,tipo', '1,2,3'])).toBe(',')
    expect(detectarSeparador(['dni\tfecha\ttipo', '1\t2\t3'])).toBe('\t')
  })

  it('mapea encabezados en español o inglés sin importar el orden', () => {
    expect(mapearEncabezado(['Usuario', 'Fecha/hora', 'Tipo'])).toEqual({ dni: 0, fecha: 1, tipo: 2 })
    expect(mapearEncabezado(['Check Time', 'User ID', 'In/Out'])).toEqual({ dni: 1, fecha: 0, tipo: 2 })
    // Sin columna de fecha no es un reporte de marcajes
    expect(mapearEncabezado(['algo', 'cualquiera'])).toBeNull()
  })
})

describe('biometrico · leer un archivo exportado', () => {
  it('descarta filas sin fecha o sin DNI en vez de inventar datos', () => {
    const ruta = fileURLToPath(new URL('../../biometrico-bridge/data/marcajes.csv', import.meta.url))
    const leido = leerArchivo(ruta)
    // El CSV de ejemplo trae filas válidas; ninguna puede quedar con fecha NaN.
    for (const m of leido.marcajes) {
      expect(Number.isNaN(new Date(m.fecha).getTime())).toBe(false)
      expect(m.dni).toBeTruthy()
    }
  })
})

describe('biometrico · detección USB real (no mock)', () => {
  it('informa el transporte y si por ahí se leen marcajes', async () => {
    // No mockea nada: consulta el sistema. Solo comprobamos la forma del dato y
    // que nunca prometa que el USB sirve cuando no sirve.
    const info = await detectarLector()
    expect(typeof info.conectado).toBe('boolean')
    expect(typeof info.disponible).toBe('boolean')
    if (info.conectado) {
      expect(info.sirve).toBe(false) // el D100 por USB es CD-ROM virtual
      expect(info.transporte).toBe('cdrom-virtual')
      expect(info.mensaje).toMatch(/no se leen marcajes|no es un canal/i)
    } else {
      expect(info.mensaje).toBeTruthy()
    }
  })
})

describe('biometrico · el puente no miente sobre el equipo', () => {
  it('el servidor consulta el lector real por defecto (no arranca en mock)', () => {
    const server = puente('../../biometrico-bridge/server.js')
    expect(server).toContain('const ES_DEMO = MODO === \'demo\'')
    // El modo real es el predeterminado; demo solo si se pide explícitamente.
    expect(server).toContain("process.env.MODO === 'demo' ? 'demo' : 'real'")
    // Y expone el origen de los marcajes para que la web lo muestre.
    expect(server).toContain('/origen')
  })

  it('el modo demo genera marcajes de ejemplo, no los del archivo', async () => {
    // El server manda `modo: 'demo'`; si el driver mirara otro valor, la demo
    // devolvería en silencio los marcajes del CSV y parecería sincronizada.
    const { leerMarcajes } = await import('../../biometrico-bridge/lib/anviz-d100.js')
    const demo = await leerMarcajes(undefined, undefined, { modo: 'demo' })
    const real = await leerMarcajes(undefined, undefined, { modo: 'real' })
    expect(demo.length).toBeGreaterThan(0)
    // El CSV de ejemplo tiene 9 filas; la demo son 4 días x 3 personas x 4.
    expect(demo.length).not.toBe(real.length)
  })

  it('el driver distingue "enchufado" de "por donde salen los marcajes"', () => {
    const driver = puente('../../biometrico-bridge/lib/anviz-d100.js')
    // `sirve` en false cuando el transporte no es un canal de datos.
    expect(driver).toContain('sirve: deteccion.sirve')
  })
})
