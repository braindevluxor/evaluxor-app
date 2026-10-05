import { describe, it, expect } from 'vitest'
import { calcularPuntaje, valorBinario, proporcionChecklist, proporcionItem, proporcionListaColaboradores, pesoItem, fallasDeResponsable, estadoConciliacion, diferenciaConciliacion, ordenarConciliacion, totalesConciliacion, conciliacionPorcentaje, conciliacionTotal, conciliacionComparable, incumplimientosPorResponsable, responsablesDeOpcion, agregarPuntaje, redondear3, valorPorResponsable, referenciaConciliacion, tieneRespuesta, estaVacioItem, colaboradorCumple, colaboradoresQueCuentan, esColaboradorRevisado, esNoAplica, veredictoItem, ETIQUETAS_TIPO, ETIQUETAS_CONTRA_DATO, montoPerdidaConciliacion, perdidaGuardadaConciliacion, guardarPerdidaConciliacion, resumenPerdidaConciliacion } from './scoring'

describe('orden de lectura de una conciliación', () => {
  const prod = (sku: string, teorica: number | null, fisica: number | null, finalBase?: number | null) => ({
    sku,
    nombre: `Producto ${sku}`,
    teorica,
    fisica,
    ...(finalBase != null ? { finalBase } : {})
  })

  it('clasifica cada producto como falta, sobra, concilia o sin datos', () => {
    expect(estadoConciliacion(prod('a', 10, 7))).toBe('falta')
    expect(estadoConciliacion(prod('b', 10, 14))).toBe('sobra')
    expect(estadoConciliacion(prod('c', 10, 10))).toBe('concilia')
    expect(estadoConciliacion(prod('d', null, 3))).toBe('sin-datos')
    expect(estadoConciliacion(prod('e', 3, null))).toBe('sin-datos')
    expect(estadoConciliacion(null)).toBe('sin-datos')
    expect(diferenciaConciliacion(prod('a', 10, 7))).toBe(3)
    expect(diferenciaConciliacion(prod('d', null, 3))).toBe(0)
  })

  it('ordena por pérdida de mayor a menor, y detrás los sobrantes de mayor a menor', () => {
    // Perdidas: A pierde 3 unidades × $10 = $30; B pierde 1 × $90 = $90. La más
    // cara arriba, aunque falten menos unidades: lo que se pierde es plata.
    const productos = [
      prod('sobra-1', 5, 6, 10), // +1
      prod('falta-chica', 10, 9, 90), // -1 → $90
      prod('concilia', 8, 8, 10),
      prod('falta-grande', 10, 7, 10), // -3 → $30
      prod('sobra-3', 5, 8, 10), // +3
      prod('sin-datos', null, 4, 10)
    ]
    const orden = ordenarConciliacion(productos).map((p) => p.sku)
    expect(orden).toEqual([
      'falta-chica', // $90
      'falta-grande', // $30
      'sobra-3', // +3
      'sobra-1', // +1
      'concilia',
      'sin-datos'
    ])
  })

  it('el sobrante no compite con la pérdida: va después aunque sea enorme', () => {
    const productos = [
      prod('sobra-100', 1, 101, 10),
      prod('falta-1', 10, 9, 10)
    ]
    expect(ordenarConciliacion(productos).map((p) => p.sku)).toEqual(['falta-1', 'sobra-100'])
  })

  it('sin precio base los faltantes se ordenan por unidades, no todos al final', () => {
    const productos = [
      prod('sin-precio-1', 10, 9),
      prod('sin-precio-5', 10, 5),
      prod('sin-precio-3', 10, 7),
      prod('concilia', 4, 4)
    ]
    expect(ordenarConciliacion(productos).map((p) => p.sku)).toEqual([
      'sin-precio-5',
      'sin-precio-3',
      'sin-precio-1',
      'concilia'
    ])
  })

  it('lo que concilia conserva el orden en que se escaneó', () => {
    const productos = [prod('z', 5, 5), prod('a', 5, 5), prod('m', 5, 5)]
    expect(ordenarConciliacion(productos).map((p) => p.sku)).toEqual(['z', 'a', 'm'])
  })

  it('con contra dato precio base ningún faltante tiene pérdida calculada', () => {
    // Con FINAL_BASE la comparación es de precios, así que no hay pérdida que
    // ordenar: el orden cae al de unidades.
    const productos = [prod('a', 100, 99), prod('b', 100, 50), prod('s', 10, 20)]
    expect(ordenarConciliacion(productos, 'FINAL_BASE').map((p) => p.sku)).toEqual(['b', 'a', 's'])
  })

  it('no muta la lista original', () => {
    const productos = [prod('concilia', 5, 5), prod('falta', 10, 7, 10)]
    const copia = [...productos]
    ordenarConciliacion(productos)
    expect(productos).toEqual(copia)
  })

  it('los totales de unidades dicen cuántos hay que mandar a contar', () => {
    // El porcentaje dice si el conteo está bien o mal; los totales dicen cuánto
    // hay que hacer. Con el mismo 90% de desacuerdo, 40 unidades o 5 son dos
    // trabajos distintos.
    const productos = [
      prod('a', 10, 7), // faltan 3
      prod('b', 20, 18), // faltan 2
      prod('c', 4, 9), // sobran 5
      prod('d', 6, 6), // concilia
      prod('e', null, 3) // sin datos: no cuenta ni para un lado ni para el otro
    ]
    expect(totalesConciliacion(productos)).toEqual({ unidadesFaltantes: 5, unidadesSobrantes: 5 })
    expect(totalesConciliacion([])).toEqual({ unidadesFaltantes: 0, unidadesSobrantes: 0 })
    expect(totalesConciliacion(null)).toEqual({ unidadesFaltantes: 0, unidadesSobrantes: 0 })
  })
})

describe('etiqueta del tipo de ítem', () => {
  it('muestra trabajadores en el listado de evaluación de personal', () => {
    expect(ETIQUETAS_TIPO.LISTA_COLABORADORES).toBe('Listado de trabajadores')
  })
})

describe('esNoAplica · lo que el evaluador excluye del puntaje', () => {
  it('el interruptor del ítem alcanza para todos los tipos que lo tienen', () => {
    const v = { value: true, evidencias: [], informativo: true }
    expect(esNoAplica({ tipo: 'CUMPLE_NO_CUMPLE' }, v)).toBe(true)
    expect(esNoAplica({ tipo: 'CONCILIACION' }, { productos: [], informativo: true })).toBe(true)
    expect(esNoAplica({ tipo: 'LISTA_COLABORADORES' }, { colaboradores: [], informativo: true })).toBe(true)
    expect(esNoAplica({ tipo: 'UNIDAD_CHECKLIST' }, { unidades: [], informativo: true })).toBe(true)
    expect(esNoAplica({ tipo: 'PLANO_XY' }, { planos: [], informativo: true })).toBe(true)
  })
  it('sin el interruptor, ningún ítem queda como No aplica', () => {
    expect(esNoAplica({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true })).toBe(false)
    expect(esNoAplica({ tipo: 'CUMPLE_NO_CUMPLE' }, null)).toBe(false)
  })
  it('en un checklist la marca No aplica es por opción: el ítem se excluye si son todas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(esNoAplica(item, { selected: ['a'], informativos: ['b'] })).toBe(false)
    expect(esNoAplica(item, { selected: ['a'], informativos: ['a', 'b'] })).toBe(true)
    // Sin opciones cargadas no se puede decir que todas son No aplica.
    expect(esNoAplica({ tipo: 'CHECKLIST', opciones: [] }, { informativos: [] })).toBe(false)
  })
  it('un checklist marcado No aplica sigue contando como respondido', () => {
    // Si se tratara como "vacío", el avance del evaluador lo penalizaría.
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }
    expect(tieneRespuesta(item, { selected: [], informativos: ['a'] })).toBe(false)
    expect(tieneRespuesta(item, { selected: [], informativo: true } as never)).toBe(true)
  })
})

describe('veredictoItem · el filtro del detalle no puede contradecir al puntaje', () => {
  it('cumple solo cuando la proporción llega a 1', () => {
    expect(veredictoItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true })).toBe('cumple')
    expect(veredictoItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toBe('no-cumple')
  })
  it('en un checklist, lo no tildado es lo no cumplido', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(veredictoItem(item, { selected: ['a', 'b'] })).toBe('cumple')
    expect(veredictoItem(item, { selected: ['a'] })).toBe('no-cumple')
  })
  it('en un checklist con puntos, el parcial no se disfraza de cumplimiento', () => {
    // 3 de 4 puntos logrados = 0.75: no llegó al 100, así que es no-cumplido.
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a', puntos: 1 }, { id: 'b', puntos: 3 }] }
    expect(veredictoItem(item, { selected: ['a'] })).toBe('no-cumple')
  })
  it('un checklist de una sola opción tildada sí cumple', () => {
    expect(veredictoItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }, { selected: ['a'] })).toBe('cumple')
  })
  it('lo que no se contestó es sin veredicto, no un incumplimiento', () => {
    expect(veredictoItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null })).toBe('sin-veredicto')
    expect(veredictoItem({ tipo: 'CHECKLIST' }, { selected: [] })).toBe('sin-veredicto')
    expect(veredictoItem({ tipo: 'CONCILIACION' }, { productos: [] })).toBe('sin-veredicto')
    expect(veredictoItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }] }, null)).toBe('sin-veredicto')
  })
  it('No aplica se distingue de lo que simplemente no se contestó', () => {
    // Las marcas No aplica se excluyen del filtro de detalle y del puntaje.
    expect(veredictoItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false, informativo: true })).toBe('no-aplica')
    expect(veredictoItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null })).toBe('sin-veredicto')
    // Un checklist con una opción informativa todavía se puntúa por las otras.
    expect(veredictoItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }, { selected: ['a'], informativos: ['b'] })).toBe('cumple')
    // Y si todas son No aplica, el ítem entero queda afuera.
    expect(veredictoItem({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }, { selected: ['a'], informativos: ['a', 'b'] })).toBe('no-aplica')
  })
  it('el contenedor nunca es un veredicto: agrupa, no se contesta', () => {
    expect(veredictoItem({ tipo: 'CONTENEDOR' }, {})).toBe('sin-veredicto')
  })
  it('con una conciliación descuadrada el veredicto es no-cumplido', () => {
    const item = { tipo: 'CONCILIACION', opciones: [] }
    expect(veredictoItem(item, { productos: [{ sku: 'A', teorica: 10, fisica: 10 }] })).toBe('cumple')
    expect(veredictoItem(item, { productos: [{ sku: 'A', teorica: 10, fisica: 5 }] })).toBe('no-cumple')
  })
})

describe('tieneRespuesta · una respuesta vacía no cuenta como respondida', () => {
  it('detecta vacío por tipo de ítem', () => {
    expect(estaVacioItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null, evidencias: [] })).toBe(true)
    expect(estaVacioItem({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true })).toBe(false)
    expect(estaVacioItem({ tipo: 'CHECKLIST' }, { selected: [] })).toBe(true)
    expect(estaVacioItem({ tipo: 'CHECKLIST' }, { selected: ['a'] })).toBe(false)
    expect(estaVacioItem({ tipo: 'CONCILIACION' }, { productos: [] })).toBe(true)
    // Producto sin física cargada todavía no es una conciliación respondida.
    expect(estaVacioItem({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 5, fisica: null }] })).toBe(true)
    expect(estaVacioItem({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 5, fisica: 5 }] })).toBe(false)
    expect(estaVacioItem({ tipo: 'LISTA_COLABORADORES' }, { colaboradores: [] })).toBe(true)
    expect(estaVacioItem({ tipo: 'UNIDAD_CHECKLIST' }, { unidades: [] })).toBe(true)
    expect(estaVacioItem({ tipo: 'PLANO_XY' }, { planos: [], puntos: [{ id: 'p', planoId: 'pl', x: 0.5, y: 0.5, cumple: null, comentario: '' }] })).toBe(true)
    expect(estaVacioItem({ tipo: 'PLANO_XY' }, { planos: [], puntos: [{ id: 'p', planoId: 'pl', x: 0.5, y: 0.5, cumple: true, comentario: '' }] })).toBe(false)
  })
  it('un ítem marcado como informativo sí cuenta (decisión del evaluador)', () => {
    expect(tieneRespuesta({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null, evidencias: [], informativo: true })).toBe(true)
    expect(tieneRespuesta({ tipo: 'CONCILIACION' }, { productos: [], informativo: true })).toBe(true)
    expect(tieneRespuesta({ tipo: 'LISTA_COLABORADORES' }, { colaboradores: [], informativo: true })).toBe(true)
  })
  it('no cuenta claves guardadas sin contenido real (el caso del "1/9" sin cargar nada)', () => {
    expect(tieneRespuesta({ tipo: 'CHECKLIST' }, { selected: [], informativos: [], evidencias: {} })).toBe(false)
    expect(tieneRespuesta({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null, evidencias: [] })).toBe(false)
    expect(tieneRespuesta({ tipo: 'CONCILIACION' }, { productos: [] })).toBe(false)
    expect(tieneRespuesta({ tipo: 'UNIDAD_CHECKLIST' }, { unidades: [] })).toBe(false)
    expect(tieneRespuesta({ tipo: 'PLANO_XY' }, { planos: [], puntos: [] })).toBe(false)
    expect(tieneRespuesta({ tipo: 'CHECKLIST' }, undefined)).toBe(false)
    expect(tieneRespuesta({ tipo: 'CHECKLIST' }, null)).toBe(false)
  })
  it('sí cuenta cuando hay contenido', () => {
    expect(tieneRespuesta({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toBe(true)
    expect(tieneRespuesta({ tipo: 'CHECKLIST' }, { selected: ['a'] })).toBe(true)
    expect(tieneRespuesta({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 5, fisica: 4 }] })).toBe(true)
    expect(tieneRespuesta({ tipo: 'LISTA_COLABORADORES' }, { colaboradores: [{ dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected: ['o1'] }] })).toBe(true)
  })
})

describe('contra dato de conciliación', () => {
  it('calcula pérdida solo por unidades faltantes y con precio base disponible', () => {
    expect(montoPerdidaConciliacion({ teorica: 10, fisica: 7, finalBase: 12.5 })).toBe(37.5)
    expect(montoPerdidaConciliacion({ teorica: 7, fisica: 10, finalBase: 12.5 })).toBe(0)
    expect(montoPerdidaConciliacion({ teorica: 10, fisica: 7 })).toBeNull()
    expect(montoPerdidaConciliacion({ teorica: 10, fisica: 7, finalBase: 12.5 }, 'FINAL_BASE')).toBeNull()
  })

  it('congela pérdida en la respuesta y usa el snapshot aunque luego cambie el precio', () => {
    const guardado = guardarPerdidaConciliacion({
      sku: 'A',
      nombre: 'Producto A',
      teorica: 10,
      fisica: 7,
      finalBase: 12.5
    })
    const actualizado = { ...guardado, finalBase: 25 }

    expect(guardado.perdidaEstimada).toBe(37.5)
    expect(perdidaGuardadaConciliacion(actualizado)).toBe(37.5)
    expect(perdidaGuardadaConciliacion({
      teorica: 10,
      fisica: 7,
      finalBase: 12.5
    })).toBe(37.5)
  })

  it('resume pérdidas y reporta faltantes sin precio base', () => {
    expect(resumenPerdidaConciliacion([
      { sku: 'A', nombre: null, teorica: 10, fisica: 7, finalBase: 12.5 },
      { sku: 'B', nombre: null, teorica: 4, fisica: 3, finalBase: null },
      { sku: 'C', nombre: null, teorica: 2, fisica: 4, finalBase: 3 }
    ])).toEqual({ monto: 37.5, faltantesConPrecio: 1, faltantesSinPrecio: 1 })
  })

  it('el resumen respeta importes congelados de la respuesta', () => {
    expect(resumenPerdidaConciliacion([
      { sku: 'A', nombre: null, teorica: 10, fisica: 7, finalBase: 25, perdidaEstimada: 37.5 }
    ])).toEqual({ monto: 37.5, faltantesConPrecio: 1, faltantesSinPrecio: 0 })
  })

  it('referenciaConciliacion usa soh por defecto y finalBase en modo precio', () => {
    const p = { teorica: 99, soh: 42, finalBase: 12990.5 }
    expect(referenciaConciliacion(p)).toBe(42)
    expect(referenciaConciliacion(p, 'SOH')).toBe(42)
    expect(referenciaConciliacion(p, 'FINAL_BASE')).toBe(12990.5)
  })
  it('referenciaConciliacion cae a la teórica ya cargada cuando falta el dato elegido', () => {
    expect(referenciaConciliacion({ teorica: 7, soh: null }, 'SOH')).toBe(7)
    expect(referenciaConciliacion({ teorica: 5, soh: 2 }, 'FINAL_BASE')).toBe(5)
    expect(referenciaConciliacion(null, 'SOH')).toBe(null)
    expect(referenciaConciliacion(undefined, 'FINAL_BASE')).toBe(null)
  })
  it('ETIQUETAS_CONTRA_DATO expone ambas opciones', () => {
    expect(ETIQUETAS_CONTRA_DATO.SOH).toContain('SOH')
    expect(ETIQUETAS_CONTRA_DATO.FINAL_BASE).toContain('Precio')
  })
})

describe('valorBinario', () => {
  it('cumple/no cumple', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true })).toBe(true)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toBe(false)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, null)).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: null })).toBe(null)
  })
  it('checklist cumple solo si todas las opciones estan marcadas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a', 'b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], evidencias: { b: { photoIds: ['x'] } } })).toBe(true)
    expect(valorBinario(item, { selected: ['a'] })).toBe(false)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { selected: [] })).toBe(null)
  })
  it('tipos no puntuables no puntuan', () => {
    expect(valorBinario({ tipo: 'OTRO' }, 'texto')).toBe(null)
    expect(valorBinario({ tipo: 'OTRO' }, { photoIds: ['x'] })).toBe(null)
    expect(valorBinario({ tipo: 'OTRO' }, 5)).toBe(null)
  })
  it('informativo no descuenta puntos', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 10, fisica: 9 }], informativo: true })).toBe(null)
  })
  it('checklist excluye opciones informativas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a'], informativos: ['a'] })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['a', 'b'] })).toBe(null)
    expect(valorBinario(item, { selected: [], informativos: ['b'] })).toBe(null)
  })
  it('informativo no descuenta puntos', () => {
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: true, informativo: true })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'A', teorica: 10, fisica: 9 }], informativo: true })).toBe(null)
  })
  it('checklist excluye opciones informativas', () => {
    const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(valorBinario(item, { selected: ['a'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['b'] })).toBe(true)
    expect(valorBinario(item, { selected: ['a'], informativos: ['a'] })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'], informativos: ['a', 'b'] })).toBe(null)
    expect(valorBinario(item, { selected: [], informativos: ['b'] })).toBe(null)
  })
  it('conciliacion cumple cuando fisica coincide con teorica en todos los productos', () => {
    const ok = { sku: 'A', teorica: 10, fisica: 10 }
    const mal = { sku: 'B', teorica: 10, fisica: 9 }
    const incompleto = { sku: 'C', teorica: null, fisica: 9 }
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [ok] })).toBe(true)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [ok, mal] })).toBe(false)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [incompleto] })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [] })).toBe(null)
    expect(valorBinario({ tipo: 'CONCILIACION' }, null)).toBe(null)
  })
  it('el SOH cero es un dato comparable: existencia física positiva es un descuadre', () => {
    const sobrante = { sku: 'A', teorica: 0, fisica: 3 }
    expect(conciliacionComparable(sobrante)).toBe(true)
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [sobrante] })).toBe(false)
    expect(veredictoItem({ tipo: 'CONCILIACION' }, { productos: [sobrante] })).toBe('no-cumple')
    expect(valorBinario({ tipo: 'CONCILIACION' }, { productos: [{ sku: 'B', teorica: 0, fisica: 0 }] })).toBe(true)
  })
  it('listado de trabajadores cumple cuando todos los que aplican tienen su checklist completo', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const col = (selected: string[], aplica = true) => ({ dni: 1, name: 'A', lastname: 'B', active: true, aplica, selected })
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col(['a', 'b'])] })).toBe(true)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col(['a'])] })).toBe(false)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b']), col([], false)] })).toBe(true)
    expect(valorBinario(item, { colaboradores: [] })).toBe(null)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { colaboradores: [col(['a', 'b'])], informativo: true })).toBe(null)
  })
  it('listado de trabajadores excluye los puntos no aplicables a cada trabajador', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const v = {
      colaboradores: [
        { dni: 1, name: 'Ana', lastname: 'A', active: true, aplica: true, selected: ['a'], noAplica: ['b'] },
        { dni: 2, name: 'Luis', lastname: 'B', active: true, aplica: true, selected: ['b'], noAplica: ['a'] }
      ]
    }
    expect(valorBinario(item, v)).toBe(true)
    expect(colaboradorCumple(v.colaboradores[0], item.opciones)).toBe(true)
    expect(incumplimientosPorResponsable({ ...item, opciones: item.opciones.map((o, i) => ({ ...o, responsable: i ? 'B' : 'A' })) }, v)).toEqual([])
  })
  it('si todos los puntos no aplican, el listado queda fuera del puntaje', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const valor = { colaboradores: [{ dni: 1, name: 'Ana', lastname: 'A', active: true, aplica: true, selected: [], noAplica: ['a', 'b'] }] }
    expect(valorBinario(item, valor)).toBe(null)
    expect(calcularPuntaje([{ item, valor }])).toBe(null)
  })
  it('el trabajador sin revisar no es un incumplimiento: no entra en la evaluación', () => {
    // El caso que motiva la regla: veinte personas cargadas destildadas, seis
    // revisadas. Antes el ítem valía cero porque los catorce restantes "fallaban"
    // todo, y la culpa era del reloj del evaluador, no de la tienda.
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const col = (dni: number, selected: string[]) => ({ dni, name: `T${dni}`, lastname: 'X', active: true, aplica: true, selected })
    const seis = Array.from({ length: 6 }, (_, i) => col(i + 1, ['a', 'b']))
    const sinTocar = Array.from({ length: 14 }, (_, i) => col(i + 100, []))
    const valor = { colaboradores: [...seis, ...sinTocar] }

    expect(esColaboradorRevisado(sinTocar[0])).toBe(false)
    expect(esColaboradorRevisado(seis[0])).toBe(true)
    expect(colaboradoresQueCuentan(valor.colaboradores)).toHaveLength(6)
    // Los seis revisados cumplen, así que el ítem cumple: los catorce sin tocar
    // no lo arruinan.
    expect(valorBinario(item, valor)).toBe(true)
    expect(veredictoItem(item, valor)).toBe('cumple')
    expect(calcularPuntaje([{ item, valor }])).toBe(100)
  })
  it('sin nadie revisado el listado no tiene veredicto, no es un cero', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }] }
    const valor = { colaboradores: [{ dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected: [] }] }
    expect(valorBinario(item, valor)).toBe(null)
    expect(veredictoItem(item, valor)).toBe('sin-veredicto')
    expect(calcularPuntaje([{ item, valor }])).toBe(null)
  })
  it('un incumplimiento entre los revisados sigue bajando el ítem', () => {
    // La regla no es "todo pasa": solo saca a los que nadie miró.
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }, { id: 'b' }] }
    const valor = {
      colaboradores: [
        { dni: 1, name: 'A', lastname: 'A', active: true, aplica: true, selected: ['a', 'b'] },
        { dni: 2, name: 'B', lastname: 'B', active: true, aplica: true, selected: ['a'] },
        { dni: 3, name: 'C', lastname: 'C', active: true, aplica: true, selected: [] }
      ]
    }
    expect(valorBinario(item, valor)).toBe(false)
    expect(veredictoItem(item, valor)).toBe('no-cumple')
  })
  it('"revisado" es lo que el evaluador registró en la fila, tildando o no', () => {
    const base = { dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected: [] as string[] }
    // Un check tildado: queda registrado aunque el resto falle.
    expect(esColaboradorRevisado({ ...base, selected: ['a'] })).toBe(true)
    // Marcar "no aplica" también es haber revisado.
    expect(esColaboradorRevisado({ ...base, noAplica: ['b'] })).toBe(true)
    // Y asignar responsables a una falla, que es el único registro posible cuando
    // no le cumple nada.
    expect(esColaboradorRevisado({ ...base, responsablesPorOpcion: { a: ['Ana'] } })).toBe(true)
    // La fila sin nada: todavía no se miró.
    expect(esColaboradorRevisado(base)).toBe(false)
  })
  it('el trabajador destildado al que no le cumple nada se registra asignando responsables', () => {
    // Si no le cumple nada no hay check que tildar, así que la revisión queda
    // registrada en los responsables del punto incumplido. Con eso el
    // incumplimiento cuenta igual y el trabajador entra en la evaluación.
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a', responsable: 'Jefe' }] }
    const destildado = {
      dni: 1,
      name: 'Ana',
      lastname: 'A',
      active: true,
      aplica: true,
      selected: [],
      responsablesPorOpcion: { a: ['Jefe'] }
    }
    expect(esColaboradorRevisado(destildado)).toBe(true)
    expect(colaboradoresQueCuentan([destildado])).toHaveLength(1)
    expect(valorBinario(item, { colaboradores: [destildado] })).toBe(false)
    expect(veredictoItem(item, { colaboradores: [destildado] })).toBe('no-cumple')
    expect(incumplimientosPorResponsable(item, { colaboradores: [destildado] })).toEqual([
      { responsable: 'Jefe', puntos: 1 }
    ])
  })
  it('la fila totalmente vacía es la única que no cuenta', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }] }
    const vacia = { dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected: [] }
    expect(esColaboradorRevisado(vacia)).toBe(false)
    expect(colaboradoresQueCuentan([vacia])).toEqual([])
    expect(valorBinario(item, { colaboradores: [vacia] })).toBe(null)
  })
  it('el ítem de trabajadores puntúa por trabajador revisado, no todo o nada', () => {
    // El caso que define la regla: un ítem de 20 puntos en una sucursal con 80
    // trabajadores, de los cuales solo se revisaron 30. Con 15 de esos 30
    // completos queda 15/30 = 0.5 y el ítem aporta 10 de los 20. Antes valía 0
    // porque un solo trabajador sin uniforme se comía el módulo entero.
    const opciones = [{ id: 'uniforme' }]
    const completo = (dni: number) => ({ dni, name: `T${dni}`, lastname: 'X', active: true, aplica: true, selected: ['uniforme'] })
    // Destildado pero con responsable asignado: revisado, y le falta el uniforme.
    const conFalla = (dni: number) => ({
      dni,
      name: `T${dni}`,
      lastname: 'X',
      active: true,
      aplica: true,
      selected: [],
      responsablesPorOpcion: { uniforme: ['Jefe'] }
    })
    const sinTocar = (dni: number) => ({ dni, name: `T${dni}`, lastname: 'X', active: true, aplica: true, selected: [] })

    const quinceCompletos = Array.from({ length: 15 }, (_, i) => completo(i + 1))
    const quinceConFalla = Array.from({ length: 15 }, (_, i) => conFalla(i + 50))
    const sinRevisar = Array.from({ length: 50 }, (_, i) => sinTocar(i + 200))
    const valor = { colaboradores: [...quinceCompletos, ...quinceConFalla, ...sinRevisar] }

    expect(proporcionListaColaboradores(valor, opciones)).toBe(0.5)
    expect(proporcionItem({ tipo: 'LISTA_COLABORADORES', opciones }, valor)).toBe(0.5)
    // El veredicto sigue siendo binario: la mitad no es "cumple".
    expect(veredictoItem({ tipo: 'LISTA_COLABORADORES', opciones }, valor)).toBe('no-cumple')
    expect(valorBinario({ tipo: 'LISTA_COLABORADORES', opciones }, valor)).toBe(false)
    // Los 20 puntos del ítem se llevan la mitad: 20 × 0.5 = 10. Medido sobre un
    // módulo de 40 puntos (este ítem de 20 más otro de 20 que cumple entero), el
    // módulo da (20×0.5 + 20×1) / 40 = 75. Con el todo-o-nada de antes daba 50.
    expect(calcularPuntaje([{ item: { tipo: 'LISTA_COLABORADORES', opciones, puntaje: 20 }, valor }])).toBe(50)
    expect(
      calcularPuntaje([
        { item: { tipo: 'LISTA_COLABORADORES', opciones, puntaje: 20 }, valor },
        { item: { tipo: 'CUMPLE_NO_CUMPLE', opciones: null, puntaje: 20 }, valor: { value: true } }
      ])
    ).toBe(75)
    // Los sin revisar no mueven el denominador: sin ellos también da 0.5.
    expect(proporcionListaColaboradores({ colaboradores: [...quinceCompletos, ...quinceConFalla] }, opciones)).toBe(0.5)
    // Todos completos = 1, que es el único caso que "cumple".
    expect(
      proporcionListaColaboradores({ colaboradores: [...quinceCompletos, ...quinceCompletos] }, opciones)
    ).toBe(1)
    // Nadie revisado: no hay proporción y el ítem no puntúa.
    expect(proporcionListaColaboradores({ colaboradores: sinRevisar }, opciones)).toBe(null)
    expect(calcularPuntaje([{ item: { tipo: 'LISTA_COLABORADORES', opciones, puntaje: 20 }, valor: { colaboradores: sinRevisar } }])).toBe(null)
    // Un check "no aplica" a todos los deja sin nada aplicable: tampoco puntúa.
    const todosNoAplica = quinceCompletos.map((c) => ({ ...c, noAplica: ['uniforme'] }))
    expect(proporcionListaColaboradores({ colaboradores: todosNoAplica }, opciones)).toBe(null)
  })
  it('un trabajador con cinco de seis checks vale uno con una falla, no medio', () => {
    // El corte es por persona: el requisito es del trabajador, no del requisito.
    const opciones = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }]
    const base = { name: 'A', lastname: 'B', active: true, aplica: true }
    const valor = {
      colaboradores: [
        { ...base, dni: 1, selected: ['a', 'b', 'c', 'd', 'e'] },
        { ...base, dni: 2, selected: ['a', 'b', 'c', 'd', 'e'] }
      ]
    }
    // 2 de 2 revisados, y ninguno completo: el ítem vale 0, no 5/6.
    expect(proporcionListaColaboradores(valor, opciones)).toBe(0)
  })
  it('los excluidos con la casilla no cuentan, y sin los excluidos el resto manda', () => {
    const item = { tipo: 'LISTA_COLABORADORES', opciones: [{ id: 'a' }] }
    const valor = {
      colaboradores: [
        { dni: 1, name: 'A', lastname: 'A', active: true, aplica: true, selected: ['a'] },
        { dni: 2, name: 'B', lastname: 'B', active: true, aplica: true, selected: [] }
      ]
    }
    expect(colaboradoresQueCuentan(valor.colaboradores).map((c) => c.dni)).toEqual([1])
    expect(valorBinario(item, valor)).toBe(true)
  })
  it('unidad checklist cumple cuando todas las unidades tienen su checklist completo', () => {
    const item = { tipo: 'UNIDAD_CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }
    const unidad = (selected: string[]) => ({ codigo: `U-${selected.join('')}`, selected })
    expect(valorBinario(item, { unidades: [unidad(['a', 'b']), unidad(['a', 'b'])] })).toBe(true)
    expect(valorBinario(item, { unidades: [unidad(['a', 'b']), unidad(['a'])] })).toBe(false)
    expect(valorBinario(item, { unidades: [] })).toBe(null)
    expect(valorBinario(item, null)).toBe(null)
    expect(valorBinario(item, { unidades: [unidad(['a', 'b'])], informativo: true })).toBe(null)
  })
it('conciliacion porcentaje: si pasa de 100 se resta el excedente, si no queda como esta', () => {
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 10 })).toBe(100)
    expect(conciliacionPorcentaje({ teorica: 48, fisica: 39 })).toBe(81.25)
    expect(conciliacionPorcentaje({ teorica: 150, fisica: 160 })).toBe(93.75)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: 5 })).toBe(50)
    expect(conciliacionPorcentaje({ teorica: 0, fisica: 5 })).toBe(0)
    expect(conciliacionPorcentaje({ teorica: 0, fisica: 0 })).toBe(100)
    expect(conciliacionPorcentaje({ teorica: Number.NaN, fisica: 5 })).toBe(null)
    expect(conciliacionPorcentaje({ teorica: 10, fisica: null })).toBe(null)
    expect(conciliacionPorcentaje(null)).toBe(null)
  })

  it('conciliacion total es la tasa de productos sin coincidir sobre los escaneados', () => {
    // A coincide (10/10) y B no (10/5) → 1 de 2 sin coincidir = 50
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 10, fisica: 5 }] })).toBe(50)
    // Ninguno coincide → 100
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 150, fisica: 160 }, { sku: 'B', nombre: null, teorica: 48, fisica: 39 }] })).toBe(100)
    // Todos coinciden (incluido stock 0/0) → 0
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }, { sku: 'B', nombre: null, teorica: 0, fisica: 0 }] })).toBe(0)
    // Stock teórico en cero y existencia física: el producto cuenta como descuadrado.
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 0, fisica: 3 }] })).toBe(100)
    // Solo cuentan los escaneados con ambas cantidades cargadas
    expect(conciliacionTotal({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: null }] })).toBe(null)
    expect(conciliacionTotal({ productos: [] })).toBe(null)
    expect(conciliacionTotal(null)).toBe(null)
  })
})

describe('calcularPuntaje', () => {
  it('porcentaje de cumplimiento', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false } },
      { item: { tipo: 'OTRO' }, valor: 'zona de frescos' }
    ]
    expect(calcularPuntaje(resps)).toBe(66.67)
  })
  it('informativo excluido del total de calcularPuntaje', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false, informativo: true } }
    ]
    expect(calcularPuntaje(resps)).toBe(100)
  })
  it('null sin binarios', () => {
    expect(calcularPuntaje([{ item: { tipo: 'OTRO' }, valor: 'x' }])).toBe(null)
    expect(calcularPuntaje([])).toBe(null)
  })
  it('pondera por los puntos asignados a cada ítem', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 30 }, valor: { value: false } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20 }, valor: { value: false } }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
    expect(calcularPuntaje([...resps, { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } }])).toBe(66.67)
  })
  it('resta los puntos de ítems informativos aunque tengan puntaje', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 50 }, valor: { value: false, informativo: true } }
    ]
    expect(calcularPuntaje(resps)).toBe(100)
  })
  it('sin puntos asignados reparte de forma igualitaria', () => {
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: true } },
      { item: { tipo: 'CUMPLE_NO_CUMPLE' }, valor: { value: false } }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
  })
})

describe('incumplimientosPorResponsable', () => {
  it('checklist acumula cada punto sin marcar a su responsable', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' },
        { id: 'c', etiqueta: 'C' }
      ]
    }
    expect(incumplimientosPorResponsable(item, { selected: ['a'] })).toEqual([{ responsable: 'Chofer', puntos: 1 }])
    expect(incumplimientosPorResponsable(item, { selected: [] })).toEqual([])
    expect(incumplimientosPorResponsable(item, null)).toEqual([])
  })
  it('checklist no acumula puntos informativos ni los ya marcados', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    expect(incumplimientosPorResponsable(item, { selected: ['a'], informativos: ['b'] })).toEqual([])
    expect(incumplimientosPorResponsable(item, { selected: ['a', 'b'], informativos: [] })).toEqual([])
  })
  it('unidad checklist suma el punto faltante por cada unidad', () => {
    const item = {
      tipo: 'UNIDAD_CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    const v = { unidades: [{ codigo: 'U1', selected: ['a'] }, { codigo: 'U2', selected: ['a'] }] }
    expect(incumplimientosPorResponsable(item, v)).toEqual([{ responsable: 'Chofer', puntos: 2 }])
  })
  it('lista de trabajadores ignora a los que no aplican', () => {
    const item = {
      tipo: 'LISTA_COLABORADORES',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    const col = (aplica: boolean, selected: string[]) => ({ dni: 1, name: 'A', lastname: 'B', active: true, aplica, selected })
    const v = { colaboradores: [col(true, ['a']), col(false, [])] }
    expect(incumplimientosPorResponsable(item, v)).toEqual([{ responsable: 'Chofer', puntos: 1 }])
  })
  it('lista de colaboradores: cada trabajador que falla un check aporta la falla a SUS responsables elegidos', () => {
    const item = {
      tipo: 'LISTA_COLABORADORES',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico' },
        { id: 'b', etiqueta: 'B', responsable: 'Chofer' }
      ]
    }
    const col = (selected: string[], rp?: Record<string, string[]>) => ({
      dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected,
      ...(rp ? { responsablesPorOpcion: rp } : {})
    })
    // Ambos marcaron 'a'. El primero falló 'b' → atribuido a Ana; el segundo falló 'b' sin elección → gerente.
    const v = { colaboradores: [col(['a'], { b: ['Ana'] }), col(['a'])], responsablesGerente: 'Gerente' }
    expect(incumplimientosPorResponsable(item, v)).toEqual([
      { responsable: 'Ana', puntos: 1 },
      { responsable: 'Gerente', puntos: 1 }
    ])
  })
  it('tipos sin puntos con responsable no acumulan', () => {
    expect(incumplimientosPorResponsable({ tipo: 'CUMPLE_NO_CUMPLE' }, { value: false })).toEqual([])
    expect(incumplimientosPorResponsable({ tipo: 'CONCILIACION', opciones: [{ id: 'a', responsable: 'X' }] }, { productos: [{ sku: 'A', teorica: 2, fisica: 1 }] })).toEqual([])
  })
  it('un check con varios responsables suma a cada uno', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [{ id: 'a', etiqueta: 'A', responsables: ['Mecanico', 'Soldador'] }, { id: 'b', etiqueta: 'B', responsable: 'Chofer' }]
    }
    expect(incumplimientosPorResponsable(item, { selected: ['b'] })).toEqual([
      { responsable: 'Mecanico', puntos: 1 },
      { responsable: 'Soldador', puntos: 1 }
    ])
    expect(incumplimientosPorResponsable(item, { selected: ['a', 'b'] })).toEqual([])
  })
  it('lee el responsable guardado en el campo antiguo y no lo duplica', () => {
    const item = {
      tipo: 'CHECKLIST',
      opciones: [
        { id: 'a', etiqueta: 'A', responsable: 'Mecanico', responsables: ['Mecanico'] },
        { id: 'b', etiqueta: 'B', responsable: 'Mecanico' }
      ]
    }
    // Solo falla 'b': cuenta 1 punto, aunque 'a' conserve también el campo antiguo.
    expect(incumplimientosPorResponsable(item, { selected: ['a'] })).toEqual([{ responsable: 'Mecanico', puntos: 1 }])
  })
})

describe('responsablesDeOpcion', () => {
  it('devuelve la lista de responsables sin repetidos ni vacíos', () => {
    expect(responsablesDeOpcion({ responsables: ['A', ' B ', 'A', ''] })).toEqual(['A', 'B'])
  })
  it('usa el campo antiguo cuando no hay lista', () => {
    expect(responsablesDeOpcion({ responsable: 'Mecanico' })).toEqual(['Mecanico'])
    expect(responsablesDeOpcion({ responsable: 'Mecanico', responsables: ['Soldador'] })).toEqual(['Soldador', 'Mecanico'])
    expect(responsablesDeOpcion(null)).toEqual([])
  })
})

describe('proporcionChecklist', () => {
  const item = { tipo: 'CHECKLIST', opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }

  it('reparte la proporcion segun los puntos de las opciones marcadas', () => {
    expect(proporcionChecklist(item, { selected: ['a', 'b', 'c'] })).toBe(1)
    expect(proporcionChecklist(item, { selected: ['a'] })).toBe(0.5) // 3/6
    expect(proporcionChecklist(item, { selected: ['c'] })).toBe(1 / 3) // 2/6
    expect(proporcionChecklist(item, { selected: ['b'] })).toBe(1 / 6) // 1/6
    expect(proporcionChecklist(item, { selected: ['a', 'b'] })).toBe(2 / 3) // 4/6
  })

  it('sin respuesta o sin opciones relevantes no es puntuable', () => {
    expect(proporcionChecklist(item, null)).toBe(null)
    expect(proporcionChecklist(item, { selected: [] })).toBe(null)
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [] }, { selected: ['a'] })).toBe(null)
  })

  it('excluye las opciones informativas del calculo', () => {
    expect(proporcionChecklist(item, { selected: ['a'], informativos: ['b', 'c'] })).toBe(1)
    expect(proporcionChecklist(item, { selected: [], informativos: ['a', 'b', 'c'] })).toBe(null)
  })

  it('no es proporcional si alguna opcion no tiene puntos (todo o nada)', () => {
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [{ id: 'a', puntos: 3 }, { id: 'b' }] }, { selected: ['a'] })).toBe(null)
    expect(proporcionChecklist({ tipo: 'CHECKLIST', opciones: [{ id: 'a' }, { id: 'b' }] }, { selected: ['a', 'b'] })).toBe(null)
  })
})

describe('checklist con opciones de rango', () => {
  type OpcionRango = { id: string; tipo_respuesta?: 'CHECK' | 'RANGO'; minimo?: number; puntos?: number }
  const item: { tipo: 'CHECKLIST'; opciones: OpcionRango[] } = {
    tipo: 'CHECKLIST',
    opciones: [
      { id: 'a', tipo_respuesta: 'RANGO', minimo: 30, puntos: 4 },
      { id: 'b', puntos: 2 }
    ]
  }

  it('valorBinario: el rango solo cumple si el valor alcanza el minimo', () => {
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 40 } })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 30 } })).toBe(true)
    expect(valorBinario(item, { selected: ['a', 'b'], valores: { a: 25 } })).toBe(false)
    expect(valorBinario(item, { selected: ['a', 'b'] })).toBe(false)
    expect(valorBinario(item, { selected: ['b'], valores: { a: 40 } })).toBe(false)
  })

  it('proporcionChecklist: el rango cumplido suma sus puntos y el no cumplido no', () => {
    expect(proporcionChecklist(item, { selected: ['a', 'b'], valores: { a: 40 } })).toBe(1)
    expect(proporcionChecklist(item, { selected: ['a', 'b'], valores: { a: 10 } })).toBe(2 / 6) // solo b
    expect(proporcionChecklist(item, { selected: ['a'], valores: { a: 40 } })).toBe(4 / 6) // solo a
  })

  it('sin minimo configurado el rango no cumple aunque tenga valor', () => {
    const sinMinimo: { tipo: 'CHECKLIST'; opciones: OpcionRango[] } = { tipo: 'CHECKLIST', opciones: [{ id: 'a', tipo_respuesta: 'RANGO', puntos: 4 }] }
    expect(valorBinario(sinMinimo, { selected: ['a'], valores: { a: 50 } })).toBe(false)
  })
})

describe('secciones CONTENEDOR', () => {
  const seccion = { id: 's1', tipo: 'CONTENEDOR', puntaje: 0 }

  it('no puntúan: valorBinario y proporcionItem devuelven null', () => {
    expect(valorBinario(seccion, null)).toBeNull()
    expect(proporcionItem(seccion, null)).toBeNull()
    expect(proporcionItem(seccion, { selected: ['a'] })).toBeNull()
  })

  it('pesoItem devuelve 0 aunque tengan puntaje residual', () => {
    expect(pesoItem(seccion)).toBe(0)
    expect(pesoItem({ puntaje: 50 })).toBe(50)
  })
})

describe('calcularPuntaje con checklist proporcional', () => {
  it('reparte el peso del item segun los puntos de las opciones marcadas', () => {
    const checklist = { tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }
    const resps = [
      { item: { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10 }, valor: { value: true } }, // 10 pts
      { item: checklist, valor: { selected: ['a'] } } // 10 pts * (3/6) = 5
    ]
    expect(calcularPuntaje(resps)).toBe(75)
  })

  it('checklist sin puntos por opcion sigue siendo todo o nada', () => {
    const item = { tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'a' }, { id: 'b' }] }
    expect(calcularPuntaje([{ item, valor: { selected: ['a', 'b'] } }])).toBe(100)
    expect(calcularPuntaje([{ item, valor: { selected: ['a'] } }])).toBe(0)
  })
})

describe('calcularPuntaje con registros (secciones repetibles)', () => {
  const item = { tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10 }

  it('promedia el mismo ítem entre sus registros', () => {
    expect(calcularPuntaje([
      { item, valor: { value: true } },
      { item, valor: { value: false } }
    ])).toBe(50)
  })

  it('un solo registro mantiene el puntaje normal', () => {
    expect(calcularPuntaje([{ item, valor: { value: true } }])).toBe(100)
    expect(calcularPuntaje([{ item, valor: { value: false } }])).toBe(0)
  })

  it('tres registros con dos en regla pesan ~2/3', () => {
    expect(calcularPuntaje([
      { item, valor: { value: true } },
      { item, valor: { value: true } },
      { item, valor: { value: false } }
    ])).toBe(66.67)
  })
})

describe('secciones ponderadas', () => {
  const seccion = { id: 's1', tipo: 'CONTENEDOR', puntaje: 60 }
  const hijo = (id: string, puntaje: number) => ({ id, tipo: 'CUMPLE_NO_CUMPLE', puntaje, padre_id: 's1' })
  const entries = (cumplen: Record<string, boolean | number>) => [
    { item: seccion, cumple: null },
    ...Object.entries(cumplen).map(([id, c]) => ({ item: hijo(id, 20), cumple: c }))
  ]

  it('la sección ponderada pesa en el módulo y agrupa a sus hijos', () => {
    // Tres hijos de 20: dos cumplen → 2/3 de la sección (60) → 40 de 60.
    expect(agregarPuntaje(entries({ h1: true, h2: true, h3: false }))).toBe(66.67)
  })

  it('la sección no puede superar su peso: hijos que suman menos alzan el máximo', () => {
    // Hijos que suman menos que la sección: cumplimiento completo = 100% de lo que suman.
    const seccionP = { id: 'p1', tipo: 'CONTENEDOR', puntaje: 60 }
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 30, padre_id: 'p1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 10, padre_id: 'p1' }, cumple: true },
      { item: seccionP, cumple: null }
    ]
    expect(agregarPuntaje(hijos)).toBe(100)
  })

  it('los ítems del grupo suman el 100% del grupo: el % logrado se aplica sobre el peso de la sección', () => {
    // Grupo de 25 pts cuyo 100% interno son 100 pts en checks: logran 61 de 100
    // → la sección aporta el 61% de 25 = 15.25 pts (61%).
    const seccion25 = { id: 'g1', tipo: 'CONTENEDOR', puntaje: 25 }
    const hijos = [
      { item: { id: 'ch1', tipo: 'CHECKLIST', puntaje: 30, padre_id: 'g1', opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }, cumple: 0.7 },
      { item: { id: 'ch2', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 40, padre_id: 'g1' }, cumple: 1 },
      { item: { id: 'ch3', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 30, padre_id: 'g1' }, cumple: 0 },
      { item: seccion25, cumple: null }
    ]
    // Logrado = 30×0.7 + 40×1 + 30×0 = 61 de 100 → 61% de 25 = 15.25 → 61%.
    expect(agregarPuntaje(hijos)).toBe(61)
  })

  it('hijo incumplido resta solo su peso dentro del grupo', () => {
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'c', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: false },
      { item: seccion, cumple: null }
    ]
    expect(agregarPuntaje(hijos)).toBe(66.67)
  })

  it('sin la sección en la lista, los hijos se cuentan directos (respaldo)', () => {
    // Comportamiento previo para datos existentes: la sección no aparece en las respuestas.
    const hijos = [
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: true },
      { item: { id: 'c', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's1' }, cumple: false }
    ]
    expect(agregarPuntaje(hijos)).toBe(66.67)
  })

  it('sección sin puntaje no participa y sus hijos siguen directos', () => {
    const seccion0 = { id: 's0', tipo: 'CONTENEDOR', puntaje: 0 }
    const r = agregarPuntaje([
      { item: seccion0, cumple: null },
      { item: { id: 'a', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's0' }, cumple: true },
      { item: { id: 'b', tipo: 'CUMPLE_NO_CUMPLE', puntaje: 20, padre_id: 's0' }, cumple: false }
    ])
    expect(r).toBe(50)
  })

  it('calcularPuntaje agrupa secciones dentro de una evaluación', () => {
    const seccionE = { id: 'sec1', tipo: 'CONTENEDOR', puntaje: 60 }
    const hijoE = (id: string, puntaje: number) => ({ id, tipo: 'CUMPLE_NO_CUMPLE', puntaje, padre_id: 'sec1' })
    const resps = [
      { item: hijoE('h1', 20), valor: { value: true } },
      { item: hijoE('h2', 20), valor: { value: true } },
      { item: hijoE('h3', 20), valor: { value: false } },
      { item: seccionE, valor: undefined }
    ]
    expect(calcularPuntaje(resps)).toBe(66.67)
  })

  it('sección con checklist proporcional entre sus hijos', () => {
    const seccionC = { id: 'sec2', tipo: 'CONTENEDOR', puntaje: 100 }
    const checklist = { id: 'ch1', tipo: 'CHECKLIST', puntaje: 100, padre_id: 'sec2', opciones: [{ id: 'a', puntos: 3 }, { id: 'b', puntos: 1 }, { id: 'c', puntos: 2 }] }
    const resps = [
      { item: checklist, valor: { selected: ['a'] } }, // 3/6
      { item: seccionC, valor: undefined }
    ]
    expect(calcularPuntaje(resps)).toBe(50)
  })

  it('redondear3 deja hasta 3 decimales y respeta 6/15 = 0.4', () => {
    expect(redondear3(6 / 15)).toBe(0.4)
    expect(redondear3(1 / 3)).toBe(0.333)
    expect(redondear3(0.0006)).toBe(0.001)
    expect(redondear3(2.34567)).toBe(2.346)
  })
})

describe('valorPorResponsable', () => {
  const itemCon = (id: string, tipo: string, puntaje: number, participantes: string[]) => ({
    id,
    tipo,
    puntaje,
    opciones: participantes.map((p) => ({ id: `o-${id}-${p}`, responsable: p })),
    responsables: participantes
  })

  it('reparte cada ítem entre sus responsables y reconstruye los 100 puntos', () => {
    // Ejercicio: 4 ítems de 25 pts. ítem1 abarca 4 responsables, ítem2 abarca 3,
    // ítem3 e ítem4 abarcan 2. Reparto: 25/4, 25/3, 25/2, 25/2.
    const items = [
      itemCon('i1', 'CHECKLIST', 25, ['Ana', 'Beto', 'Caro', 'Dani']),
      itemCon('i2', 'CHECKLIST', 25, ['Ana', 'Beto', 'Caro']),
      itemCon('i3', 'CHECKLIST', 25, ['Ana', 'Beto']),
      itemCon('i4', 'CHECKLIST', 25, ['Ana', 'Beto'])
    ]
    const v = valorPorResponsable(items)
    const por = Object.fromEntries(v.map((x) => [x.responsable, x.posible]))
    expect(por['Ana']).toBeCloseTo(6.25 + 25 / 3 + 12.5 + 12.5, 2) // 39.583
    expect(por['Beto']).toBeCloseTo(6.25 + 25 / 3 + 12.5 + 12.5, 2)
    expect(por['Caro']).toBeCloseTo(6.25 + 25 / 3, 2) // 14.583 (solo ítems 1 y 2)
    expect(por['Dani']).toBeCloseTo(6.25, 2)
    expect(v.reduce((a, x) => a + x.posible, 0)).toBeCloseTo(100, 1)
    expect(v.reduce((a, x) => a + x.items, 0)).toBe(11)
  })

  it('con respuestas: el cumplimiento del ítem pondera la parte de cada responsable', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto', 'Caro', 'Dani'])]
    const ok = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: true } }])
    for (const x of ok) {
      expect(x.posible).toBeCloseTo(6.25, 2)
      expect(x.logrado).toBeCloseTo(6.25, 2)
      expect(x.porciento).toBe(100)
    }
    const no = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: false } }])
    for (const x of no) expect(x.logrado).toBe(0)
  })

  it('con puntaje parcial (checklist con puntos por opción) el responsable gana su parte proporcional', () => {
    const items = [{
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 60,
      opciones: [{ id: 'a', responsable: 'Ana', puntos: 3 }, { id: 'b', responsable: 'Ana', puntos: 1 }, { id: 'c', responsable: 'Beto', puntos: 2 }],
      responsables: ['Ana', 'Beto']
    }]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { selected: ['a'] } }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    expect(ana.posible).toBeCloseTo(30, 2)
    expect(ana.logrado).toBeCloseTo(15, 2) // 3/6 de la proporción → 30 × 0.5
    expect(ana.porciento).toBe(50)
    expect(beto.porciento).toBe(50)
  })

  it('proporcionItem del plano es la proporción de pines que cumplen (11/15 = 73.33%)', () => {
    const puntos = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `ok${i}`, planoId: 'p1', x: 0.1, y: 0.1, cumple: true, comentario: '' })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `no${i}`, planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: '' }))
    ]
    expect(proporcionItem({ tipo: 'PLANO_XY' }, { planos: [], puntos })).toBeCloseTo(11 / 15, 6)
    expect(valorBinario({ tipo: 'PLANO_XY' }, { planos: [], puntos })).toBe(false)
    // Un pin sin veredicto no cuenta: 11 de 11 cumple.
    expect(proporcionItem({ tipo: 'PLANO_XY' }, { planos: [], puntos: [...puntos.slice(0, 11), { id: 'x', planoId: 'p1', x: 0.9, y: 0.9, cumple: null, comentario: '' }] })).toBe(1)
    expect(proporcionItem({ tipo: 'PLANO_XY' }, { planos: [], puntos: [] })).toBe(null)
    expect(proporcionItem({ tipo: 'PLANO_XY' }, { planos: [], puntos, informativo: true })).toBe(null)
  })

  it('plano: cada pin no cumplido es una falla del responsable elegido', () => {
    const puntos = [
      { id: 'a', planoId: 'p1', x: 0.1, y: 0.1, cumple: false, comentario: '' },
      { id: 'b', planoId: 'p1', x: 0.2, y: 0.2, cumple: true, comentario: '' },
      { id: 'c', planoId: 'p1', x: 0.3, y: 0.3, cumple: false, comentario: '' }
    ]
    const v = { planos: [], puntos, responsables: ['Caro', 'Dani'] }
    expect(incumplimientosPorResponsable({ tipo: 'PLANO_XY' }, v)).toEqual([
      { responsable: 'Caro', puntos: 2 },
      { responsable: 'Dani', puntos: 2 }
    ])
    // Sin selección va al gerente.
    expect(incumplimientosPorResponsable({ tipo: 'PLANO_XY' }, { ...v, responsables: [], responsablesGerente: 'Elena' })).toEqual([
      { responsable: 'Elena', puntos: 2 }
    ])
    // Todo cumple → sin fallas.
    expect(incumplimientosPorResponsable({ tipo: 'PLANO_XY' }, { planos: [], puntos: [puntos[1]] })).toEqual([])
  })

  it('plano: reparte el peso según la proporción de puntos que cumplen', () => {
    // 11 pines cumplen de 15 → 73.33% del ítem. La parte cumplida se reparte entre
    // los responsables configurados; la fallada la absorbe la selección.
    const items = [{ id: 'i1', tipo: 'PLANO_XY', puntaje: 30, responsables: ['Ana', 'Beto'] }]
    const valor = {
      planos: [{ id: 'p1', nombre: 'Planta baja', paths: ['ev/1/x.jpg'] }],
      puntos: [
        ...Array.from({ length: 11 }, (_, i) => ({ id: `ok${i}`, planoId: 'p1', x: 0.1, y: 0.1, cumple: true, comentario: '' })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `no${i}`, planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: 'x' }))
      ],
      responsables: ['Caro']
    }
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor }])
    const por = Object.fromEntries(v.map((x) => [x.responsable, x]))
    // 30 × 11/15 = 22 logrado (11 a Ana + 11 a Beto); la parte caída (8) es posible de Caro.
    expect(por['Ana'].logrado).toBeCloseTo(11, 1)
    expect(por['Beto'].logrado).toBeCloseTo(11, 1)
    expect(por['Ana'].porciento).toBe(100)
    expect(por['Caro'].logrado).toBe(0)
    expect(por['Caro'].porciento).toBe(0)
    // El posible total reconstruye el peso del ítem.
    expect(v.reduce((a, x) => a + x.posible, 0)).toBeCloseTo(30, 1)
  })

  it('plano: los pines sin veredicto no cuentan y sin marcado no puntúa', () => {
    const items = [{ id: 'i1', tipo: 'PLANO_XY', puntaje: 30, responsables: ['Ana'] }]
    const soloSinMarcar = valorPorResponsable(items, [
      { item_id: 'i1', valor: { planos: [], puntos: [{ id: 'a', planoId: 'p1', x: 0.1, y: 0.1, cumple: null, comentario: '' }] } }
    ])
    expect(soloSinMarcar).toEqual([])
    const parte = valorPorResponsable(items, [
      {
        item_id: 'i1',
        valor: {
          planos: [],
          puntos: [
            { id: 'a', planoId: 'p1', x: 0.1, y: 0.1, cumple: true, comentario: '' },
            { id: 'b', planoId: 'p1', x: 0.2, y: 0.2, cumple: null, comentario: '' }
          ]
        }
      }
    ])
    // 1 de 1 cumple → 100%, aunque haya un pin sin marcar.
    expect(parte[0].porciento).toBe(100)
  })

  it('ítems sin responsables o sin puntaje no generan valor', () => {
    const v = valorPorResponsable([
      { id: 'a', tipo: 'CHECKLIST', puntaje: 25, opciones: [] },
      { id: 'b', tipo: 'CHECKLIST', puntaje: 0, opciones: [{ id: 'x', responsable: 'Ana' }] },
      { id: 'c', tipo: 'CONTENEDOR', puntaje: 60, responsables: ['Ana'] }
    ])
    expect(v).toEqual([])
  })

  it('si ningún check tiene responsable, usa la lista del ítem', () => {
    const v = valorPorResponsable([
      { id: 'a', tipo: 'CHECKLIST', puntaje: 10, opciones: [{ id: 'x' }], responsables: ['Ana', 'Beto'] }
    ])
    expect(v.map((x) => x.posible)).toEqual([5, 5])
  })

  it('Pablo: 52.4 logrado sobre 67.3 posible = 77.86%', () => {
    // Cada responsable cubre su participación al 100%: % = logrado ÷ posible.
    const items = [{
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 67.3,
      responsables: ['Pablo'],
      opciones: [
        { id: 'a', puntos: 14.9, responsable: 'Pablo' },
        { id: 'b', puntos: 52.4, responsable: 'Pablo' }
      ]
    }]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { selected: ['b'] } }])
    const pablo = v.find((x) => x.responsable === 'Pablo')!
    expect(pablo.posible).toBe(67.3)
    expect(pablo.logrado).toBeCloseTo(52.4, 2)
    expect(pablo.porciento).toBe(77.86)
  })
})

describe('valorPorResponsable · selección de responsables del evaluador (fallas)', () => {
  const itemCon = (id: string, tipo: string, puntaje: number, participantes: string[]) => ({
    id,
    tipo,
    puntaje,
    opciones: participantes.map((p) => ({ id: `o-${id}-${p}`, responsable: p })),
    responsables: participantes
  })

  it('punto cumplido: reparto legado entre los configurados (la selección no acredita mérito)', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto', 'Caro'])]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: true, responsablesGerente: 'Gerente' } }])
    expect(v.map((x) => x.responsable).sort()).toEqual(['Ana', 'Beto', 'Caro'])
    for (const x of v) {
      expect(x.posible).toBeCloseTo(25 / 3, 2)
      expect(x.logrado).toBeCloseTo(25 / 3, 2)
    }
    expect(v.some((x) => x.responsable === 'Gerente')).toBe(false)
  })

  it('punto incumplido sin selección: el punto fallado queda para el gerente', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto'])]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: false, responsablesGerente: 'Gerente' } }])
    const ger = v.find((x) => x.responsable === 'Gerente')!
    expect(ger.posible).toBe(25)
    expect(ger.logrado).toBe(0)
    expect(v).toHaveLength(1)
  })

  it('punto incumplido con selección múltiple: cada elegido absorbe el punto fallado (puede superar el 100% del módulo)', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto', 'Caro'])]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: false, responsables: ['Ana', 'Beto'], responsablesGerente: 'Gerente' } }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    const caro = v.find((x) => x.responsable === 'Caro')
    expect(ana.posible).toBe(25) // punto fallado COMPLETO, no share
    expect(ana.logrado).toBe(0)
    expect(beto.posible).toBe(25)
    expect(beto.logrado).toBe(0)
    expect(v.reduce((a, x) => a + x.posible, 0)).toBe(50) // > 100% del módulo
    expect(caro).toBeUndefined() // no elegido no carga la falla
    expect(ana.items).toBe(1)
  })

  it('punto incumplido sin selección ni gerente (responsablesGerente null) cae al reparto legado', () => {
    const items = [itemCon('i1', 'CUMPLE_NO_CUMPLE', 24, ['Ana', 'Beto'])]
    const v = valorPorResponsable(items, [{ item_id: 'i1', valor: { value: false, responsablesGerente: null } }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    expect(ana.posible).toBe(12)
    expect(ana.logrado).toBe(0)
    expect(beto.posible).toBe(12)
    expect(beto.logrado).toBe(0)
  })

  it('modo por check: checks cumplidos en legado; checks incumplidos absorbidos por la selección', () => {
    const item = {
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 60,
      opciones: [
        { id: 'a', responsable: 'Ana', puntos: 3 },
        { id: 'b', responsable: 'Beto', puntos: 1 },
        { id: 'c', responsable: 'Caro', puntos: 2 }
      ],
      responsables: ['Ana', 'Beto', 'Caro']
    }
    // a cumplida → Ana 30 (60×3/6) logrado; b fallada y elegida → Beto 10 logrado 0;
    // c fallada sin elección → gerente 20 logrado 0.
    const v = valorPorResponsable([item], [{
      item_id: 'i1',
      valor: { selected: ['a'], responsablesPorOpcion: { b: ['Beto'] }, responsablesGerente: 'Gerente' }
    }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    const ger = v.find((x) => x.responsable === 'Gerente')!
    const caro = v.find((x) => x.responsable === 'Caro')
    expect(ana.posible).toBeCloseTo(30, 2)
    expect(ana.logrado).toBeCloseTo(30, 2)
    expect(beto.posible).toBeCloseTo(10, 2)
    expect(beto.logrado).toBe(0)
    expect(ger.posible).toBeCloseTo(20, 2)
    expect(ger.logrado).toBe(0)
    expect(caro).toBeUndefined()
    expect(v.reduce((a, x) => a + x.posible, 0)).toBeCloseTo(60, 1) // reconstruye los puntos del módulo
  })

  it('checklist binario (sin puntos por opción): cada check incumplido pesa P/n y absorbe la selección', () => {
    const item = {
      id: 'i1',
      tipo: 'CHECKLIST',
      puntaje: 40,
      opciones: [
        { id: 'a', responsable: 'Ana' },
        { id: 'b', responsable: 'Beto' }
      ],
      responsables: ['Ana', 'Beto']
    }
    // a cumplida → Ana 20 (40/2); b fallada y elegida → Beto 20 logrado 0.
    const v = valorPorResponsable([item], [{
      item_id: 'i1',
      valor: { selected: ['a'], responsablesPorOpcion: { b: ['Beto'] }, responsablesGerente: 'Gerente' }
    }])
    const ana = v.find((x) => x.responsable === 'Ana')!
    const beto = v.find((x) => x.responsable === 'Beto')!
    expect(ana.posible).toBeCloseTo(20, 2)
    expect(ana.logrado).toBeCloseTo(20, 2)
    expect(beto.posible).toBeCloseTo(20, 2)
    expect(beto.logrado).toBe(0)
  })

  it('retrocompatibilidad: valores del modelo viejo (sin campos nuevos) mantienen el reparto legado', () => {
    const items = [
      itemCon('i1', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto']),
      itemCon('i2', 'CUMPLE_NO_CUMPLE', 25, ['Ana', 'Beto'])
    ]
    const v = valorPorResponsable(items, [
      { item_id: 'i1', valor: { value: true } },
      { item_id: 'i2', valor: { value: true } }
    ])
    const ana = v.find((x) => x.responsable === 'Ana')!
    expect(ana.posible).toBeCloseTo(25, 2) // 12.5 + 12.5
    expect(ana.logrado).toBeCloseTo(25, 2)
    expect(ana.items).toBe(2)
  })

  it('LISTA_COLABORADORES: cada trabajador que falla un check absorbe el peso con sus responsables', () => {
    const item = {
      id: 'i1',
      tipo: 'LISTA_COLABORADORES',
      puntaje: 50,
      opciones: [{ id: 'a', responsable: 'Ana' }, { id: 'b', responsable: 'Beto' }],
      responsables: ['Ana', 'Beto']
    }
    const col = (selected: string[], rp?: Record<string, string[]>) => ({
      dni: selected.length, name: 'A', lastname: 'B', active: true, aplica: true, selected,
      ...(rp ? { responsablesPorOpcion: rp } : {})
    })
    // 'a' cumplida por ambos → Ana 25 logrado (legado). 'b' fallada por ambos: el
    // primero la atribuyó a Caro, el segundo no eligió → gerente 25.
    const v = {
      colaboradores: [col(['a'], { b: ['Caro'] }), col(['a'])],
      responsablesGerente: 'Gerente'
    }
    const res = valorPorResponsable([item], [{ item_id: 'i1', valor: v }])
    const ana = res.find((x) => x.responsable === 'Ana')!
    const caro = res.find((x) => x.responsable === 'Caro')!
    const ger = res.find((x) => x.responsable === 'Gerente')!
    expect(ana.posible).toBeCloseTo(25, 2)
    expect(ana.logrado).toBeCloseTo(25, 2)
    expect(caro.posible).toBeCloseTo(25, 2)
    expect(caro.logrado).toBe(0)
    expect(ger.posible).toBeCloseTo(25, 2)
    expect(ger.logrado).toBe(0)
    expect(res.find((x) => x.responsable === 'Beto')).toBeUndefined()
  })

  it('LISTA_COLABORADORES legado: la selección del ítem absorbe la falla del punto una sola vez', () => {
    const item = {
      id: 'i1',
      tipo: 'LISTA_COLABORADORES',
      puntaje: 50,
      opciones: [{ id: 'a', responsable: 'Ana' }, { id: 'b', responsable: 'Beto' }],
      responsables: ['Ana', 'Beto']
    }
    const col = (selected: string[]) => ({ dni: 1, name: 'A', lastname: 'B', active: true, aplica: true, selected })
    // Modelo viejo: selección a nivel de ítem. Ambos fallaron 'b' → la falla del punto se absorbe UNA vez (Beto).
    const v = { colaboradores: [col(['a']), col(['a'])], responsablesPorOpcion: { b: ['Beto'] }, responsablesGerente: 'Gerente' }
    const res = valorPorResponsable([item], [{ item_id: 'i1', valor: v }])
    const ana = res.find((x) => x.responsable === 'Ana')!
    const beto = res.find((x) => x.responsable === 'Beto')!
    expect(ana.posible).toBeCloseTo(25, 2)
    expect(ana.logrado).toBeCloseTo(25, 2)
    expect(beto.posible).toBeCloseTo(25, 2)
    expect(beto.logrado).toBe(0)
    expect(res.find((x) => x.responsable === 'Gerente')).toBeUndefined()
  })
})

describe('fallasDeResponsable · qué ítems y checks le costaron los puntos', () => {
  const itemChecklist = (puntaje: number, opciones: { id: string; etiqueta: string; responsable?: string }[]) => ({
    id: 'i1',
    tipo: 'CHECKLIST',
    texto: 'Higiene de la tienda',
    modulo_id: 'm1',
    puntaje,
    opciones
  })

  it('lista los ítems donde perdió puntos, del que más cuesta al que menos', () => {
    // Cada ítem tiene un check cumplido y otro fallado: un checklist sin nada
    // tildado es "sin respuesta" y no computa para nadie.
    const opciones = [
      { id: 'a', etiqueta: 'Cumplido', responsable: 'Ana' },
      { id: 'b', etiqueta: 'Fallado', responsable: 'Ana' }
    ]
    const items = [
      { id: 'i1', tipo: 'CHECKLIST', texto: 'Poco peso', modulo_id: 'm1', puntaje: 4, opciones },
      { id: 'i2', tipo: 'CHECKLIST', texto: 'Mucho peso', modulo_id: 'm2', puntaje: 20, opciones }
    ]
    const fallas = fallasDeResponsable('Ana', items, [
      { item_id: 'i1', valor: { selected: ['a'] } },
      { item_id: 'i2', valor: { selected: ['a'] } }
    ])
    expect(fallas.map((f) => f.texto)).toEqual(['Mucho peso', 'Poco peso'])
    // Sin `puntos` por opción el checklist es todo o nada: un check fallado se
    // come el ítem entero, no la mitad.
    expect(fallas.map((f) => f.perdidos)).toEqual([20, 4])
    expect(fallas[0].modulo_id).toBe('m2')
  })

  it('nombra los checks concretos que fallaron', () => {
    const items = [itemChecklist(12, [
      { id: 'a', etiqueta: 'Piso limpio', responsable: 'Ana' },
      { id: 'b', etiqueta: 'Caja cerrada', responsable: 'Ana' },
      { id: 'c', etiqueta: 'Luz encendida', responsable: 'Beto' }
    ])]
    const fallas = fallasDeResponsable('Ana', items, [{ item_id: 'i1', valor: { selected: ['b'] } }])
    expect(fallas).toHaveLength(1)
    expect(fallas[0].checks).toEqual(['Piso limpio'])
  })

  it('solo muestra los checks atribuidos a ese responsable, no los del ítem entero', () => {
    // Ana y Beto cargan el mismo check fallado. Ana no puede ver en su modal el
    // check que le pertenece a Beto: ahí están los 6 puntos de Beto, no los suyos.
    const items = [itemChecklist(12, [
      { id: 'a', etiqueta: 'Refrigeración', responsable: 'Ana' },
      { id: 'b', etiqueta: 'Señalización', responsable: 'Beto' },
      { id: 'c', etiqueta: 'Puerta cerrada', responsable: 'Ana' }
    ])]
    const conAna = fallasDeResponsable('Ana', items, [{ item_id: 'i1', valor: { selected: ['c'] } }])
    const conBeto = fallasDeResponsable('Beto', items, [{ item_id: 'i1', valor: { selected: ['c'] } }])
    expect(conAna[0].checks).toEqual(['Refrigeración'])
    expect(conBeto[0].checks).toEqual(['Señalización'])
  })

  it('los puntos perdidos son los mismos que el posible menos lo logrado', () => {
    // Si el modal dice otra cosa que la tarjeta, los dos números pierden
    // credibilidad. LaTarjeta calcula con valorPorResponsable; acá se comprueba
    // que fallasDeResponsable llegue al mismo perdido.
    const items = [itemChecklist(20, [{ id: 'a', etiqueta: 'Limpio', responsable: 'Ana' }])]
    const respuestas = [{ item_id: 'i1', valor: { selected: [], responsablesPorOpcion: { a: ['Ana'] } } }]
    const valor = valorPorResponsable(items, respuestas).find((v) => v.responsable === 'Ana')!
    const fallas = fallasDeResponsable('Ana', items, respuestas)
    expect(fallas[0].perdidos).toBe(redondear3(valor.posible - valor.logrado))
  })

  it('con la selección del evaluador carga el punto completo del check fallado', () => {
    // El modelo nuevo: el check fallado lo absorbe el responsable elegido, así
    // que pierde el 100% de su parte y no una fracción.
    const items = [itemChecklist(12, [
      { id: 'a', etiqueta: 'Uno', responsable: 'Ana' },
      { id: 'b', etiqueta: 'Dos', responsable: 'Ana' }
    ])]
    const fallas = fallasDeResponsable('Ana', items, [
      { item_id: 'i1', valor: { selected: ['b'], responsablesPorOpcion: { a: ['Ana'] } } }
    ])
    // 12 repartidos en dos checks = 6 cada uno; Ana carga el fallado entero.
    expect(fallas[0].perdidos).toBe(6)
    expect(fallas[0].checks).toEqual(['Uno'])
  })

  it('un check que la sucursal no tiene no aparece en el modal', () => {
    // `aplicarOpciones` borra las opciones que no aplican antes de llegar acá, así
    // que el modal no puede nombrar un punto que el evaluador nunca vio.
    const items = [itemChecklist(12, [{ id: 'a', etiqueta: 'Solo aplica', responsable: 'Ana' }])]
    const fallas = fallasDeResponsable('Ana', items, [{ item_id: 'i1', valor: { selected: [], informativos: ['a'] } }])
    expect(fallas).toEqual([])
  })

  it('un responsable que solo cumplió no aparece', () => {
    const items = [itemChecklist(12, [{ id: 'a', etiqueta: 'Limpio', responsable: 'Ana' }])]
    expect(fallasDeResponsable('Ana', items, [{ item_id: 'i1', valor: { selected: ['a'] } }])).toEqual([])
  })

  it('los ítems binarios sin checks nombrados no inventan un detalle', () => {
    const items = [{ id: 'i1', tipo: 'CUMPLE_NO_CUMPLE', texto: 'Salida de emergencia', modulo_id: 'm1', puntaje: 10 }]
    const fallas = fallasDeResponsable('Ana', items, [
      { item_id: 'i1', valor: { value: false, responsables: ['Ana'] } }
    ])
    expect(fallas).toHaveLength(1)
    expect(fallas[0].checks).toEqual([])
    expect(fallas[0].perdidos).toBe(10)
  })

  it('cada check se nombra una sola vez aunque se repita en varias respuestas', () => {
    const items = [itemChecklist(12, [
      { id: 'a', etiqueta: 'Piso', responsable: 'Ana' },
      { id: 'b', etiqueta: 'Techo', responsable: 'Ana' }
    ])]
    const fallas = fallasDeResponsable('Ana', items, [
      { item_id: 'i1', instancia_id: null, valor: { selected: ['b'] } },
      { item_id: 'i1', instancia_id: 'r2', valor: { selected: ['b'] } }
    ])
    expect(fallas).toHaveLength(1)
    expect(fallas[0].checks).toEqual(['Piso'])
  })

  it('en la lista de trabajadores nombra el check sin marcar de un trabajador', () => {
    const items = [itemChecklist(12, [{ id: 'a', etiqueta: 'Carnet a la vista', responsable: 'Ana' }])]
    const fallas = fallasDeResponsable('Ana', items, [
      {
        item_id: 'i1',
        valor: {
          colaboradores: [
            { dni: 1, name: 'Pedro', lastname: 'G', role_name: 'Cajero', aplica: true, active: true, selected: [], responsablesPorOpcion: { a: ['Ana'] } }
          ]
        }
      }
    ])
    expect(fallas[0].checks).toEqual(['Carnet a la vista'])
  })

  it('un trabajador sin revisar no genera falla: no se registró nada de él', () => {
    const items = [itemChecklist(12, [{ id: 'a', etiqueta: 'Carnet a la vista', responsable: 'Ana' }])]
    const fallas = fallasDeResponsable('Ana', items, [
      {
        item_id: 'i1',
        valor: { colaboradores: [{ dni: 1, name: 'Pedro', lastname: 'G', role_name: 'Cajero', aplica: true, active: true, selected: [] }] }
      }
    ])
    expect(fallas).toEqual([])
  })
})

describe('incumplimientosPorResponsable · selección de responsables del evaluador (fallas)', () => {
  const itemChecklist = {
    tipo: 'CHECKLIST',
    opciones: [{ id: 'a', etiqueta: 'A', responsable: 'Mecanico' }, { id: 'b', etiqueta: 'B', responsable: 'Chofer' }]
  }

  it('un check fallado con selección por check se atribuye a los responsables elegidos', () => {
    // a no está marcada (fallada); el evaluador la atribuyó a Ana.
    const v = { selected: ['b'], responsablesPorOpcion: { a: ['Ana'] } }
    expect(incumplimientosPorResponsable(itemChecklist, v)).toEqual([{ responsable: 'Ana', puntos: 1 }])
  })

  it('check fallado sin selección y con gerente: el incumplimiento queda para el gerente', () => {
    const v = { selected: ['b'], responsablesPorOpcion: {}, responsablesGerente: 'Gerente' }
    expect(incumplimientosPorResponsable(itemChecklist, v)).toEqual([{ responsable: 'Gerente', puntos: 1 }])
  })

  it('check fallado sin selección, sin gerente y sin modo por check: usa los responsables configurados', () => {
    const v = { selected: ['b'], responsables: ['Ana'] }
    expect(incumplimientosPorResponsable(itemChecklist, v)).toEqual([{ responsable: 'Mecanico', puntos: 1 }])
  })

  it('CUMPLE_NO_CUMPLE fallado con selección: el incumplimiento se atribuye a los elegidos', () => {
    const item = { tipo: 'CUMPLE_NO_CUMPLE' }
    expect(incumplimientosPorResponsable(item, { value: false, responsables: ['Ana'] })).toEqual([{ responsable: 'Ana', puntos: 1 }])
  })

  it('CUMPLE_NO_CUMPLE fallado sin selección con gerente: el incumplimiento queda para el gerente', () => {
    const item = { tipo: 'CUMPLE_NO_CUMPLE' }
    expect(incumplimientosPorResponsable(item, { value: false, responsables: [], responsablesGerente: 'Gerente' })).toEqual([{ responsable: 'Gerente', puntos: 1 }])
  })

  it('CUMPLE_NO_CUMPLE cumplido no genera incumplimientos', () => {
    const item = { tipo: 'CUMPLE_NO_CUMPLE' }
    expect(incumplimientosPorResponsable(item, { value: true, responsables: ['Ana'] })).toEqual([])
  })

  it('CONCILIACION desconciliada con selección: el incumplimiento se atribuye a los elegidos', () => {
    const item = { tipo: 'CONCILIACION', opciones: [{ id: 'a', responsable: 'X' }] }
    const v = { productos: [{ sku: 'A', nombre: null, teorica: 2, fisica: 1 }], responsables: ['Ana'] }
    expect(incumplimientosPorResponsable(item, v)).toEqual([{ responsable: 'Ana', puntos: 1 }])
  })
})