import { describe, expect, it } from 'vitest'
import {
  clavePublicaABytes,
  estadoPermiso,
  filaDeSuscripcion,
  opcionesDeSuscripcion,
  soportaPush
} from './push'

/**
 * Lo puro de la suscripción push: decodificación de la clave, mapeo a la fila
 * de la base y detección de soporte.
 *
 * Las funciones que tocan red o PushManager (`suscribirse`, `silenciar`) no
 * se prueban acá: necesitarían un navegador de verdad. Éstas son las que
 * tienen lógica, y son las que se rompen sin que nadie se entere — sobre
 * todo `filaDeSuscripcion`, porque una fila mal mapeada no tira error: el
 * servidor la guarda y después falla al mandar, en el momento en que ya no
 * está nadie mirando.
 */

describe('clavePublicaABytes', () => {
  it('decodifica base64url a los bytes originales', () => {
    // "hola" en base64url es "aG9sYQ" (sin el padding '=' que a veces trae).
    const bytes = clavePublicaABytes('aG9sYQ')
    expect(Array.from(bytes)).toEqual([104, 111, 108, 97])
    expect(new TextDecoder().decode(bytes)).toBe('hola')
  })

  it('acepta el guion y el guion bajo del base64url', () => {
    // Base64url reemplaza '+' por '-' y '/' por '_' — es lo que usa el
    // push service. Un decodificador de base64 común fallaría con estos.
    const conGuiones = clavePublicaABytes('a-_b')
    expect(conGuiones).toBeInstanceOf(Uint8Array)
    expect(conGuiones.length).toBe(3)
  })

  it('no revienta con una clave vacía', () => {
    expect(clavePublicaABytes('')).toHaveLength(0)
  })
})

describe('soportaPush / estadoPermiso', () => {
  it('en node no hay push: devuelve false y null, no una excepción', () => {
    // Este test corre en node (sin jsdom), que es justo el caso de un
    // navegador viejo o un entorno sin API de notificaciones.
    expect(soportaPush()).toBe(false)
    expect(estadoPermiso()).toBeNull()
  })
})

describe('opcionesDeSuscripcion', () => {
  it('pide notificaciones visibles y la clave pública como bytes', () => {
    // `userVisibleOnly: true` es la promesa de que no hay notificaciones
    // silenciosas. Sin ella, el push service rechaza la suscripción en
    // Chrome moderno.
    const op = opcionesDeSuscripcion('aG9sYQ')
    expect(op.userVisibleOnly).toBe(true)
    expect(op.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(Array.from(op.applicationServerKey as Uint8Array)).toEqual([104, 111, 108, 97])
  })
})

describe('filaDeSuscripcion', () => {
  const sub = (json: unknown) => ({ toJSON: () => json })

  it('mapea la suscripción a las columnas de la tabla', () => {
    const fila = filaDeSuscripcion(
      sub({ endpoint: 'https://fcm/abc', keys: { p256dh: 'k1', auth: 'k2' } }),
      'usuario-1'
    )
    expect(fila).toEqual({
      user_id: 'usuario-1',
      endpoint: 'https://fcm/abc',
      p256dh: 'k1',
      auth: 'k2',
      activa: true,
      updated_at: expect.any(String)
    })
  })

  it('una fila sin endpoint no se guarda', () => {
    // Una suscripción sin endpoint no tiene a dónde mandar: guardarla sería
    // dejar una fila que el servidor rechazaría después, en silencio.
    expect(filaDeSuscripcion(sub({ keys: { p256dh: 'k1', auth: 'k2' } }), 'u')).toBeNull()
  })

  it('una fila sin claves de cifrado no se guarda', () => {
    // Sin `p256dh`/`auth` el payload no se puede cifrar para ese destino.
    expect(filaDeSuscripcion(sub({ endpoint: 'https://fcm/abc' }), 'u')).toBeNull()
    expect(
      filaDeSuscripcion(sub({ endpoint: 'https://fcm/abc', keys: { p256dh: 'k1' } }), 'u')
    ).toBeNull()
  })

  it('una suscripción malformada no revienta: devuelve null', () => {
    expect(filaDeSuscripcion(sub(null), 'u')).toBeNull()
    expect(filaDeSuscripcion(sub(undefined), 'u')).toBeNull()
    expect(filaDeSuscripcion(sub('texto'), 'u')).toBeNull()
    expect(filaDeSuscripcion(sub({ endpoint: 123, keys: 'x' }), 'u')).toBeNull()
  })

  it('siempre nace activa y con el `updated_at` de ahora', () => {
    // `activa` en true es lo que hace que el endpoint la incluya al mandar;
    // `updated_at` es lo que permite podar las que llevan meses sin
    // refrescarse.
    const fila = filaDeSuscripcion(
      sub({ endpoint: 'e', keys: { p256dh: 'a', auth: 'b' } }),
      'u'
    )
    expect(fila?.activa).toBe(true)
    expect(Date.parse(fila!.updated_at)).toBeGreaterThan(0)
  })
})
