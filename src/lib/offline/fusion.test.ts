import { describe, expect, it } from 'vitest'
import { fusionarConciliacion, fusionarRespuestasNube, type RespuestaNube } from './fusion'
import type { DraftEval } from './db'

const MI_ID = 'user-1'
const OTRO_ID = 'user-2'
const COMPARTIDOS = new Set(['it-conc', 'it-check'])

function nube(fila: Partial<RespuestaNube> & { item_id: string }): RespuestaNube {
  return { instancia_id: null, valor: null, respondido_por: OTRO_ID, ...fila }
}

function correr(params: {
  local: DraftEval['respuestas']
  nube?: RespuestaNube[]
  subido?: boolean
  compartidos?: Set<string>
}) {
  return fusionarRespuestasNube({
    local: params.local,
    nube: params.nube ?? [],
    miId: MI_ID,
    compartidos: params.compartidos ?? COMPARTIDOS,
    subido: params.subido ?? false
  })
}

describe('fusionarRespuestasNube', () => {
  it("suma como 'otros' la respuesta del otro que no tengo", () => {
    const { respuestas, cambio } = correr({
      local: {},
      nube: [nube({ item_id: 'it-conc', valor: { productos: [{ sku: 'A', teorica: 2, fisica: 1 }] } })]
    })

    expect(cambio).toBe(true)
    expect(respuestas['it-conc::']).toEqual({
      valor: { productos: [{ sku: 'A', teorica: 2, fisica: 1 }] },
      por: 'otros'
    })
  })

  it('no mete los ítems que no son compartidos', () => {
    const { respuestas, cambio } = correr({
      local: {},
      nube: [nube({ item_id: 'it-privado', valor: { value: true } })]
    })

    expect(cambio).toBe(false)
    expect(respuestas).toEqual({})
  })

  it('no trae filas que ya son mías y no tengo copia local', () => {
    const { respuestas, cambio } = correr({
      local: {},
      nube: [nube({ item_id: 'it-check', respondido_por: MI_ID, valor: { value: true } })]
    })

    expect(cambio).toBe(false)
    expect(respuestas).toEqual({})
  })

  it('refresca un valor del otro que cambió en la nube', () => {
    const local: DraftEval['respuestas'] = {
      'it-check::': { valor: { value: true }, por: 'otros' }
    }
    const { respuestas, cambio } = correr({
      local,
      nube: [nube({ item_id: 'it-check', valor: { value: false } })]
    })

    expect(cambio).toBe(true)
    expect(respuestas['it-check::']).toEqual({ valor: { value: false }, por: 'otros' })
  })

  it('si la nube no cambió, no hay nada que re-pintar', () => {
    const local: DraftEval['respuestas'] = {
      'it-check::': { valor: { value: true }, por: 'otros' }
    }
    const { respuestas, cambio } = correr({
      local,
      nube: [nube({ item_id: 'it-check', valor: { value: true } })]
    })

    expect(cambio).toBe(false)
    expect(respuestas['it-check::']).toBe(local['it-check::'])
  })

  it('mi respuesta de otro tipo nunca se pisa con la del otro', () => {
    const local: DraftEval['respuestas'] = {
      'it-check::': { valor: { value: true }, por: 'yo' }
    }
    const { respuestas, cambio } = correr({
      local,
      subido: true,
      nube: [nube({ item_id: 'it-check', valor: { value: false } })]
    })

    expect(cambio).toBe(false)
    expect(respuestas['it-check::']).toEqual({ valor: { value: true }, por: 'yo' })
  })

  it('conciliación sin subir: lo local manda y solo se suman los SKU nuevos del otro', () => {
    const local: DraftEval['respuestas'] = {
      'it-conc::': {
        valor: { productos: [{ sku: 'A', teorica: 2, fisica: 3, nombre: 'Pan' }] },
        por: 'yo'
      }
    }
    const { respuestas, cambio } = correr({
      local,
      subido: false,
      nube: [nube({
        item_id: 'it-conc',
        valor: { productos: [{ sku: 'A', teorica: 2, fisica: 9, nombre: 'Pan viejo' }, { sku: 'B', teorica: 1, fisica: 1 }] }
      })]
    })

    expect(cambio).toBe(true)
    const productos = (respuestas['it-conc::'].valor as { productos: { sku: string; fisica: number; nombre: string }[] }).productos
    // Mi conteo sin subir no se toca...
    expect(productos.find((p) => p.sku === 'A')).toMatchObject({ fisica: 3, nombre: 'Pan' })
    // ...y el producto que escaneó el otro aparece en mi lista.
    expect(productos.map((p) => p.sku)).toEqual(['A', 'B'])
  })

  it('conciliación ya subida: manda la nube (mi subida fusionada con la del otro) sin perder mis SKU', () => {
    const local: DraftEval['respuestas'] = {
      'it-conc::': {
        valor: { productos: [{ sku: 'A', teorica: 2, fisica: 3 }, { sku: 'C', teorica: 5, fisica: 5 }] },
        por: 'yo'
      }
    }
    const { respuestas } = correr({
      local,
      subido: true,
      nube: [nube({
        item_id: 'it-conc',
        valor: { productos: [{ sku: 'A', teorica: 2, fisica: 7 }, { sku: 'B', teorica: 1, fisica: 2 }] }
      })]
    })

    const productos = (respuestas['it-conc::'].valor as { productos: { sku: string; fisica: number }[] }).productos
    expect(productos.map((p) => p.sku)).toEqual(['A', 'B', 'C'])
    expect(productos.find((p) => p.sku === 'A')?.fisica).toBe(7)
    // El SKU que la nube no conoce (push rechazado o cambio sin subir) se queda.
    expect(productos.find((p) => p.sku === 'C')).toMatchObject({ sku: 'C', fisica: 5 })
  })

  it('al fusionar se conservan fotos, el ID de la API y quién escaneó el producto', () => {
    const local: DraftEval['respuestas'] = {
      'it-conc::': {
        valor: {
          productos: [{ sku: 'A', photoIds: ['local-1'], apiId: 100006130, escaneadoPor: 'María' }],
          paths: ['ev/e/i/vieja.jpg']
        },
        por: 'yo'
      }
    }
    const { respuestas } = correr({
      local,
      subido: false,
      nube: [nube({
        item_id: 'it-conc',
        valor: { productos: [{ sku: 'A', paths: ['ev/e/i/nueva.jpg'], escaneadoPor: null }], paths: ['ev/e/i/foto.jpg'] }
      })]
    })

    const valor = respuestas['it-conc::'].valor as { productos: Record<string, unknown>[]; paths: string[] }
    expect(valor.productos[0]).toMatchObject({ apiId: 100006130, escaneadoPor: 'María' })
    expect(valor.productos[0].photoIds).toEqual(['local-1'])
    expect(valor.productos[0].paths).toEqual(['ev/e/i/nueva.jpg'])
    expect(valor.paths.sort()).toEqual(['ev/e/i/foto.jpg', 'ev/e/i/vieja.jpg'])
  })

  it('una segunda pasada sobre lo ya fusionado no vuelve a reportar cambio', () => {
    const primera = correr({
      local: { 'it-conc::': { valor: { productos: [{ sku: 'A', fisica: 1 }] }, por: 'yo' } },
      subido: false,
      nube: [nube({ item_id: 'it-conc', valor: { productos: [{ sku: 'B', fisica: 2 }] } })]
    })
    expect(primera.cambio).toBe(true)

    const segunda = correr({
      local: primera.respuestas,
      subido: false,
      nube: [nube({ item_id: 'it-conc', valor: { productos: [{ sku: 'B', fisica: 2 }] } })]
    })
    expect(segunda.cambio).toBe(false)
    expect(segunda.respuestas).toEqual(primera.respuestas)
  })
})

describe('fusionarConciliacion', () => {
  it('une dos listas de productos por SKU sin repetir', () => {
    const mezcla = fusionarConciliacion(
      { productos: [{ sku: 'A', fisica: 1 }] },
      { productos: [{ sku: 'B', fisica: 2 }] },
      false
    )
    expect((mezcla as { productos: { sku: string }[] }).productos.map((p) => p.sku)).toEqual(['A', 'B'])
  })

  it('un valor que no es conciliación no se rompe', () => {
    expect(fusionarConciliacion({ value: true }, null, true)).toEqual({ value: true })
  })
})
