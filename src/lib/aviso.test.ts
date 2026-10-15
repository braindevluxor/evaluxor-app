import { describe, expect, it, vi } from 'vitest'
import { avisar, suscribirAvisos, type Aviso } from './aviso'

describe('avisar · el canal de los carteles flotantes', () => {
  it('entrega texto, tono y una clave distinta en cada aviso', () => {
    const visto: Aviso[] = []
    const baja = suscribirAvisos((a) => visto.push(a))

    avisar('ID 100006130 copiado')
    avisar('No se pudo copiar el ID', 'error')
    baja()

    expect(visto.map((a) => a.texto)).toEqual(['ID 100006130 copiado', 'No se pudo copiar el ID'])
    // El tono por defecto es el de éxito: avisar(texto) no debería pedirlo.
    expect(visto.map((a) => a.tono)).toEqual(['ok', 'error'])
    // Sin clave distinta el host no podría reiniciar el reloj ni remontar el
    // cartel: el segundo aviso se vería con la animación y el tiempo del primero.
    expect(visto[1].clave).not.toBe(visto[0].clave)
  })

  it('al darse de baja deja de recibir', () => {
    const oyente = vi.fn()
    const baja = suscribirAvisos(oyente)
    avisar('antes')
    baja()
    avisar('después')

    expect(oyente).toHaveBeenCalledTimes(1)
    expect(oyente.mock.calls[0][0].texto).toBe('antes')
  })

  it('si no hay nadie escuchando no revienta: avisar nunca es un error', () => {
    expect(() => avisar('huérfano')).not.toThrow()
  })

  it('un oyente que se da de baja a sí mismo no tumbar la vuelta', () => {
    const visto: string[] = []
    // Referencia cruzada: el oyente necesita su propia baja antes de que exista.
    const bajaPropia: { fn?: () => void } = {}
    bajaPropia.fn = suscribirAvisos((a) => {
      visto.push(a.texto)
      bajaPropia.fn?.()
    })
    const segundo = vi.fn()
    const bajaSegundo = suscribirAvisos(segundo)

    avisar('uno')

    expect(visto).toEqual(['uno'])
    // El segundo sigue recibiendo aunque el primero se haya borrado a mitad de
    // la vuelta: por eso se itera sobre una copia del `Set`.
    expect(segundo).toHaveBeenCalledTimes(1)

    bajaSegundo()
  })
})
