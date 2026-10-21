import { describe, it, expect } from 'vitest'
import { photoPath, convertirValor, extraerPhotoIds, idsFotosRespuesta, valorSinFotos } from './transform'

describe('photoPath', () => {
  it('construye ruta estable', () => {
    expect(photoPath('abc', 'item1', 'foto1')).toBe('ev/abc/item1/foto1.jpg')
  })
})

describe('extraerPhotoIds', () => {
  it('acepta arreglo plano y objeto con photoIds', () => {
    expect(extraerPhotoIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(extraerPhotoIds({ photoIds: ['x'] })).toEqual(['x'])
    expect(extraerPhotoIds('hola')).toEqual([])
    expect(extraerPhotoIds({ photoIds: [1] })).toEqual([])
    expect(extraerPhotoIds(null)).toEqual([])
  })
  it('extrae photoIds anidados de evidencias de cumple/no cumple', () => {
    expect(
      extraerPhotoIds({ value: true, evidencias: [{ photoIds: ['a', 'b'], comentario: 'ok' }, { photoIds: ['c'], comentario: '' }] })
    ).toEqual(['a', 'b', 'c'])
    expect(extraerPhotoIds({ value: false, evidencias: [] })).toEqual([])
    expect(extraerPhotoIds({ value: true })).toEqual([])
  })
  it('extrae evidencia aunque aún no se haya elegido Cumple o No cumple', () => {
    expect(extraerPhotoIds({ value: null, evidencias: [{ photoIds: ['captura-1'] }] })).toEqual(['captura-1'])
    expect(extraerPhotoIds({ evidencias: [{ photoIds: ['captura-2'] }] })).toEqual(['captura-2'])
  })
  it('extrae photoIds de evidencias de checklist', () => {
    expect(
      extraerPhotoIds({ selected: ['a', 'b'], evidencias: { a: { photoIds: ['x'] }, b: { photoIds: ['y', 'z'] } } })
    ).toEqual(['x', 'y', 'z'])
    expect(extraerPhotoIds({ selected: ['a', 'b'], evidencias: {} })).toEqual([])
    expect(extraerPhotoIds({ selected: [] })).toEqual([])
  })
  it('extrae las imágenes de los planos de un ítem Cumplimiento XY', () => {
    const valor = {
      planos: [
        { id: 'p1', nombre: 'Planta baja', photoIds: ['a', 'b'] },
        { id: 'p2', nombre: 'Mezanine', photoIds: [] }
      ],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: '' }]
    }
    expect(extraerPhotoIds(valor)).toEqual(['a', 'b'])
    // Un valor con `planos` pero sin fotos (o vacío) no aporta ids.
    expect(extraerPhotoIds({ planos: [], puntos: [] })).toEqual([])
    expect(extraerPhotoIds({ planos: [{ id: 'p', nombre: 'x' }], puntos: [] })).toEqual([])
  })
})

describe('idsFotosRespuesta', () => {
  it('reconstruye la lista de fotos de un checklist además de conservar ids guardados en cola', () => {
    expect(idsFotosRespuesta([
      {
        valor: {
          selected: [],
          evidencias: {
            limpieza: { photoIds: ['foto-local-1', 'foto-local-2'] },
            otra: { photoIds: ['foto-local-1'] }
          }
        }
      }
    ], ['foto-guardada'])).toEqual(['foto-guardada', 'foto-local-1', 'foto-local-2'])
  })
  it('recoge fotos de respuestas Checklist y Cumple/No cumple dentro de registros de grupo', () => {
    const respuestasDeGrupo = [
      {
        item_id: 'checklist-hijo',
        instancia_id: 'registro-1',
        valor: {
          selected: [],
          evidencias: { limpieza: { photoIds: ['foto-checklist'] } }
        }
      },
      {
        item_id: 'cumple-hijo',
        instancia_id: 'registro-1',
        valor: {
          value: false,
          evidencias: [{ comentario: 'Falla', photoIds: ['foto-cumple'] }]
        }
      },
      {
        item_id: 'otro-registro',
        instancia_id: 'registro-2',
        valor: {
          selected: ['x'],
          evidencias: { x: { photoIds: ['foto-otro-registro'] } }
        }
      }
    ]
    expect(idsFotosRespuesta(respuestasDeGrupo)).toEqual(['foto-checklist', 'foto-cumple', 'foto-otro-registro'])
  })
})

describe('valorSinFotos', () => {
  it('conserva los valores numéricos de opciones RANGO del checklist', () => {
    expect(
      valorSinFotos({ selected: ['a', 'b'], valores: { a: 40 }, evidencias: { a: { photoIds: ['f1'] } }, informativos: ['b'] })
    ).toEqual({ selected: ['a', 'b'], valores: { a: 40 }, informativos: ['b'] })
  })
  it('omite valores vacíos y pasa intactos los demás tipos', () => {
    expect(valorSinFotos({ selected: ['a'], valores: {}, evidencias: {} })).toEqual({ selected: ['a'] })
    expect(valorSinFotos({ value: true, evidencias: [] })).toEqual({ value: true, evidencias: [] })
    expect(valorSinFotos('texto')).toBe('texto')
  })
  it('conserva las marcas del doble check aunque `existe` venga vacío', () => {
    // Soltar un `existe` vacío convertiría la respuesta a modo check simple y
    // las marcas de `selected` empezarían a puntuar sin la presencia.
    expect(valorSinFotos({ selected: ['a'], existe: ['a'] })).toEqual({ selected: ['a'], existe: ['a'] })
    expect(valorSinFotos({ selected: [], existe: ['a'] })).toEqual({ selected: [], existe: ['a'] })
    expect(valorSinFotos({ selected: ['a'], existe: [] })).toEqual({ selected: ['a'], existe: [] })
    expect(valorSinFotos({ selected: ['a'] })).toEqual({ selected: ['a'] })
  })
  it('quita fotos locales de evidencias Cumple / No cumple sin perderlas al sincronizar', () => {
    expect(valorSinFotos({
      value: null,
      evidencias: [{ photoIds: ['captura-1'], comentario: 'Evidencia pendiente' }]
    })).toEqual({
      value: null,
      evidencias: [{ comentario: 'Evidencia pendiente' }]
    })
  })
  it('en un plano conserva planos y pines pero quita las fotos locales', () => {
    // El auto-guardado en nube va sin fotos (se suben al enviar); los pines se conservan.
    expect(
      valorSinFotos({
        planos: [{ id: 'p1', nombre: 'Planta baja', photoIds: ['a'] }],
        puntos: [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
      })
    ).toEqual({
      planos: [{ id: 'p1', nombre: 'Planta baja', photoIds: [] }],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
    })
    expect(valorSinFotos({ planos: [{ id: 'p1', nombre: 'X', photoIds: ['a'] }], puntos: [], informativo: true })).toEqual({
      planos: [{ id: 'p1', nombre: 'X', photoIds: [] }],
      puntos: [],
      informativo: true
    })
  })
  it('no se traga los responsables al recortar el valor', () => {
    // Misma trampa que `convertirValor`: la proyección se arma campo por campo
    // y los responsables no eran un campo que ella recordara.
    expect(
      valorSinFotos({
        value: false,
        evidencias: [{ photoIds: ['f1'], comentario: '' }],
        responsables: ['Ana'],
        responsablesGerente: 'Elena'
      })
    ).toEqual({
      value: false,
      evidencias: [{ comentario: '' }],
      responsables: ['Ana'],
      responsablesGerente: 'Elena'
    })
    expect(
      valorSinFotos({
        selected: ['a'],
        evidencias: {},
        responsables: ['Ana'],
        responsablesPorOpcion: { a: ['Beto'] },
        responsablesGerente: 'Elena'
      })
    ).toEqual({
      selected: ['a'],
      responsables: ['Ana'],
      responsablesPorOpcion: { a: ['Beto'] },
      responsablesGerente: 'Elena'
    })
  })
  it('no se traga los comentarios por punto al recortar el valor', () => {
    // Misma trampa que los responsables: la proyección se arma campo por campo y
    // el comentario del punto no era un campo que ella recordara. Sin esto el
    // comentario se perdía al sincronizar y el punto quedaba mudo en el informe.
    expect(
      valorSinFotos({
        selected: ['a'],
        evidencias: {},
        comentarios: { a: 'falta la góndola' }
      })
    ).toEqual({
      selected: ['a'],
      comentarios: { a: 'falta la góndola' }
    })
    // Un diccionario vacío es ruido: no se guarda.
    expect(valorSinFotos({ selected: ['a'], evidencias: {}, comentarios: {} })).toEqual({ selected: ['a'] })
  })
})

describe('convertirValor', () => {
  it('convierte photoIds a paths', () => {
    const map = new Map([['f1', 'ev/x/y/f1.jpg']])
    expect(convertirValor({ photoIds: ['f1', 'f2'] }, map)).toEqual({
      paths: ['ev/x/y/f1.jpg', '.local/f2']
    })
  })
  it('convierte evidencias de cumple/no cumple a paths', () => {
    const map = new Map([['a', 'ev/x/y/a.jpg']])
    expect(
      convertirValor(
        { value: true, evidencias: [{ photoIds: ['a'], comentario: 'ok' }, { photoIds: ['b'], comentario: 'x' }] },
        map
      )
    ).toEqual({
      value: true,
      evidencias: [
        { comentario: 'ok', paths: ['ev/x/y/a.jpg'] },
        { comentario: 'x', paths: ['.local/b'] }
      ]
    })
  })
  it('convierte las evidencias a paths aunque el veredicto esté pendiente', () => {
    const map = new Map([['captura-1', 'ev/x/y/captura-1.jpg']])
    expect(convertirValor({
      value: null,
      evidencias: [{ photoIds: ['captura-1'], comentario: 'Pendiente' }]
    }, map)).toEqual({
      value: null,
      evidencias: [{ comentario: 'Pendiente', paths: ['ev/x/y/captura-1.jpg'] }]
    })
  })
  it('convierte evidencias de checklist a paths', () => {
    const map = new Map([['x', 'ev/c/d/x.jpg']])
    expect(
      convertirValor(
        { selected: ['a', 'b'], evidencias: { a: { photoIds: ['x'] }, b: { photoIds: ['y'] } } },
        map
      )
    ).toEqual({
      selected: ['a', 'b'],
      evidencias: {
        a: { paths: ['ev/c/d/x.jpg'] },
        b: { paths: ['.local/y'] }
      }
    })
  })
  it('al subir las fotos no pierde las marcas del doble check', () => {
    const map = new Map([['x', 'ev/c/d/x.jpg']])
    expect(
      convertirValor(
        { selected: ['a'], existe: ['a', 'b'], evidencias: { a: { photoIds: ['x'] } } },
        map
      )
    ).toEqual({
      selected: ['a'],
      existe: ['a', 'b'],
      evidencias: { a: { paths: ['ev/c/d/x.jpg'] } }
    })
    // Un `existe` vacío también viaja: sostiene el modo doble check de la respuesta.
    expect(
      convertirValor({ selected: [], existe: [], evidencias: {} }, map)
    ).toEqual({ selected: [], existe: [], evidencias: {} })
  })
  it('convierte las imágenes de los planos y deja los pines intactos', () => {
    const map = new Map([['a', 'ev/job/evidencia/a.jpg']])
    const puntos = [{ id: 'x', planoId: 'p1', x: 0.25, y: 0.75, cumple: false, comentario: 'falta góndola' }]
    expect(
      convertirValor(
        {
          planos: [
            { id: 'p1', nombre: 'Planta baja', photoIds: ['a'] },
            { id: 'p2', nombre: 'Mezanine', photoIds: ['b'] }
          ],
          puntos,
          responsables: ['Caro'],
          responsablesGerente: 'Elena'
        },
        map
      )
    ).toEqual({
      planos: [
        { id: 'p1', nombre: 'Planta baja', paths: ['ev/job/evidencia/a.jpg'] },
        { id: 'p2', nombre: 'Mezanine', paths: ['.local/b'] }
      ],
      puntos,
      responsables: ['Caro'],
      responsablesGerente: 'Elena'
    })
  })
  it('conserva los valores numéricos de opciones RANGO del checklist', () => {
    const map = new Map<string, string>()
    expect(
      convertirValor(
        { selected: ['a', 'b'], valores: { a: 40, b: 25 }, evidencias: { a: { photoIds: ['x'] } } },
        map
      )
    ).toEqual({
      selected: ['a', 'b'],
      valores: { a: 40, b: 25 },
      evidencias: { a: { paths: ['.local/x'] } }
    })
  })
  it('al subir no pierde el comentario de los puntos', () => {
    // La proyección que sube a la nube arma el objeto campo por campo: sin
    // esto el comentario del punto se perdía al sincronizar.
    const map = new Map([['x', 'ev/c/d/x.jpg']])
    expect(
      convertirValor(
        { selected: ['a'], evidencias: { a: { photoIds: ['x'] } }, comentarios: { a: 'falta la góndola' } },
        map
      )
    ).toEqual({
      selected: ['a'],
      evidencias: { a: { paths: ['ev/c/d/x.jpg'] } },
      comentarios: { a: 'falta la góndola' }
    })
  })
  it('los valores de unidad y de trabajadores van enteros: sus comentarios viajan', () => {
    // UNIDAD_CHECKLIST y LISTA_COLABORADORES no pasan por las proyecciones
    // (ninguna de las dos los arma campo por campo), así que van sin tocarse.
    const map = new Map<string, string>()
    const unidades = { unidades: [{ codigo: 'U1', selected: ['a'], comentarios: { a: 'nota' } }] }
    expect(convertirValor(unidades, map)).toEqual(unidades)
    const colaboradores = {
      colaboradores: [{ dni: 1, name: 'Ana', lastname: 'Gómez', selected: ['a'], comentarios: { a: 'nota' } }]
    }
    expect(convertirValor(colaboradores, map)).toEqual(colaboradores)
  })
  it('deja pasar otros valores', () => {
    const map = new Map<string, string>()
    expect(convertirValor({ value: true }, map)).toEqual({ value: true })
    expect(convertirValor('texto', map)).toBe('texto')
    expect(convertirValor(5, map)).toBe(5)
  })
  it('sube los responsables del punto incumplido: sin ellos, reabrir volvía a la preselección', () => {
    // El bug: el valor de CUMPLE se reconstruía campo por campo y se tragaba
    // `responsables`/`responsablesGerente`. La fila subía "en crudo" y al
    // reabrir la evaluación los chips volvían a estar todos encendidos, con la
    // selección del evaluador perdida.
    const map = new Map<string, string>()
    const responsables = ['Analista de Talento Humano', 'Coordinador de Reclutamiento y Selección']
    expect(
      convertirValor(
        {
          value: false,
          evidencias: [{ photoIds: [], comentario: 'No hay control' }],
          responsables,
          responsablesGerente: 'Gerente de Mercadeo'
        },
        map
      )
    ).toEqual({
      value: false,
      evidencias: [{ comentario: 'No hay control', paths: [] }],
      responsables,
      responsablesGerente: 'Gerente de Mercadeo'
    })
  })
  it('sube los responsables del checklist y los de cada check', () => {
    const map = new Map<string, string>()
    expect(
      convertirValor(
        {
          selected: ['a'],
          evidencias: {},
          responsables: ['Ana'],
          responsablesPorOpcion: { a: ['Beto'] },
          responsablesGerente: 'Elena'
        },
        map
      )
    ).toEqual({
      selected: ['a'],
      evidencias: {},
      responsables: ['Ana'],
      responsablesPorOpcion: { a: ['Beto'] },
      responsablesGerente: 'Elena'
    })
  })
})

describe('conciliación con evidencia fotográfica casada al producto', () => {
  const producto = { sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 1 }
  const otro = { sku: 'SKU-2', nombre: 'Queso', teorica: 1, fisica: 1 }

  it('extrae los photoIds locales de cada producto', () => {
    expect(extraerPhotoIds({ productos: [{ ...producto, photoIds: ['a', 'b'] }, { ...otro, photoIds: ['c'] }] })).toEqual(['a', 'b', 'c'])
    expect(extraerPhotoIds({ productos: [producto] })).toEqual([])
    expect(extraerPhotoIds({ productos: [{ ...producto, photoIds: [1] }] })).toEqual([])
    // Una version vieja del valor podía traer fotos arriba del valor.
    expect(extraerPhotoIds({ productos: [producto], photoIds: ['legacy'] })).toEqual(['legacy'])
  })

  it('al convertir conserva los productos y une las paths de la nube con las locales de cada sku', () => {
    const map = new Map([['nueva', 'ev/x/y/nueva.jpg']])
    const out = convertirValor(
      {
        productos: [
          { ...producto, paths: ['ev/x/y/vieja.jpg'], photoIds: ['nueva'] },
          { ...otro, photoIds: ['no-subida'] }
        ]
      },
      map
    ) as { productos: Record<string, unknown>[] }
    // Un valor con fotos también encajaría en el formato "foto directo": los
    // productos tienen que ganar, si no, la subida los perdería.
    expect(out.productos).toHaveLength(2)
    expect(out.productos[0].paths).toEqual(['ev/x/y/vieja.jpg', 'ev/x/y/nueva.jpg'])
    expect(out.productos[0].photoIds).toBeUndefined()
    expect(out.productos[1].paths).toEqual(['.local/no-subida'])
  })

  it('sin fotos sube los productos intactos', () => {
    expect(convertirValor({ productos: [producto] }, new Map())).toEqual({ productos: [producto] })
  })

  it('valorSinFotos deja los productos y quita las fotos de cada uno', () => {
    expect(valorSinFotos({ productos: [{ ...producto, photoIds: ['a'], paths: ['p'] }, { ...otro, paths: ['q'] }] })).toEqual({
      productos: [producto, otro]
    })
  })

  it('idsFotosRespuesta incluye las fotos de los productos', () => {
    expect(idsFotosRespuesta([{ valor: { productos: [{ ...producto, photoIds: ['foto-sku'] }] } }])).toEqual(['foto-sku'])
  })
})