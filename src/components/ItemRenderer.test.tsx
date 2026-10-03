import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ItemRenderer } from './ItemRenderer'
import type { Item } from '../lib/types'

function itemDe(texto: string, repetible?: boolean | null): Item {
  return {
    id: 'it-1',
    modulo_id: 'm1',
    tipo: 'UNIDAD_CHECKLIST',
    texto,
    opciones: [
      { id: 'o1', etiqueta: 'Requerimiento A' },
      { id: 'o2', etiqueta: 'Requerimiento B' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    repetible,
    created_at: ''
  }
}

describe('ItemRenderer · UNIDAD_CHECKLIST repetible', () => {
  it('por defecto (repetible) muestra la caja para agregar varias unidades', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Agregar unidad')
    expect(html).toContain('Valor alfanumérico')
  })

  it('con repetible=false muestra el checklist una sola vez (sin caja de agregar unidad)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Checklist (una sola carga)')
    expect(html).toContain('Requerimiento A')
    expect(html).toContain('Requerimiento B')
    expect(html).not.toContain('Agregar unidad')
    expect(html).not.toContain('Valor alfanumérico')
  })

  it('con repetible=false y selección parcial muestra el estado y sigue sin colapsar por unidad', () => {
    const valor = { unidades: [{ codigo: 'Única', selected: ['o1'] }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('1/2 requerimientos')
    expect(html).toContain('Incompleto')
    expect(html).not.toContain('Agregar unidad')
  })

  it('con repetible=false y checklist completo marca que cumple', () => {
    const valor = { unidades: [{ codigo: 'Única', selected: ['o1', 'o2'] }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('2/2 requerimientos')
    expect(html).toContain('Cumple')
  })
})

function itemPlano(requerido = true): Item {
  return {
    id: 'it-2',
    modulo_id: 'm1',
    tipo: 'PLANO_XY',
    texto: 'Layout del piso de venta',
    opciones: [],
    orden: 0,
    requerido: requerido,
    activo: true,
    puntaje: 20,
    created_at: ''
  }
}

describe('ItemRenderer · Cumplimiento XY (PLANO_XY)', () => {
  it('sin planos cargados pide subir la imagen del layout', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Subí la imagen del layout')
    expect(html).toContain('Elegir imagen')
    // Sin pines marcados el ítem requerido no está completo.
    expect(html).toContain('Obligatorio para enviar la evaluación')
  })

  it('muestra el resumen de pines y la proporción que puntúa (11/15 = 73.33%)', () => {
    const puntos = [
      ...Array.from({ length: 11 }, (_, i) => ({ id: `ok${i}`, planoId: 'p1', x: 0.1, y: 0.1, cumple: true, comentario: `ok ${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `no${i}`, planoId: 'p1', x: 0.5, y: 0.5, cumple: false, comentario: `falta ${i}` }))
    ]
    const valor = { planos: [{ id: 'p1', nombre: 'Planta baja', paths: ['ev/1/a.jpg'] }], puntos }
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('15 puntos')
    expect(html).toContain('11 cumplen')
    expect(html).toContain('4 no cumplen')
    expect(html).toContain('73.33%')
    // Ya hay pines con veredicto: no marca el ítem como obligatorio pendiente.
    expect(html).not.toContain('Obligatorio para enviar la evaluación')
  })

  it('con puntos sin veredicto el ítem requerido sigue pendiente', () => {
    const valor = {
      planos: [{ id: 'p1', nombre: 'Planta baja', paths: ['ev/1/a.jpg'] }],
      puntos: [{ id: 'x', planoId: 'p1', x: 0.4, y: 0.4, cumple: null, comentario: '' }]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemPlano()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Obligatorio para enviar la evaluación')
  })
})

function itemChecklist(): Item {
  return {
    id: 'it-3',
    modulo_id: 'm1',
    tipo: 'CHECKLIST',
    texto: 'Presentación de góndolas',
    opciones: [
      { id: 'o1', etiqueta: 'Góndola de panadería' },
      { id: 'o2', etiqueta: 'Góndola de bebidas' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('ItemRenderer · evidencia fotográfica del checklist', () => {
  it('ofrece la cámara en todas las opciones, también en la que ya está validada', () => {
    const valor = { selected: ['o1'], informativos: [], evidencias: {} }
    const html = renderToStaticMarkup(<ItemRenderer item={itemChecklist()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Punto validado')
    expect(html.split('Tomar foto de evidencia').length - 1).toBe(2)
  })

  it('también con el punto sin cumplir', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemChecklist()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html.split('Tomar foto de evidencia').length - 1).toBe(2)
  })
})

function itemConciliacion(contraDato?: 'SOH' | 'FINAL_BASE'): Item {
  return {
    id: 'it-4',
    modulo_id: 'm1',
    tipo: 'CONCILIACION',
    texto: 'Concilia stock contra el sistema',
    opciones: [],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    contra_dato: contraDato,
    created_at: ''
  }
}

describe('ItemRenderer · conciliación (contra dato del ítem)', () => {
  it('no muestra el selector de contra dato en la evaluación (se configura al crear el ítem)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).not.toContain('Calcular contra')
  })

  it('sin contra dato configurado usa SOH por defecto (etiqueta Teórica SOH)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Teórica (SOH)')
    expect(html).toContain('Física')
  })

  it('con contra dato FINAL_BASE el campo teórica se etiqueta como precio', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion('FINAL_BASE')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Teórica (precio)')
  })
})

function itemColaboradores(): Item {
  return {
    id: 'it-5',
    modulo_id: 'm1',
    tipo: 'LISTA_COLABORADORES',
    texto: 'Checklist por colaborador',
    opciones: [{ id: 'o1', etiqueta: 'Contrato vigente' }],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('ItemRenderer · limpiar lista de colaboradores', () => {
  it('ofrece el botón «Limpiar lista» cuando hay colaboradores cargados', () => {
    const valor = {
      colaboradores: [
        { dni: 1, nationality: 'V-', name: 'Ana', lastname: 'Gómez', role_id: 1, role_name: 'Cajera', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] }
      ]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Limpiar lista')
    expect(html).toContain('Colaboradores de la tienda')
  })

  it('sin colaboradores carga­dos solo muestra «Cargar colaboradores», sin botón de limpiar', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemColaboradores()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Cargar colaboradores')
    expect(html).not.toContain('Limpiar lista')
  })

  it('el buscador queda fijo al hacer scroll (no se pierde con la lista larga)', () => {
    const valor = {
      colaboradores: [
        { dni: 1, nationality: 'V-', name: 'Ana', lastname: 'Gómez', role_id: 1, role_name: 'Cajera', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] }
      ]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />)
    // El buscador se pega debajo de la cabecera sticky del layout: sticky + top-16,
    // con fondo blanco opaco para tapar el contenido que pasa por debajo. El div
    // sticky envuelve al input, así que tiene que estar antes del placeholder.
    const posSticky = html.indexOf('sticky top-16 z-20 -mx-4')
    expect(posSticky).toBeGreaterThan(-1)
    expect(html.indexOf('Buscar por documento')).toBeGreaterThan(posSticky)
    expect(html.slice(posSticky, html.indexOf('Buscar por documento'))).toMatch(/bg-white/)
  })
})

/**
 * El cableado de "Actualizar listado". El render es de servidor, así que los
 * efectos no corren y la consulta al historial no se dispara: lo que se verifica
 * acá es que las piezas estén conectadas en el orden correcto, que es donde se
 * cuecen los errores silenciosos (se guarda la lista sin combinar, se oculta sin
 * sembrar el estado, etc.).
 */
describe('ItemRenderer · actualizar el listado sin perder lo revisado', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('el botón ya no reemplaza la lista: combina por DNI', () => {
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toMatch(/combinarPorDni\(colaboradores, conHistorial\)/)
    // La asignación directa que rompía todo: todos volvían con `selected: []`.
    expect(src).not.toMatch(/actualizar\(nuevos\)/)
  })

  it(' siembra el estado de la evaluación anterior ANTES de combinar', () => {
    // Si se combinara primero, la lista actual pisaría el historial y el que ya
    // estaba completo quedaría con las casillas vacías.
    const src = fuente('./ItemRenderer.tsx')
    const siembra = src.indexOf('aplicarHistorial(nuevos, historial)')
    const combina = src.indexOf('combinarPorDni(colaboradores, conHistorial)')
    expect(siembra).toBeGreaterThan(-1)
    expect(combina).toBeGreaterThan(-1)
    expect(siembra).toBeLessThan(combina)
  })

  it('pide el historial con sucursal, ítem, fecha y los ids de los checks', () => {
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toContain('estadosCompletosDeEvaluacionesAnteriores(sucursalId, item.id, fechaEvaluacion, idsChecks)')
    // Sin sucursal o sin fecha no hay historial: se ve la lista entera. Por eso
    // los dos props son opcionales y no hay un `!` que rompa el ítem.
    expect(src).toMatch(/sucursalId && fechaEvaluacion\s*\?/)
  })

  it('los ids de los checks van en useMemo, para que el efecto no gire en loop', () => {
    // `(item.opciones ?? [])` crea un `[]` nuevo en cada render cuando el ítem no
    // tiene checklist. Si el efecto dependiera de eso, se dispararía siempre.
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toContain('const opts = useMemo(() => (item.opciones ?? []) as Opcion[], [item.opciones])')
    expect(src).toContain('const idsChecks = useMemo(() => opts.map((o) => o.id), [opts])')
  })

  it('los que ya estaban completos se ocultan al pintar, no al guardar', () => {
    // Si se sacaran del valor guardado, el tablero los contaría como
    // incumplidos y el porcentaje de la tienda se caería.
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toContain('const colaboradoresVisibles = colaboradoresFiltrados.filter((c) => !ocultos.has(c.dni))')
    expect(src).toContain('const ocultos = mostrarResueltos ? new Set<number>() : new Set(resueltosAntes.keys())')
    // Todo lo que guarda la lista pasa por `combinarPorDni`, que no toca a los ocultos.
    expect(src).toContain('actualizar(combinados)')
  })

  it('pregunta antes de descartar a quien ya no está en la tienda', () => {
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toMatch(/if \(perdidos\.length\) \{[\s\S]{0,200}?setPendienteCombinacion/)
    expect(src).toContain('textoConfirmar="Actualizar igual"')
    // Y el botón no es rojo: no se está por borrar, se está aplicando la lista nueva.
    expect(src).toMatch(/textoConfirmar="Actualizar igual"\s*\n\s*variant="secondary"/)
  })

  it('limpiar la lista olvida el historial, para no volver a ocultar a nadie', () => {
    // Si no, al recargar la lista desaparecerían los que el evaluador acababa de
    // marcar, y no podría ver a quién le puso "no aplica".
    const src = fuente('./ItemRenderer.tsx')
    const limpiar = src.slice(src.indexOf('const limpiar = () => {'), src.indexOf('const ocultarResueltos'))
    expect(limpiar).toContain('setResueltosAntes(new Map())')
    expect(limpiar).toContain('setMostrarResueltos(false)')
  })

  it('al volver al ítem se vuelve a ocultar lo que ya estaba completo', () => {
    // El componente se remonta al cambiar de paso y el estado local se pierde.
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toMatch(/useEffect\(\(\) => \{\s*\n\s*void ocultarAunSinCargar\(\)/)
    expect(src).toContain('const ocultarAunSinCargar = async () => {')
    expect(src).toContain('estadosCompletosDeEvaluacionesAnteriores(sucursalId, item.id, fechaEvaluacion, idsChecks)')
    // Y no se vuelve a pedir en cada render.
    expect(src).toContain('historicoPedido.current = true')
  })

  it('el guard del remount no puede depender de resueltosAntes (viene vacío al remontar)', () => {
    // Este fue un bug real: el guard era `colaboradores.some(c =>
    // resueltosAntes.has(c.dni))`, que al remontar es siempre falso porque el mapa
    // arranca vacío. La consulta no se llegaba a hacer nunca y los ocultos
    // reaparecían al volver al ítem.
    const src = fuente('./ItemRenderer.tsx')
    const guard = src.slice(src.indexOf('const ocultarAunSinCargar'), src.indexOf('// Al volver al ítem'))
    expect(guard).toContain('if (!colaboradores.length) return')
    expect(guard).not.toMatch(/resueltosAntes\.has/)
  })

  it('la carga marca el historial como pedido, y limpiarlo lo libera', () => {
    // Si `cargar` no marcara el ref, el efecto de remount haría la misma consulta
    // otra vez apenas se aplicara la lista.
    const src = fuente('./ItemRenderer.tsx')
    const cargar = src.slice(src.indexOf('const cargar = async () => {'), src.indexOf('const marcarAplica'))
    expect(cargar).toContain('historicoPedido.current = true')
    const limpiar = src.slice(src.indexOf('const limpiar = () => {'), src.indexOf('const ocultarResueltos'))
    expect(limpiar).toContain('historicoPedido.current = false')
  })

  it('EvaluarSucursal pasa la sucursal y la fecha en los dos lugares', () => {
    // Si se pasan en un call site y no en el otro, el ítem repetible dentro de
    // una sección se mostraría entero mientras el resto oculta.
    const src = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    const apariciones = src.match(/sucursalId=\{sucursalId\}\s*\n\s*fechaEvaluacion=\{actual\.fecha\}/g)
    expect(apariciones).toHaveLength(2)
  })
})

describe('ItemRenderer · la consulta del historial', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('mira solo evaluaciones anteriores de la misma sucursal', () => {
    const src = fuente('../lib/data/colaboradoresHistorico.ts')
    expect(src).toContain(".eq('sucursal_id', sucursalId)")
    // `lt` y no `ne`: la evaluación de hoy no cuenta.
    expect(src).toContain(".lt('fecha', fechaActual)")
    expect(src).toContain(".order('fecha', { ascending: false })")
  })

  it('trae las respuestas de ese ítem en esas evaluaciones', () => {
    const src = fuente('../lib/data/colaboradoresHistorico.ts')
    expect(src).toContain(".eq('item_id', itemId)")
    expect(src).toContain(".in('evaluacion_id', ids)")
  })

  it('nunca tira: si falla devuelve el mapa vacío', () => {
    // Perder el historial es una molestia; romper la carga del listado deja al
    // evaluador sin poder trabajar.
    const src = fuente('../lib/data/colaboradoresHistorico.ts')
    expect(src).toMatch(/catch \{\s*\n\s*return vacio/)
    expect(src.match(/return vacio/g)?.length).toBeGreaterThan(2)
  })
})