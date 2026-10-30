// @vitest-environment jsdom
/**
 * Regresión en vivo del bug de los chips de responsables.
 *
 * Monta `ItemRenderer` de verdad (jsdom + createRoot) sobre el mismo contrato
 * que `EvaluarSucursal.cambiarValor` (el updater se resuelve contra la ref
 * viva; el objeto reemplaza) y aprieta el chip, como lo hace el evaluador.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// jsdom no trae IndexedDB y `PhotoCapture` lo abre en un efecto de montaje:
// sin esto la prueba tira un rechazo fuera de banda y contamina el resultado.
import 'fake-indexeddb/auto'
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ItemRenderer } from './ItemRenderer'
import type { Item } from '../lib/types'

const RESP = [
  'Analista de Talento Humano',
  'Coordinador de Reclutamiento y Selección',
  'Gerente de Mercadeo'
]

function itemCumple(responsables: string[]): Item {
  return {
    id: 'it-7',
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'Se Lleva un Control de la Tasa de Rotación Mensual por Abandono en Tienda.',
    opciones: [],
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    responsables,
    created_at: ''
  }
}

/** Réplica del contrato de `cambiarValor`: updater contra la ref, objeto reemplaza. */
function Harness({
  item,
  inicial,
  alListar
}: {
  item: Item
  inicial: unknown
  alListar?: (api: { escribir: (v: unknown) => void; valorDeLaUltimaPintura: () => unknown }) => void
}) {
  const [valor, setValor] = useState(inicial)
  const ref = useRef(inicial)
  const pintura = useRef(inicial)
  pintura.current = valor
  const onChange = (v: unknown) => {
    const previo = ref.current
    const next = typeof v === 'function' ? (v as (p: unknown) => unknown)(previo) : v
    ref.current = next
    setValor(next)
  }
  alListar?.({ escribir: onChange, valorDeLaUltimaPintura: () => pintura.current })
  return <ItemRenderer item={item} valor={valor} onChange={onChange} index={0} total={1} />
}

let container: HTMLDivElement
let root: Root

type Api = { escribir: (v: unknown) => void; valorDeLaUltimaPintura: () => unknown }

async function montar(item: Item, inicial: unknown, alListar?: (api: Api) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Harness item={item} inicial={inicial} alListar={alListar} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

const chips = () =>
  [...container.querySelectorAll('button')].filter((b) => RESP.includes(b.textContent?.trim() ?? ''))
const encendidos = () => chips().filter((b) => b.className.includes('text-white'))
const pie = () => container.textContent ?? ''

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  container?.remove()
})

describe('CUMPLE_NO_CUMPLE · chips de responsables', () => {
  it('arranca con los tres preseleccionados y el aviso de preselección', async () => {
    await montar(itemCumple(RESP), { value: false, evidencias: [] })
    expect(encendidos().map((b) => b.textContent)).toEqual(RESP)
    expect(pie()).toContain('Preseleccionados los 3 responsables de este punto')
    await desmontar()
  })

  it('al destildar uno quedan encendidos los otros dos y se va el aviso', async () => {
    await montar(itemCumple(RESP), { value: false, evidencias: [] })
    await act(async () => {
      chips()[0].click()
    })
    const quedan = encendidos().map((b) => b.textContent)
    expect(quedan).toHaveLength(2)
    expect(quedan).not.toContain(RESP[0])
    expect(pie()).not.toContain('Preseleccionados los 3 responsables')
    await desmontar()
  })

  it('destildar los tres deja el punto sin responsables', async () => {
    await montar(itemCumple(RESP), { value: false, evidencias: [] })
    for (const c of chips()) {
      const target = c
      await act(async () => {
        target.click()
      })
    }
    expect(encendidos()).toHaveLength(0)
    await desmontar()
  })
})

/**
 * EL BUG (regresión).
 *
 * `onChange` de CUMPLE solía ser `{ ...v, responsables: sel }`: un **objeto**
 * armado con el `v` del render. Cualquier otra escritura del mismo ítem hecha
 * con un `v` capturado ANTES del toque (el callback de "Agregar evidencia",
 * que vive segundos mientras se hace la foto) reponía el valor viejo
 * completo… y con él los responsables. El evaluador destildaba uno y volvía a
 * ver los tres encendidos, sin aviso de preselección.
 *
 * Hoy todo escribe como updater `(prev) => next`, que `cambiarValor` resuelve
 * contra el draft vivo: una escritura concurrente compone y no repone nada.
 */
describe('CUMPLE_NO_CUMPLE · escritura concurrente', () => {
  it('una escritura concurrente no repone los responsables destildados', async () => {
    let api: Api | null = null
    // El valor YA trae los tres responsables (confirmados en una pasada
    // anterior): es el estado desde el cual el evaluador destilda uno.
    const guardado = { value: false, evidencias: [], responsables: RESP }
    await montar(itemCumple(RESP), guardado, (a) => {
      api = a
    })
    expect(encendidos()).toHaveLength(3)
    expect(pie()).not.toContain('Preseleccionados')

    // 1) El evaluador destilda el primero.
    await act(async () => {
      chips()[0].click()
    })
    expect(encendidos().map((b) => b.textContent)).toEqual([RESP[1], RESP[2]])

    // 2) Termina la foto que estaba en vuelo. Su callback cerró con un `v`
    //    anterior al toque, pero escribe como updater: quien lo recibe (el
    //    mismo contrato que `cambiarValor`) lo resuelve contra el draft vivo
    //    y compone, en vez de reponer el valor viejo entero.
    await act(async () => {
      api!.escribir((prev: unknown) => ({
        ...(prev as { evidencias: unknown[] }),
        evidencias: [{ photoIds: ['p1'], comentario: '' }]
      }))
    })

    expect(encendidos().map((b) => b.textContent)).toEqual([RESP[1], RESP[2]])
    expect(pie()).not.toContain('Preseleccionados')
    await desmontar()
  })
})
