// @vitest-environment jsdom
/**
 * Regresión doble del selector de equipo.
 *
 *  1. LOS ELEGIDOS SE VEN: los trabajadores sin cuenta sólo entraban a la
 *     lista cuando se los buscaba, así que «Equipo (3)» venía con la lista
 *     mostrando a otros — y destildar hacía desaparecer la fila, con ella
 *     la forma de volver a marcarla.
 *  2. LOS USUARIOS DEL SISTEMA NO APARECEN: los participantes salen SÓLO
 *     de la API de trabajadores (la nómina). La candidatura de `profiles`
 *     se sacó entera del flujo.
 *
 * Monta `SelectorEquipo` de verdad (jsdom + createRoot) con la API mockeada
 * —es la única fuente de candidatos— y aprieta las cosas como lo haría el
 * usuario.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const { buscarMock } = vi.hoisted(() => ({ buscarMock: vi.fn() }))
vi.mock('../lib/data/granCosecha', async (importar) => {
  const original = await importar<typeof import('../lib/data/granCosecha')>()
  return { ...original, listarTrabajadoresEquipo: buscarMock }
})

import { SelectorEquipo } from './GranCosecha'
import type { MiembroEquipo, TrabajadorNomina } from '../lib/data/granCosecha'

/** Los tres integrantes sin cuenta del proyecto de la captura. */
const EQUIPO: MiembroEquipo[] = [
  { usuario_id: '', nombre: 'Jovanny Rodríguez', nacionalidad: 'V', dni: 30111222 },
  { usuario_id: '', nombre: 'Luis Jose Rodríguez Guerra', nacionalidad: 'V', dni: 27333444 },
  { usuario_id: '', nombre: 'Enrique Miguel Chacon Almerida', nacionalidad: 'V', dni: 19555666 }
]

/** Lo que devuelve la API de trabajadores para «mar». */
const MARIA: TrabajadorNomina = {
  nacionalidad: 'V',
  dni: 28111222,
  name: 'Maria',
  lastname: 'Fernandez',
  branch_name: 'Sucursal Norte',
  active: true,
  sucursal: 'Sucursal Norte'
}

let container: HTMLDivElement
let root: Root

/** El selector CON estado, para poder marcar y desmarcar de verdad. */
function ConEstado({ inicial }: { inicial: MiembroEquipo[] }) {
  const [elegidos, setElegidos] = useState(inicial)
  return <SelectorEquipo elegidos={elegidos} onElegidos={setElegidos} problema={null} />
}

async function montar(inicial: MiembroEquipo[]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<ConEstado inicial={inicial} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

/** Escribe en el buscador y espera el debounce (300 ms) + la respuesta. */
async function buscar(texto: string) {
  const input = container.querySelector('input[aria-label="Buscar integrante"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, texto)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolver) => setTimeout(resolver, 400))
  })
}

const nombres = () =>
  [...container.querySelectorAll('li .truncate')].map((s) => s.textContent?.trim() ?? '')

const casillaDe = (nombre: string): HTMLInputElement | null => {
  const li = [...container.querySelectorAll('li')].find((f) => (f.textContent ?? '').includes(nombre))
  return (li?.querySelector('input[type="checkbox"]') ?? null) as HTMLInputElement | null
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  buscarMock.mockReset()
  buscarMock.mockResolvedValue([])
})

afterEach(() => {
  container?.remove()
})

describe('SelectorEquipo · de dónde salen los participantes', () => {
  it('sin búsqueda, la lista es EXACTAMENTE el equipo elegido', async () => {
    await montar(EQUIPO)

    expect(nombres().sort()).toEqual(EQUIPO.map((m) => m.nombre).sort())
    for (const miembro of EQUIPO) expect(casillaDe(miembro.nombre)!.checked).toBe(true)
    // No se pidió nada a la API: nadie la llamó por escribirse sola.
    expect(buscarMock).not.toHaveBeenCalled()
    await desmontar()
  })

  it('buscar trae trabajadores de la API, y el filtro no toca el contador', async () => {
    buscarMock.mockResolvedValue([MARIA])
    await montar(EQUIPO)

    await buscar('mar')

    // La única fuente es la API: sale el trabajador que devolvió y nadie de
    // un sistema de usuarios.
    expect(buscarMock).toHaveBeenCalledWith('mar')
    expect(nombres()).toEqual(['Maria Fernandez'])
    // El filtro de búsqueda es de la LISTA, no del equipo: siguen los tres.
    expect(container.textContent).toContain('Equipo (3)')

    // Al limpiar, vuelve el equipo completo.
    buscarMock.mockResolvedValue([])
    await buscar('')
    for (const miembro of EQUIPO) {
      expect(casillaDe(miembro.nombre), `no aparece ${miembro.nombre}`).not.toBeNull()
      expect(casillaDe(miembro.nombre)!.checked).toBe(true)
    }
    await desmontar()
  })

  it('al elegir uno de la API y limpiar la búsqueda, su fila se queda', async () => {
    buscarMock.mockResolvedValue([MARIA])
    await montar(EQUIPO)

    await buscar('mar')
    await act(async () => {
      casillaDe('Maria Fernandez')!.click()
    })
    expect(container.textContent).toContain('Equipo (4)')

    // Sin el registro de la fila, al limpiar la búsqueda dejaría de salir de
    // la API y desaparecería ESTANDO elegida.
    buscarMock.mockResolvedValue([])
    await buscar('')
    expect(casillaDe('Maria Fernandez')).not.toBeNull()
    expect(casillaDe('Maria Fernandez')!.checked).toBe(true)
    await desmontar()
  })

  it('destildar no borra la fila: queda para volver a marcarla', async () => {
    await montar(EQUIPO)

    await act(async () => {
      casillaDe('Luis Jose Rodríguez Guerra')!.click()
    })

    expect(casillaDe('Luis Jose Rodríguez Guerra')).not.toBeNull()
    expect(casillaDe('Luis Jose Rodríguez Guerra')!.checked).toBe(false)
    expect(container.textContent).toContain('Equipo (2)')
    expect(casillaDe('Jovanny Rodríguez')!.checked).toBe(true)
    await desmontar()
  })
})
