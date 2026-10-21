import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EvidenciaProducto, ItemRenderer } from './ItemRenderer'
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

describe('ItemRenderer · doble check', () => {
  const conDobleCheck = (repetible?: boolean | null): Item => ({ ...itemDe('Dormis', repetible), tipo: 'CHECKLIST', doble_check: true })

  it('en CHECKLIST muestra las dos marcas de cada punto', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={conDobleCheck()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Existe')
    expect(html).toContain('Correcto')
    expect(html).toContain('Doble check: cada punto se marca')
    // Sin doble check sólo aparece el check simple de "Punto validado".
    const simple = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(simple).not.toContain('Correcto')
  })

  it('sólo con la presencia marcada el punto no se valida', () => {
    const valor = { selected: [], existe: ['o1', 'o2'] }
    const html = renderToStaticMarkup(<ItemRenderer item={conDobleCheck()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Existe, falta el check de correcto')
    expect(html).toContain('no puntúa')
    expect(html).not.toContain('Punto validado')
  })

  it('con las dos marcas el punto queda validado', () => {
    const valor = { selected: ['o1', 'o2'], existe: ['o1', 'o2'] }
    const html = renderToStaticMarkup(<ItemRenderer item={conDobleCheck()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Punto validado')
    expect(html).not.toContain('sin cumplir')
  })

  it('en UNIDAD_CHECKLIST cada unidad carga su propia presencia', () => {
    const valor = { unidades: [{ codigo: 'U1', selected: [], existe: ['o1'] }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis', false)} valor={valor} index={0} total={1} onChange={() => {}} />)
    // Sin doble check en el ítem, la presencia sola no cambia el estado del punto.
    expect(html).not.toContain('Existe, falta el check de correcto')
    expect(html).toContain('sin cumplir')

    const conDoble = renderToStaticMarkup(
      <ItemRenderer item={{ ...itemDe('Dormis', false), doble_check: true }} valor={valor} index={0} total={1} onChange={() => {}} />
    )
    expect(conDoble).toContain('Existe, falta el check de correcto')
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

  it('los datos del producto escaneado muestran el ID de la API junto al resto (sync/SOH/precio)', () => {
    const valor = {
      productos: [{ sku: '7591002000011', nombre: 'Harina De Maiz Pan 1 Kg', teorica: 2, fisica: 1, apiId: 100006130, soh: 3, lastSync: '2026-10-01T10:00:00' }]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} />)
    // El ID es el `id` del JSON de la API (100006130), no el código escaneado.
    expect(html).toContain('ID: 100006130')
    expect(html).not.toContain('ID: 7591002000011')
    expect(html).toContain('Sync:')
    expect(html).toContain('SOH:')
  })

  it('un producto escaneado antes de guardar el ID no inventa uno', () => {
    const valor = {
      productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 2, lastSync: '2026-10-01T10:00:00' }]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).not.toContain('ID:')
    expect(html).toContain('Sync:')
  })

  it('avisa en la fila y al re-escanear cuando el producto ya lo contó otra persona', () => {
    const valor = {
      productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 1, escaneadoPor: 'María' }]
    }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} evaluador="José" />
    )
    // El producto llegó de la nube (lo escaneó el otro evaluador): hay que decirlo,
    // porque es lo que hace falta ver antes de contarlo de nuevo.
    expect(html).toContain('Ya lo contó María')
  })

  it('no reclama el producto que escaneó el propio evaluador', () => {
    const valor = {
      productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 2, escaneadoPor: 'María' }]
    }
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} evaluador="María" />
    )
    expect(html).not.toContain('Ya lo contó')
  })

  it('la lista de productos arranca abierta y la fila muestra cómo va la evidencia de ese SKU', () => {
    const valor = { productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 1 }] }
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('Sin evidencia fotográfica')
    expect(html).toContain('aria-label="Tomar foto de evidencia"')
    expect(html).toContain('aria-label="Adjuntar foto de evidencia desde la galería"')
  })

  it('cuando el producto ya tiene fotos, la fila las abre en el visor', () => {
    const valor = {
      productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 2, fisica: 1, paths: ['ev/eval/item/f1.jpg'] }]
    }
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} />)
    expect(html).toContain('aria-label="Ver evidencia de SKU-1"')
    expect(html).toContain('1 foto de evidencia')
  })

  it('no ofrece evidencia general: la evidencia de la conciliación es por producto', () => {
    const html = renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(html).not.toContain('Evidencia fotográfica')
  })

  it('la evidencia de un producto ofrece cámara y galería, rotulada con su SKU', () => {
    const html = renderToStaticMarkup(
      <EvidenciaProducto sku="SKU-1" photoIds={[]} paths={[]} onChange={() => {}} />
    )
    expect(html).toContain('Evidencia fotográfica · SKU-1')
    expect(html).toContain('aria-label="Tomar foto"')
    expect(html).toContain('aria-label="Adjuntar foto desde la galería"')
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

/**
 * El re-escaneo de un producto que ya está en la conciliación.
 *
 * Hubo un atajo que, ante un SKU ya agregado, reutilizaba la fila guardada sin
 * volver a consultar la API. Ahorraba requests, pero congelaba el `lastSync` (y
 * el SOH, y el precio) en el valor del primer escaneo: el evaluador re-escaneaba
 * a horas de distancia y seguía viendo la fecha vieja mientras la API directa
 * ya reportaba otra. Se verifica sobre el fuente porque el atajo es una
 * cuestión de control de flujo, invisible en el markup del primer render.
 */
describe('ItemRenderer · re-escaneo: la fila guardada no reemplaza la consulta', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('el atajo que congelaba los datos del sistema no existe más', () => {
    const src = fuente('./ItemRenderer.tsx')
    // Si reaparece cualquier rama que haga `return` antes de consultar porque el
    // producto ya estaba en la lista, la fecha de sync vuelve a quedar vieja.
    expect(src).not.toMatch(/ya && ya\.departamento && ya\.apiId != null/)
    expect(src).not.toMatch(/sin volver a pegarle a la API/)
  })

  it('los dos caminos (campo de código y lector de barras) consultan la API', () => {
    const src = fuente('./ItemRenderer.tsx')
    // Uno para Enter/Botón "Buscar", otro para el scanner. Con uno solo faltando,
    // escanear con la cámara seguiría mostrando el lastSync guardado.
    expect(src.match(/await buscarProducto\(codigo, shopId\)/g)).toHaveLength(2)
  })

  it('la respuesta fresca pisa los datos del sistema, pero solo si la API respondió', () => {
    const src = fuente('./ItemRenderer.tsx')
    // Sin nombre, el borrador se conserva intacto: es lo que mantiene usable la
    // conciliación sin conexión, donde re-escanear no puede refrescar nada.
    expect(src).toMatch(/if \(r\.nombre\) \{\s*\n\s*setBorrador\(\(b\) => aplicarResultadoScan\(b, r, contraDato\)\)\s*\n\s*\} else \{\s*\n\s*setInfo\(r\.mensaje/)
    expect(src).toMatch(/soh: r\.soh,\s*\n\s*lastSync: r\.lastSync/)
  })

  it('la fila guardada recién se actualiza al pulsar Agregar', () => {
    const src = fuente('./ItemRenderer.tsx')
    // El re-escaneo refresca el borrador (lo que se ve al escanear); la lista
    // solo cambia cuando se registra la cantidad. Ninguna consulta debe llamar a
    // `actualizar` por su cuenta.
    const desde = src.indexOf('const aplicarCodigo = async')
    const hasta = src.indexOf('const agregar = () => {')
    expect(desde).toBeGreaterThan(-1)
    expect(hasta).toBeGreaterThan(desde)
    expect(src.slice(desde, hasta)).not.toContain('actualizar(')
  })
})

/**
 * El título de cada opción de checklist ("Permiso de Bomberos") vive en una fila
 * `flex-wrap` junto a badges y botones `shrink-0`. Con `flex-1` (= `flex: 1 1 0%`)
 * el hypothetical main size del texto es 0, así que el line breaking lo mete en
 * la línea 1 con todo lo demás y se queda con el residuo: en una fila de 340px
 * medido 17px de ancho, 13 líneas, ~2 letras por línea.
 *
 * Con `flex-auto` el ancho de contenido entra en el cálculo de línea: si no cabe
 * junto a los badges, ellos bajan y el título se lee en horizontal. Se verifica
 * sobre el fuente porque es una cuestión de clases, no de comportamiento.
 */
describe('ItemRenderer · el título de la opción no se parte letra por letra', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('ningún título de opción usa flex-1 (basis 0) en fila con flex-wrap', () => {
    const src = fuente('./ItemRenderer.tsx')
    // Los cuatro títulos de opción. Los `flex-1` que quedan en el archivo están
    // en filas sin `flex-wrap` (donde sí corresponde) o con `truncate`.
    expect(src).not.toMatch(/min-w-0 flex-1 break-words/)
  })

  it('los cuatro títulos usan flex-auto', () => {
    const src = fuente('./ItemRenderer.tsx')
    expect(src.match(/min-w-0 flex-auto break-words/g)).toHaveLength(4)
  })

  it('el label que envuelve el título de colaborador también usa flex-auto', () => {
    const src = fuente('./ItemRenderer.tsx')
    // El label es el hijo directo de la fila: con basis 0 el ancho del texto no
    // llega nunca al line breaking, aunque el span interno esté bien.
    expect(src).not.toMatch(/flex min-w-0 flex-1 cursor-pointer items-center gap-2/)
    expect(src).toMatch(/flex min-w-0 flex-auto cursor-pointer items-center gap-2/)
  })
})

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

  it('el check general muestra la confirmación del evaluador, no se enciende solo', () => {
    // El check es un espejo de `aplica`, que en la carga viene en false y sólo
    // lo mueve `marcarAplica`. Ningún tildado del checklist lo toca.
    const valor = { colaboradores: [trabajador(5, 'Marta', 'Sosa', { aplica: true, selected: ['o1'] })] }
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

  it('carga con todos los puntos tildados y el check general apagado', () => {
    // El flujo es "todo bien salvo lo que destildes": entra completa y el
    // evaluador destilda los puntos que faltan, que es mucho más rápido que
    // tildar treinta casillas de una en una.
    const src = fuente('./ItemRenderer.tsx')
    expect(src).toContain('aplica: false')
    expect(src).toContain('selected: [...idsChecks]')
    // Tildar o destildar un punto no mueve el check general: eso lo decide el
    // evaluador, y hasta que no lo marque el trabajador no entra en el puntaje.
    const desde = src.indexOf('const toggleCheck = (dni: number, opcionId: string) => {')
    const hasta = src.indexOf('const marcarNoAplica', desde)
    expect(desde).toBeGreaterThan(-1)
    expect(src.slice(desde, hasta)).not.toMatch(/aplica: true/)
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

function itemCumple(): Item {
  return {
    id: 'it-3',
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'Senialistica completa',
    opciones: [],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('ItemRenderer · filas heredadas de la nube (sin campos nuevos)', () => {
  // Al reabrir una evaluación desde la nube, la evidencia de CUMPLE llega con
  // `paths` y sin `photoIds` (ver EvidenciaCumple en scoring.ts). El editor no
  // puede romper la pantalla por eso: fue el crash "reading 'length'" en móvil.
  it('una evidencia con paths y sin photoIds no revienta el render', () => {
    const valor = { value: true, evidencias: [{ paths: ['ev/a.jpg'], comentario: 'Foto' }] }
    expect(() =>
      renderToStaticMarkup(<ItemRenderer item={itemCumple()} valor={valor} index={0} total={1} onChange={() => {}} />)
    ).not.toThrow()
  })

  it('una unidad de UNIDAD_CHECKLIST sin `selected` no revienta el render', () => {
    const valor = { unidades: [{ codigo: 'PATIO-01' }] }
    expect(() =>
      renderToStaticMarkup(<ItemRenderer item={itemDe('Dormis')} valor={valor} index={0} total={1} onChange={() => {}} />)
    ).not.toThrow()
  })
})

/**
 * Cuando un punto queda INCUMPLIDO y el ítem tiene responsables configurados,
 * los chips aparecen marcados apenas se despliega el trabajador. Es una
 * preselección de cara al evaluador, no una escritura: hasta que él toca algo no
 * se guarda nada, porque escribir solo al montar encendía la casilla de "cuenta
 * para el puntaje" junto al nombre y podía hacer desaparecer la fila entera.
 */
describe('ItemRenderer · los responsables se preseleccionan sin escribir nada', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('no tiene efectos: el montaje no dispara onChange', () => {
    const src = fuente('./WidgetsEvaluacion.tsx')
    // El error original era un `useEffect` que llamaba a `onChange` al montar.
    // Sin efectos no hay nada que correr en ese commit, ni carrera que resolver.
    expect(src).not.toMatch(/useEffect/)
    expect(src).not.toMatch(/useRef/)
    // Ningún `onChange` con el arreglo completo del ítem: ése era el que
    // convertía la preselección en dato guardado sin que nadie lo pidiera.
    expect(src).not.toMatch(/onChange\(\[\.\.\.responsables\]\)/)
    expect(src).not.toMatch(/onChange\(\[responsables\[0\]\]\)/)
  })

  it('la preselección vive en estado local y sólo mientras siga sin tocar', () => {
    const src = fuente('./WidgetsEvaluacion.tsx')
    expect(src).toMatch(/const \[tocado, setTocado\] = useState\(false\)/)
    // Las tres condiciones juntas: una cosa es que haya responsables, otra que
    // el evaluador no haya tocado nada todavía, y otra que no haya elegido a
    // nadie a mano (si eligió, su elección manda).
    expect(src).toMatch(/const preseleccionando = !tocado && seleccion\.length === 0 && responsables\.length > 0/)
    expect(src).toMatch(/const elegidos = preseleccionando \? responsables : seleccion/)
  })

  it('el primer toque confirma la preselección entera y le aplica el cambio', () => {
    const src = fuente('./WidgetsEvaluacion.tsx')
    // Comparar y construir contra `elegidos`, no contra `seleccion`: si no, al
    // tocar un chip de la preselección se agregaría el primero encima de una
    // lista vacía en vez de sacarlo.
    expect(src).toMatch(/const existe = elegidos\.includes\(r\)/)
    expect(src).toMatch(/onChange\(existe \? elegidos\.filter\(\(x\) => x !== r\) : \[\.\.\.elegidos, r\]\)/)
    // Y el toque levanta la bandera ANTES de escribir, para que el mismo render
    // ya no vuelva a preseleccionar.
    expect(src).toMatch(/setTocado\(true\)\s*\n\s*onChange\(existe/)
  })

  it('los chips y el título leen `elegidos`, no el valor crudo', () => {
    const src = fuente('./WidgetsEvaluacion.tsx')
    // Si pintaran con `seleccion` (vacío) los chips se verían apagados pese a
    // estar preseleccionados, que era exactamente la queja original.
    expect(src).toMatch(/title=\{elegidos\.includes\(r\)/)
    expect(src).toMatch(/elegidos\.includes\(r\) \? 'bg-primary text-white'/)
  })

  it('anuncia que es una preselección y cómo confirmarla, con texto por cantidad', () => {
    const src = fuente('./WidgetsEvaluacion.tsx')
    expect(src).toMatch(/\? responsables\.length === 1/)
    // Decir "quedó marcado" sería mentirle: todavía no se guardó nada.
    expect(src).not.toMatch(/Quedaron marcados/)
    expect(src).not.toMatch(/Quedó marcado/)
    expect(src).toMatch(/Preseleccionado: \$\{responsables\[0\]\} es el único responsable/)
    expect(src).toMatch(/Preseleccionados los \$\{responsables\.length\} responsables/)
    expect(src).toMatch(/Tocá el chip para confirmarlo/)
    expect(src).toMatch(/Tocá un chip para confirmar/)
  })

  it('al confirmar responsables no se tilda el punto ni se enciende el check general', () => {
    const src = fuente('./ItemRenderer.tsx')
    const desde = src.indexOf('const marcarResponsables = (dni: number, opcionId: string, rs: string[]) => {')
    const fn = src.slice(desde, src.indexOf('const enCuenta =', desde))
    // Sólo el responsable. Antes también forzaba `aplica` y sumaba la opción a
    // `selected`, y con eso el punto dejaba de estar "sin cumplir" (el panel se
    // escondía solo) y la fila entera podía pasar a "cumple" y desaparecer.
    expect(fn).toContain('responsablesPorOpcion')
    expect(fn).not.toMatch(/aplica: true/)
    expect(fn).not.toMatch(/selected:/)
    expect(fn).not.toMatch(/Array\.from\(new Set/)
  })

  it('los nueve call sites montan el selector sólo cuando el punto está sin cumplir', () => {
    const item = fuente('./ItemRenderer.tsx')
    const plano = fuente('./PlanoEditor.tsx')
    // 9 en ItemRenderer (CUMPLE_NO_CUMPLE, CHECKLIST, LISTA_COLABORADORES,
    // UNIDAD_CHECKLIST, conciliación y el plano heredado) + los tres del doble
    // check (CHECKLIST y las dos ramas de UNIDAD_CHECKLIST) + 1 en PlanoEditor.
    expect(item.match(/<SelectorResponsables/g)).toHaveLength(9)
    expect(plano.match(/<SelectorResponsables/g)).toHaveLength(1)
    // Ninguno debe montar el selector fuera del estado incumplido.
    expect(item).toMatch(/value === false/)
    expect(plano).toMatch(/fallados > 0/)
  })
})

/**
 * Varias escrituras a la vez, un solo snapshot.
 *
 * Un ítem con N selectores de responsables puede escribir N veces en el mismo
 * tick (el evaluador repartiendo fallas a mano sobre varios checks, o varios
 * ítems abiertos a la vez). Si cada escritura se construye desde el `value` del
 * render y se vuelca sobre el `draft` del render, todas se calculan sobre la
 * misma copia vieja y sólo sobrevive la última.
 *
 * Esto se cubre con updaters funcionales que se resuelven contra el draft vivo.
 * La preselección al montar ya no escribe (ver el describe anterior), así que la
 * ráfaga del montaje dejó de existir; el mecanismo queda porque las escrituras
 * del evaluador siguen pudiendo ser varias en el mismo tick.
 *
 * Estas pruebas son de fuente: el proyecto no tiene `@testing-library/react`
 * y el `renderToStaticMarkup` (SSR) no ejecuta `useEffect`.
 */
describe('ItemRenderer · las escrituras simultáneas componen en vez de pisarse', () => {
  const fuente = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

  it('EvaluarSucursal resuelve el updater contra el draft vivo, no contra el del render', () => {
    const src = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    // Base: la ref, que se actualiza síncrona en cada escritura.
    expect(src).toMatch(/const base = draftRef\.current \?\? actual/)
    // Forma funcional: `valor` puede ser `(prev) => next`.
    expect(src).toMatch(/typeof valor === 'function'/)
    expect(src).toMatch(/\(valor as \(p: unknown\) => unknown\)\(previo\)/)
    // El punto de control: si sigue escribiendo desde `actual`, las N opciones
    // siguen compitiendo por el mismo objeto y vuelve la carrera.
    expect(src).not.toMatch(/respuestas: \{ \.\.\.actual\.respuestas/)
  })

  it('Contenido.guardar deja pasar el updater y sólo inyecta el gerente al resultado', () => {
    const src = fuente('./ItemRenderer.tsx')
    // Si `guardar` intentara resolverlo contra `valor` (el del render) se
    // perdería lo que acabaron de marcar las opciones anteriores.
    expect(src).toMatch(/if \(typeof v === 'function'\)/)
    expect(src).toMatch(/onChange\(\(prev: unknown\) => inyectar\(\(v as \(p: unknown\) => unknown\)\(prev\)\)\)/)
  })

  it('los seis puntos multi-responsable escriben como updater', () => {
    const src = fuente('./ItemRenderer.tsx')
    // CHECKLIST: un selector por check (la rama simple y la del doble check).
    // Uno por unidad × check en UNIDAD_CHECKLIST (dos ramas: carga única y
    // repetible, cada una con su versión de doble check).
    expect(src.match(/responsablesPorOpcion: \{ \.\.\.\(base\.responsablesPorOpcion \?\? \{\}\), \[o\.id\]: sel \}/g)).toHaveLength(6)
    expect(src).not.toMatch(/responsablesPorOpcion: \{ \.\.\.\(v\.responsablesPorOpcion/)
    expect(src).not.toMatch(/responsablesPorOpcion: \{ \.\.\.\(value\.responsablesPorOpcion/)
    // LISTA_COLABORADORES: un selector por trabajador × check.
    expect(src).toMatch(/actualizar\(\(prev: ColaboradorItem\[\]\) => ordenarTrabajadores\(prev\)/)
  })

  it('el updater de la lista de colaboradores se resuelve contra prev y no contra v', () => {
    const src = fuente('./ItemRenderer.tsx')
    const actualizar = src.slice(src.indexOf('const actualizar = (cols'), src.indexOf('const limpiar = () => {'))
    expect(actualizar).toMatch(/const lista = typeof cols === 'function' \? cols\(base\.colaboradores \?\? \[\]\) : cols/)
    expect(actualizar).toMatch(/\.\.\.base,/)
    // Si vuelve a escribir `{ ...v, colaboradores: ... }` la carrera regresa.
    expect(actualizar).not.toMatch(/onChange\(\{ \.\.\.v, colaboradores/)
  })

  it('RevisionPreEntrega también resuelve el updater (renderiza el mismo ítem)', () => {
    const src = fuente('../pages/herramientas/RevisionPreEntrega.tsx')
    expect(src).toMatch(/typeof valor === 'function'/)
    expect(src).toMatch(/\[itemId\]: nuevoValor/)
  })

  it('el throttle de IndexedDB no se queda con la primera escritura de la ráfaga', () => {
    const src = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    // Sin el borde de cola, los N auto-marcados del mismo tick escriben en la
    // base local sólo el primero (el incompleto) y al reabrir se pierden.
    expect(src).toMatch(/putLocalTimer\.current = window\.setTimeout/)
    expect(src).toMatch(/if \(d && vivoRef\.current\) void putDraft\(d\)/)
    // Y el timer se limpia al desmontar, junto al de la nube.
    expect(src).toMatch(/if \(putLocalTimer\.current\) window\.clearTimeout\(putLocalTimer\.current\)/)
  })
})

describe('ItemRenderer · la pérdida acumulada se ve mientras se evalúa', () => {
  // Mismo par que usa el detalle: un faltante de 3 y un sobrante de 3.
  const conDescuadre = {
    productos: [
      { sku: 'SKU-FALTA', nombre: 'Faltan unidades', teorica: 10, fisica: 7, finalBase: 12.5 },
      { sku: 'SKU-SOBRA', nombre: 'Sobran unidades', teorica: 2, fisica: 5, finalBase: 2 }
    ]
  }

  const pintar = (item: Item, valor: unknown) =>
    renderToStaticMarkup(<ItemRenderer item={item} valor={valor} index={0} total={1} onChange={() => {}} />)

  it('en SOH muestra la real y la absoluta con los mismos números que el detalle', () => {
    const html = pintar(itemConciliacion(), conDescuadre)
    // Faltantes: 3 × 12,50 = 37,50. Sobrantes: 3 × 2,00 = 6,00.
    // Absoluta = 37,50 + 6,00 = 43,50. Son los mismos números que cierra la
    // evaluación en EvaluacionDetalle: dos pantallas no pueden dar dos verdades.
    expect(html).toContain('Pérdida acumulada')
    expect(html).toContain('USD37,50')
    expect(html).toContain('USD43,50')
    expect(html).toContain('2 de 2 SKU descuadrados')
  })

  it('la absoluta va después de la real: son dos montos, no uno repetido', () => {
    const html = pintar(itemConciliacion(), conDescuadre)
    expect(html.indexOf('USD37,50')).toBeGreaterThan(-1)
    expect(html.indexOf('USD43,50')).toBeGreaterThan(html.indexOf('USD37,50'))
  })

  it('con contra dato por precio no hay PVP con qué valorar y el bloque no aparece', () => {
    const html = pintar(itemConciliacion('FINAL_BASE'), conDescuadre)
    // Un "USD0,00" acá sería una mentira: no es que no se perdió nada, es que
    // en modo precio la pérdida no se calcula en este ítem.
    expect(html).not.toContain('Pérdida acumulada')
    expect(html).not.toContain('USD37,50')
    expect(html).not.toContain('Absoluta')
  })

  it('si nada descuadra se dice «Todo concilia» y va en verde', () => {
    const html = pintar(itemConciliacion(), {
      productos: [{ sku: 'SKU-OK', nombre: 'Pan', teorica: 10, fisica: 10, finalBase: 12.5 }]
    })
    expect(html).toContain('Todo concilia')
    expect(html).toContain('USD0,00')
    expect(html).toContain('bg-green-50')
    expect(html).not.toContain('SKU descuadrados')
  })

  it('un descuadre sin precio base no se pinta de verde: queda en ámbar y fuera del monto', () => {
    const html = pintar(itemConciliacion(), {
      productos: [{ sku: 'SKU-SINPRECIO', nombre: 'Sin precio', teorica: 10, fisica: 7 }]
    })
    // Hay descuadre pero no hay con qué valorarlo: decir "Todo concilia" sería
    // mentir, y pintarlo de rojo implicaría plata perdida que no se puede afirmar.
    expect(html).toContain('1 SKU sin precio base')
    expect(html).toContain('bg-amber-50')
    expect(html).not.toContain('Todo concilia')
    expect(html).toContain('USD0,00')
  })

  it('el bloque cuelga del resumen de la conciliación y sólo en modo SOH', () => {
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    expect(src).toContain("{contraDato === 'SOH' ? <ResumenPerdida productos={productos} /> : null}")
    // Y el cálculo siempre se pide en SOH: nunca en el contra dato del ítem.
    expect(src).toContain("resumenPerdidaConciliacion(productos, 'SOH')")
  })
})

describe('ItemRenderer · Total conciliación = Match / Total SKU', () => {
  const pintar = (valor: unknown) =>
    renderToStaticMarkup(<ItemRenderer item={itemConciliacion()} valor={valor} index={0} total={1} onChange={() => {}} />)

  it('ya no hay «promedio»: el rótulo es Total conciliación', () => {
    const html = pintar({ productos: [{ sku: 'A', nombre: null, teorica: 10, fisica: 10 }] })
    expect(html).toContain('Total conciliación')
    expect(html).not.toContain('Prom. conciliación')
  })

  it('es Match sobre Total SKU: 3 de 4 cuadran dan 75%', () => {
    const html = pintar({
      productos: [
        { sku: 'A', nombre: null, teorica: 10, fisica: 10 },
        { sku: 'B', nombre: null, teorica: 2, fisica: 1 },
        { sku: 'C', nombre: null, teorica: 100, fisica: 100 },
        { sku: 'D', nombre: null, teorica: 100, fisica: 100 }
      ]
    })
    expect(html).toMatch(/75%<\/p><p[^>]*>Total conciliación<\/p>/)
  })

  it('todo cuadrado da 100% y nada cuadrado da 0%', () => {
    const completo = pintar({
      productos: [
        { sku: 'A', nombre: null, teorica: 10, fisica: 10 },
        { sku: 'B', nombre: null, teorica: 0, fisica: 0 }
      ]
    })
    expect(completo).toMatch(/100%<\/p><p[^>]*>Total conciliación<\/p>/)

    const descuadrado = pintar({
      productos: [
        { sku: 'A', nombre: null, teorica: 10, fisica: 9 },
        { sku: 'B', nombre: null, teorica: 10, fisica: 11 }
      ]
    })
    expect(descuadrado).toMatch(/>0%<\/p><p[^>]*>Total conciliación<\/p>/)
  })

  it('el contador Match y el porcentaje leen la misma definición', () => {
    const src = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    expect(src).toContain('const conciliadas = productos.filter(esMatchConciliacion).length')
    expect(src).toContain('const total = totalConciliacion(v)')
    // La tasa de descuadre sigue viva en el detalle y en los indicadores, pero
    // ya no es el número que se muestra acá.
    expect(src).not.toContain('conciliacionTotal')
  })
})

describe('ItemRenderer · toda escritura del valor del ítem es updater', () => {
  // Regresión del bug de los chips de responsables.
  //
  // Las escrituras eran `guardar({ ...v, responsables: sel })`: objetos armados
  // con el `v` del render. Un callback atrasado —el de "Agregar evidencia",
  // que vive segundos mientras se hace la foto— reponía ese `v` viejo completo
  // y con él los responsables que el evaluador recién quitaba: destildaba uno
  // y volvía a ver los encendidos, sin el aviso de preselección.
  //
  // Como updater `(prev) => next` la escritura se resuelve contra el draft
  // vivo (`cambiarValor` en /evaluar, `cambiarRespuesta` en inspección y
  // pre-entrega) y compone: nada puede reponer el valor anterior.
  it('no queda ninguna escritura en forma objeto sobre el valor', () => {
    const fuente = readFileSync(fileURLToPath(new URL('./ItemRenderer.tsx', import.meta.url)), 'utf8')
    expect(fuente).not.toMatch(/guardar\(\{\s*\.\.\.(v|value)\b/)
    expect(fuente).not.toMatch(/onChange\(\{\s*\.\.\.v\b/)
  })

  it('PlanoEditor compone el patch con el draft vivo, no con el `v` del render', () => {
    const fuente = readFileSync(fileURLToPath(new URL('./PlanoEditor.tsx', import.meta.url)), 'utf8')
    expect(fuente).toContain('onChange((prev: unknown) => ({ ...((prev ?? v) as ValorPlano), ...patch }))')
  })
})