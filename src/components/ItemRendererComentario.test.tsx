// @vitest-environment jsdom
/**
 * Comentario por punto de una lista.
 *
 * Monta `ItemRenderer` de verdad (jsdom + createRoot) sobre el mismo contrato
 * que `EvaluarSucursal.cambiarValor` (el updater se resuelve contra la ref
 * viva; el objeto reemplaza) y escribe en el campo del punto, como lo hace el
 * evaluador.
 *
 * Lo que se verifica es **dónde queda la nota**: cada lista guarda los
 * comentarios en su propio lugar (el ítem, la unidad, el trabajador), porque
 * después los leen el detalle, el PDF y el Excel.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// jsdom no trae IndexedDB y `PhotoCapture` lo abre en un efecto de montaje:
// sin esto la prueba tira un rechazo fuera de banda y contamina el resultado.
import 'fake-indexeddb/auto'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ItemRenderer } from './ItemRenderer'
import type { Item } from '../lib/types'

function itemChecklist(): Item {
  return {
    id: 'it-1',
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

function itemUnidad(): Item {
  return {
    id: 'it-2',
    modulo_id: 'm1',
    tipo: 'UNIDAD_CHECKLIST',
    texto: 'Revisión de la unidad',
    opciones: [
      { id: 'o1', etiqueta: 'Requerimiento A' },
      { id: 'o2', etiqueta: 'Requerimiento B' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    repetible: false,
    created_at: ''
  }
}

function itemColaboradores(): Item {
  return {
    id: 'it-3',
    modulo_id: 'm1',
    tipo: 'LISTA_COLABORADORES',
    texto: 'Checklist por trabajador',
    // Dos puntos: con uno solo, un trabajador con todo tildado queda completo y
    // desaparece de la lista (no hay forma de abrir su checklist).
    opciones: [
      { id: 'o1', etiqueta: 'Contrato vigente' },
      { id: 'o2', etiqueta: 'Uniforme en regla' }
    ],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

/**
 * Réplica del contrato de `cambiarValor`: updater contra la ref, objeto
 * reemplaza. El valor vigente queda en `valorActual`, que se actualiza en el
 * manejador (no durante el render).
 */
let valorActual: unknown = undefined

function Harness({ item, inicial }: { item: Item; inicial: unknown }) {
  const [valor, setValor] = useState(inicial)
  const ref = useRef(inicial)
  const onChange = (v: unknown) => {
    const previo = ref.current
    const next = typeof v === 'function' ? (v as (p: unknown) => unknown)(previo) : v
    ref.current = next
    valorActual = next
    setValor(next)
  }
  return <ItemRenderer item={item} valor={valor} onChange={onChange} index={0} total={1} />
}

let container: HTMLDivElement
let root: Root

async function montar(item: Item, inicial: unknown) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  valorActual = inicial
  await act(async () => {
    root.render(<Harness item={item} inicial={inicial} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

/** El campo de comentario del punto cuyo nombre empieza con `prefijo`. */
function campoDe(prefijo: string): HTMLInputElement {
  const encontrado = [...container.querySelectorAll<HTMLInputElement>('input[aria-label]')].find((campo) =>
    (campo.getAttribute('aria-label') ?? '').startsWith(prefijo)
  )
  if (!encontrado) throw new Error(`No hay campo de comentario para «${prefijo}»`)
  return encontrado
}

/**
 * Escribe en el campo como lo haría el evaluador: React no ve el `value` que
 * pone el test si no se dispara el `input` con el setter nativo del prototipo.
 */
async function escribirEn(campo: HTMLInputElement, texto: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  container?.remove()
})

describe('comentario por punto · check list', () => {
  it('cada punto tiene su campo de comentario', async () => {
    await montar(itemChecklist(), { selected: [], informativos: [], evidencias: {} })
    expect(container.querySelectorAll('input[aria-label^="Comentario del punto"]')).toHaveLength(2)
    await desmontar()
  })

  it('la nota queda en el punto del que se escribió', async () => {
    await montar(itemChecklist(), { selected: [], informativos: [], evidencias: {} })
    await escribirEn(campoDe('Comentario del punto: Góndola de bebidas'), 'falta la mercadería')
    expect(campoDe('Comentario del punto: Góndola de bebidas').value).toBe('falta la mercadería')
    // Y el valor guardado la lleva en el punto, no suelta en cualquier lado.
    expect(valorActual).toMatchObject({
      selected: [],
      comentarios: { o2: 'falta la mercadería' }
    })
    await desmontar()
  })

  it('la nota no se pisa con la de otro punto', async () => {
    await montar(itemChecklist(), { selected: [], informativos: [], evidencias: {} })
    await escribirEn(campoDe('Comentario del punto: Góndola de panadería'), 'al día')
    await escribirEn(campoDe('Comentario del punto: Góndola de bebidas'), 'falta la mercadería')
    expect(campoDe('Comentario del punto: Góndola de panadería').value).toBe('al día')
    expect(campoDe('Comentario del punto: Góndola de bebidas').value).toBe('falta la mercadería')
    expect(valorActual).toMatchObject({
      comentarios: { o1: 'al día', o2: 'falta la mercadería' }
    })
    await desmontar()
  })
})

describe('comentario por punto · unidad check list', () => {
  it('la nota queda en la unidad, no en el ítem', async () => {
    await montar(itemUnidad(), { unidades: [{ codigo: 'Única', selected: [] }] })
    await escribirEn(campoDe('Comentario del punto: Requerimiento A'), 'sin etiqueta de servicio')
    expect(campoDe('Comentario del punto: Requerimiento A').value).toBe('sin etiqueta de servicio')
    expect(valorActual).toMatchObject({
      unidades: [{ codigo: 'Única', comentarios: { o1: 'sin etiqueta de servicio' } }]
    })
    await desmontar()
  })
})

describe('comentario por punto · listado de trabajadores', () => {
  it('la nota queda en el trabajador', async () => {
    const valor = {
      colaboradores: [
        { dni: 1, nationality: 'V-', name: 'Ana', lastname: 'Gómez', role_id: 1, role_name: 'Cajera', branch_id: 1, branch_name: '', admission_date: null, active: true, aplica: true, selected: ['o1'] }
      ]
    }
    await montar(itemColaboradores(), valor)
    // El checklist del trabajador está plegado: primero se abre.
    const abrir = [...container.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Abrir checklist')
    expect(abrir).toBeTruthy()
    await act(async () => {
      abrir!.click()
    })
    await escribirEn(campoDe('Comentario del punto (Gómez Ana)'), 'contrato en la carpeta')
    expect(campoDe('Comentario del punto (Gómez Ana)').value).toBe('contrato en la carpeta')
    expect(valorActual).toMatchObject({
      colaboradores: [{ dni: 1, comentarios: { o1: 'contrato en la carpeta' } }]
    })
    await desmontar()
  })
})
