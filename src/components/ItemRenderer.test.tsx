import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ItemRenderer } from './ItemRenderer'
import { ProgressBar } from './ui'
import { INICIO_INDETERMINADO, TECHO_INDETERMINADO } from '../lib/progresoCarga'
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
    expect(html).toContain('Completo')
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

  it('con precio ofrece el check de "No tiene hablador"', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion('FINAL_BASE')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('No tiene hablador')
  })

  it('en conciliación de stock no aparece el check (no hay hablador que marcar)', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).not.toContain('No tiene hablador')
  })

  it('el producto marcado sin hablador cae en el contador de No Match del resumen', () => {
    const valor = {
      productos: [
        { sku: 'SKU-OK', nombre: 'Pan', teorica: 1.84, fisica: 1.84 },
        { sku: 'SKU-SIN', nombre: 'Papel', teorica: 2.84, fisica: null, sinHablador: true }
      ]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion('FINAL_BASE')} valor={valor} index={0} total={1} onChange={() => {}} />)
    // Dos escaneados: uno concilia (Match = 1) y el sin hablador cuenta como
    // descuadre (No Match = 1) aunque no tenga precio físico.
    expect(html).toMatch(/>1<\/p><p[^>]*>Match<\/p>/)
    expect(html).toMatch(/>1<\/p><p[^>]*>No Match<\/p>/)
  })
})

function itemColaboradores(): Item {
  return {
    id: 'it-5',
    modulo_id: 'm1',
    tipo: 'LISTA_COLABORADORES',
    texto: 'Checklist por trabajador',
    opciones: [{ id: 'o1', etiqueta: 'Contrato vigente' }],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('ItemRenderer · limpiar lista de trabajadores', () => {
  it('ofrece el botón «Limpiar lista» cuando hay trabajadores cargados', () => {
    const valor = {
      colaboradores: [
        { dni: 1, nationality: 'V-', name: 'Ana', lastname: 'Gómez', role_id: 1, role_name: 'Cajera', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] }
      ]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Limpiar lista')
    expect(html).toContain('Trabajadores de la tienda')
  })

  it('sin trabajadores cargados solo muestra «Cargar trabajadores», sin botón de limpiar', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemColaboradores()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Cargar trabajadores')
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
 * La barra de carga hasta que la lista esté depurada.
 *
 * Estos tests son de markup, no de source, y esa es la gracia: el flash era un
 * problema de lo que se pinta en el primer render, y un test que lee el código no
 * lo vería. Con el valor guardado (el caso de volver al ítem desde otro paso) el
 * primer render tiene que ser la barra y nada de la lista.
 */
describe('ItemRenderer · la lista no aparece sin depurar', () => {
  const listaGuardada = {
    colaboradores: [
      { dni: 1, nationality: 'V-', name: 'Ana', lastname: 'Gómez', role_id: 1, role_name: 'Cajera', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] },
      { dni: 2, nationality: 'V-', name: 'Luis', lastname: 'Pérez', role_id: 2, role_name: 'Cajero', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] }
    ]
  }

  it('con lista guardada, el primer render es la barra y no se ve ningún nombre', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} sucursalId="s-1" fechaEvaluacion="2026-03-01" />
    )
    // Primer render, avance en el arranque: primer mensaje y relleno chico.
    expect(html).toContain('Creando la consulta')
    expect(html).toContain(`width:${INICIO_INDETERMINADO}%`)
    // Lo esencial: todavía no se sabe quién estaba completo, así que no se
    // muestra a nadie. Este es el flash que la barra viene a tapar.
    expect(html).not.toContain('Gómez')
    expect(html).not.toContain('Pérez')
    expect(html).not.toContain('Buscar por documento')
  })

  it('la barra arranca baja, no en un porcentaje que ya parece avance', () => {
    // El complaint original: al abrir el ítem la barra ya estaba en 40%, que se
    // lee como que algo se procesó antes de que el usuario pidiera nada.
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} sucursalId="s-1" fechaEvaluacion="2026-03-01" />
    )
    const ancho = Number(html.match(/width:([\d.]+)%/)?.[1])
    expect(ancho).toBeLessThan(20)
    // Y el avance automático no puede declararse listo solo.
    expect(TECHO_INDETERMINADO).toBeLessThan(100)
  })

  it('sin sucursal no hay nada que esperar y la lista se ve de una', () => {
    // Sin historial que traer, una barra sería una espera falsa.
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} />
    )
    expect(html).toContain('Gómez')
    expect(html).not.toContain('Creando la consulta')
  })

  it('sin fecha tampoco hay nada que esperar', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} sucursalId="s-1" />
    )
    expect(html).toContain('Gómez')
    expect(html).not.toContain('Creando la consulta')
  })

  it('sin lista cargada no hay barra: se ve el botón de cargar', () => {
    // Recién-mounted y vacío: todavía no hay nada que depurar, así que la barra
    // solo taparía el botón que hay que apretar.
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={undefined} index={0} total={1} onChange={() => {}} sucursalId="s-1" fechaEvaluacion="2026-03-01" />
    )
    expect(html).toContain('Cargar trabajadores')
    expect(html).not.toContain('Creando la consulta')
  })

  it('la barra se apaga aunque la consulta de la tienda falle', () => {
    // `setHistorialResuelto(true)` va antes de los `return` de error a
    // propósito. Si quedara después, con la API caída la lista quedaría
    // reemplazada por una barra girando para siempre y el evaluador no podría
    // trabajar ni ver por qué.
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    const cargar = src.slice(src.indexOf('const cargar = async () => {'), src.indexOf('const marcarAplica'))
    const marca = cargar.indexOf('setHistorialResuelto(true)')
    const error = cargar.indexOf('if (r.mensaje)')
    expect(marca).toBeGreaterThan(-1)
    expect(error).toBeGreaterThan(-1)
    expect(marca).toBeLessThan(error)
  })

  it('el pendiente es derivado, no un estado: no se puede quedar girando', () => {
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    // Si `historialPendiente` fuera `useState`, un camino olvidado lo dejaría en
    // true para siempre. Al derivarlo de "hay lista y hay qué consultar y no
    // resolví", no hay estado que olvidar.
    expect(src).toContain('const historialPendiente = !historialResuelto && puedeConsultarHistorial && colaboradores.length > 0')
    expect(src).not.toMatch(/const \[historialPendiente, setHistorialPendiente\] = useState/)
    // Y la lista se esconde con la visibilidad de la barra.
    expect(src).toContain('const hayAlgoQueEsperar = cargando || historialPendiente')
    expect(src).toMatch(/\{!barraVisible && colaboradores\.length \? \(/)
  })

  it('la lista espera a que la barra termine, no solo a que deje de cargar', () => {
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    // El gate del render tiene que ser `barraVisible` y no `hayAlgoQueEsperar`:
    // cuando la consulta responde, `hayAlgoQueEsperar` ya es falso, pero la
    // barra queda llena un instante. Con el otro gate la lista entraría tapando
    // el final de la barra y el 100% nunca se vería.
    expect(src).toContain('useProgresoCarga(hayAlgoQueEsperar)')
    expect(src).toContain('visible: barraVisible')
    expect(src).toMatch(/\{barraVisible \? \(\s*\n\s*<div[^>]*>\s*\n\s*<ProgressBar valorAprox=\{avance\}/)
    expect(src).not.toMatch(/\{hayAlgoQueEsperar \? \(\s*\n\s*<div[^>]*>\s*\n\s*<ProgressBar/)
  })

  it('mientras carga, el aviso de los resueltos tampoco se muestra', () => {
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    expect(src).toMatch(/\{!barraVisible && resueltosAntes\.size \? \(/)
  })
})

describe('ProgressBar · número de adorno vs. número real', () => {
  it('el número de adorno se ve pero no se anuncia', () => {
    const html = renderToStaticMarkup(<ProgressBar valorAprox={37} />)
    expect(html).toContain('width:37%')
    // El avance automático no es un dato real. Anunciarlo por aria-valuenow
    // haría que el lector de pantalla dijera un porcentaje inventado, y encima
    // lo repetiría en cada tick.
    expect(html).not.toContain('aria-valuenow')
    expect(html).toContain('role="progressbar"')
  })

  it('el número real se anuncia', () => {
    const html = renderToStaticMarkup(<ProgressBar value={40} />)
    expect(html).toContain('width:40%')
    expect(html).toContain('aria-valuenow="40"')
  })

  it('apila los valores fuera de rango en vez de romper el ancho', () => {
    expect(renderToStaticMarkup(<ProgressBar value={140} />)).toContain('width:100%')
    expect(renderToStaticMarkup(<ProgressBar valorAprox={-20} />)).toContain('width:0%')
  })

  it('sin número no hay barra que se mueva, pero tampoco se rompe', () => {
    const html = renderToStaticMarkup(<ProgressBar />)
    expect(html).toContain('width:0%')
    expect(html).not.toContain('aria-valuenow')
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
    expect(src).toContain('const colaboradoresVisibles = colaboradoresFiltrados.filter((c) => {')
    expect(src).toContain('    if (!ocultos.has(c.dni)) return true')
    expect(src).toContain('    return hayBusqueda')
    expect(src).toContain('  })')
    // Todo lo que guarda la lista pasa por `combinarPorDni`, que no toca a los ocultos.
    expect(src).toContain('actualizar(combinados)')
  })

  it('pregunta antes de descartar a quien ya no está en la tienda', () => {
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toMatch(/if \(perdidos\.length\) \{[\s\S]{0,400}?setPendienteCombinacion/)
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
    // Los tres cortes van en una sola línea: si falta cualquiera de los tres se
    // consulta al server por nada (o se espera un dato que no existe).
    expect(guard).toContain('if (historicoPedido.current || !puedeConsultarHistorial || !colaboradores.length) return')
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