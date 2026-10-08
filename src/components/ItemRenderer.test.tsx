import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ItemRenderer } from './ItemRenderer'
import { ProgressBar } from './ui'
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

/**
 * El mismo ítem con dos puntos: el mínimo para que un trabajador pueda estar
 * revisado y aun así incompleto. Con un solo punto, cualquier tildes lo deja
 * completo (y por lo tanto oculto), y no se podría ver un check general encendido.
 */
function itemColaboradoresVarios(): Item {
  return {
    ...itemColaboradores(),
    opciones: [
      { id: 'o1', etiqueta: 'Contrato vigente' },
      { id: 'o2', etiqueta: 'Uniforme en regla' }
    ]
  }
}

type Trabajador = {
  dni: number
  nationality: string
  name: string
  lastname: string
  role_id: number
  role_name: string
  branch_id: number
  branch_name: string
  admission_date: string | null
  active: boolean
  aplica: boolean
  selected: string[]
}

/** Fila de trabajador tal como la guarda la lista, con lo importante en false/[] */
function trabajador(dni: number, name: string, lastname: string, extra: Partial<Trabajador> = {}): Trabajador {
  return {
    dni,
    nationality: 'V-',
    name,
    lastname,
    role_id: 1,
    role_name: 'Cajera',
    branch_id: 1,
    branch_name: '',
    admission_date: null,
    active: true,
    aplica: true,
    selected: [],
    ...extra
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
 * La lista se pinta depurada desde el primer render, sin consulta previa.
 *
 * No hay ninguna barra que esperar al volver al ítem: el valor guardado ya trae
 * a quién estaba completo, así que la lista corta aparece de una. Si hubiera que
 * consultar primero, el flash sería mostrar los diez y sacar cinco después.
 *
 * Los tests son de markup, no de source, y esa es la gracia: el depurado es un
 * problema de lo que se pinta en el primer render, y un test que lee el código
 * no lo vería.
 */
describe('ItemRenderer · la lista se pinta depurada desde el primer render', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  /** Con un solo punto en el checklist, Ana está completa: no debería aparecer. */
  const listaGuardada = {
    colaboradores: [
      trabajador(1, 'Ana', 'Gómez', { selected: ['o1'] }),
      trabajador(2, 'Luis', 'Pérez')
    ]
  }

  /**
   * El check general de una fila, tal como sale en el HTML. El nombre está
   * DESPUÉS del input dentro de la fila, así que el último `<input` antes de
   * "Apellido Nombre" es justamente el que busca el test.
   */
  const checkGeneralDe = (html: string, apellido: string): string => {
    const pos = html.indexOf(`${apellido} `)
    expect(pos).toBeGreaterThan(-1)
    const desde = html.lastIndexOf('<input', pos)
    expect(desde).toBeGreaterThan(-1)
    return html.slice(desde, html.indexOf('/>', desde))
  }

  it('con lista guardada la lista se ve de una, sin barra', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} sucursalId="s-1" fechaEvaluacion="2026-03-01" />
    )
    expect(html).toContain('Buscar por documento')
    expect(html).toContain('Pérez Luis')
    expect(html).not.toContain('Creando la consulta')
  })

  it('los que ya tienen todo tildado dejan de aparecer', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} sucursalId="s-1" fechaEvaluacion="2026-03-01" />
    )
    // Se van de la pantalla pero no del valor: sigue en `colaboradores`, que es
    // lo que cuentan el tablero y el puntaje. Acá solo se filtra el pintado.
    expect(html).not.toContain('Gómez')
    expect(html).toContain('Pérez Luis')
  })

  it('sin sucursal ni fecha la lista se ve igual: son opcionales', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={listaGuardada} index={0} total={1} onChange={() => {}} />
    )
    expect(html).toContain('Pérez Luis')
    expect(html).not.toContain('Gómez')
  })

  it('si están todos completos, avisa que no queda nadie por revisar', () => {
    // El `else` de "sin resultados" diría `con “”`, que es mentira: nadie buscó
    // nada, lo que pasó es que ya no hay nada por revisar.
    const valor = { colaboradores: [trabajador(1, 'Ana', 'Gómez', { selected: ['o1'] })] }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    expect(html).toContain('No queda nadie por revisar')
    expect(html).not.toContain('No se encontraron trabajadores')
    expect(html).not.toContain('con “”')
  })

  it('a quien excluyó el evaluador no se le esconde', () => {
    // Es lo único desde la pantalla se lo puede volver a incluir. Esconderlo lo
    // dejaría excluido para siempre, sin manera de revertirlo.
    const valor = { colaboradores: [trabajador(4, 'Ivan', 'Roca', { aplica: false, selected: ['o1'] })] }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    expect(html).toContain('Roca Ivan')
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

  it('el check general está apagado y bloqueado mientras no haya nada tildado', () => {
    // La regla del evaluador: si dentro de la lista no hay nada tildado, el check
    // general del trabajador tiene que estar en false. Y si está deshabilitado no
    // se puede encender a mano, que es justamente lo que no puede pasar.
    const valor = { colaboradores: [trabajador(2, 'Luis', 'Pérez')] }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradores()} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    const check = checkGeneralDe(html, 'Pérez')
    expect(check).toContain('disabled=""')
    expect(check).not.toContain('checked=""')
    expect(check).toContain('Sin nada tildado todavía')
    expect(html).toContain('Sin revisar')
  })

  it('con un punto tildado el check general se enciende solo', () => {
    const valor = { colaboradores: [trabajador(5, 'Marta', 'Sosa', { selected: ['o1'] })] }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradoresVarios()} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    // Está revisada y cuenta, pero le falta `o2`: sigue en la lista, incompleta.
    const check = checkGeneralDe(html, 'Sosa')
    expect(check).toContain('checked=""')
    expect(check).not.toContain('disabled=""')
    expect(check).toContain('title="Cuenta para el puntaje"')
    expect(html).toContain('Incompleto')
  })

  it('a quien se le tildó algo pero está excluido, el check queda apagado y se puede encender', () => {
    // Si estuviera bloqueado no habría manera de reincorporarlo: la exclusión es
    // una decisión que se puede deshacer, por eso solo se bloquea sin revisar.
    const valor = { colaboradores: [trabajador(4, 'Ivan', 'Roca', { aplica: false, selected: ['o1'] })] }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemColaboradoresVarios()} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    const check = checkGeneralDe(html, 'Roca')
    expect(check).not.toContain('checked=""')
    expect(check).not.toContain('disabled=""')
    expect(check).toContain('title="Cuenta para el puntaje"')
  })

  it('si se le desmarca todo, la exclusión se limpia y el primer punto vuelve a encender el check', () => {
    // Sin esto el ciclo queda trabado: excluido → se desmarca todo → se vuelve a
    // tildar y el check general sigue apagado, porque `aplica` seguía en false.
    const src = fuente('./ItemRenderer.tsx')
    const actualizar = src.slice(src.indexOf('const actualizar = (cols'), src.indexOf('const limpiar = () => {'))
    expect(actualizar).toContain('esColaboradorRevisado(c) || c.aplica !== false')
    expect(actualizar).toContain('aplica: true')
    // Y el chequeo del propio botón: nada revisado, nada que tocar.
    expect(src).toContain('checked={c.aplica && revisado}')
    expect(src).toContain('disabled={!revisado}')
    expect(src).toContain('c.dni === dni && revisado ? { ...c, aplica: !c.aplica } : c')
  })

  it('buscar por cédula o nombre revela a los que estaban completos', () => {
    // Ocultar no puede significar perder el acceso: con una búsqueda se pueden
    // volver a ver y revisar. Si no, el único camino para corregir un completo
    // sería limpiar la lista entera.
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toContain('    if (!ocultos.has(c.dni)) return true')
    expect(src).toContain('    return hayBusqueda')
    expect(src).toContain('const ocultosVisibles = colaboradoresFiltrados.length - colaboradoresVisibles.length')
  })

  it('la barra se apaga aunque la consulta de la tienda falle', () => {
    // `setCargando(false)` va antes de los `return` de error a propósito. Si
    // quedara después, con la API caída la lista quedaría reemplazada por una
    // barra girando para siempre y el evaluador no podría trabajar ni ver por qué.
    const src = fuente('./ItemRenderer.tsx')
    const cargar = src.slice(src.indexOf('const cargar = async () => {'), src.indexOf('const marcarAplica'))
    const apaga = cargar.indexOf('setCargando(false)')
    const error = cargar.indexOf('if (r.mensaje)')
    expect(apaga).toBeGreaterThan(-1)
    expect(error).toBeGreaterThan(-1)
    expect(apaga).toBeLessThan(error)
  })

  it('la lista espera a que la barra termine, no solo a que deje de cargar', () => {
    const src = fuente('./ItemRenderer.tsx')
    // El gate del render tiene que ser `barraVisible` y no `hayAlgoQueEsperar`:
    // cuando la consulta responde, `hayAlgoQueEsperar` ya es falso, pero la
    // barra queda llena un instante. Con el otro gate la lista entraría tapando
    // el final de la barra y el 100% nunca se vería.
    expect(src).toContain('useProgresoCarga(hayAlgoQueEsperar)')
    expect(src).toContain('visible: barraVisible')
    expect(src).toMatch(/\{barraVisible \? \(\s*\n\s*<div[^>]*>\s*\n\s*<ProgressBar valorAprox=\{avance\}/)
    expect(src).not.toMatch(/\{hayAlgoQueEsperar \? \(\s*\n\s*<div[^>]*>\s*\n\s*<ProgressBar/)
    // Y la lista no se mezcla mientras `cargar` reemplaza lo que había guardado.
    expect(src).toMatch(/\{!barraVisible && colaboradores\.length \? \(/)
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
 * El cableado de "Actualizar listado". El render es de servidor, así que la
 * consulta al historial no se dispara: lo que se verifica
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
    expect(src).toContain('estadosDeEvaluacionesAnteriores(sucursalId, item.id, fechaEvaluacion, idsChecks)')
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

  it('limpiar vacía la lista entera, ocultos incluidos', () => {
    // No queda ningún registro aparte de "quién estaba completo": el ocultado se
    // deriva del valor, así que al vaciarlo se va todo junto y la próxima carga
    // arranca de cero, sin heredar nada de lo que el evaluador decidió borrar.
    const src = fuente('./ItemRenderer.tsx')
    const limpiar = src.slice(src.indexOf('const limpiar = () => {'), src.indexOf('const aplicarListaCombinada'))
    expect(limpiar).toContain('actualizar([])')
    expect(limpiar).not.toMatch(/historial|resueltosAntes|historicoPedido/i)
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