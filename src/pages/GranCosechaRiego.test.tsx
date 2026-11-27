// @vitest-environment jsdom
/**
 * El riego en la tarjeta del proyecto, como el "Me gusta" de Facebook.
 *
 *  1. UN SOLO control: la planta y su número, SIN fondo y sin textos
 *     sueltos (ni «X riegos», ni «Ya regaste», ni «Quitar» — eran tres
 *     rótulos para lo mismo).
 *  2. EN REPOSO: la planta SÓLIDA en gris; al apretar, GOTA animada.
 *  3. REGADO: la planta en VERDE y el MISMO botón pasa a QUITAR el riego
 *     (con `aria-pressed` diciendo el estado); si el pedido FALLA, la
 *     planta vuelve gris — verde sin regar mentiría.
 *
 * Monta `RiegoProyecto` de verdad (jsdom + createRoot) con un doble de la
 * pantalla que maneja el MISMO estado: `ocupado` y `datos.mio` cambian cuando
 * la RPC "contesta". Los timers son falsos: la duración de la gota se
 * avanza a mano en vez de esperarla.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { RiegoProyecto } from './GranCosecha'

let container: HTMLDivElement
let root: Root

/** La escena con el estado que maneja la pantalla: el pedido y su resultado. */
function Escena({ exito }: { exito: boolean }) {
  const [datos, setDatos] = useState({ riegos: 2, mio: false })
  const [ocupado, setOcupado] = useState(false)
  const regar = () => {
    setOcupado(true)
    // La RPC "contesta" en un microtask: si salió bien, el estado `mio`
    // llega junto con el apagón de `ocupado`, igual que en la pantalla.
    void Promise.resolve().then(() => {
      setOcupado(false)
      if (exito) setDatos((d) => ({ riegos: d.riegos + 1, mio: true }))
    })
  }
  const quitar = () => {
    setOcupado(true)
    void Promise.resolve().then(() => {
      setOcupado(false)
      setDatos((d) => ({ riegos: Math.max(0, d.riegos - 1), mio: false }))
    })
  }
  return <RiegoProyecto datos={datos} ocupado={ocupado} onRegar={regar} onQuitar={quitar} />
}

async function montar(exito: boolean) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Escena exito={exito} />)
  })
}

async function apretar(titulo: string) {
  const boton = container.querySelector<HTMLButtonElement>(`button[title="${titulo}"]`)
  expect(boton, `el botón «${titulo}» tiene que estar en la tarjeta`).toBeTruthy()
  await act(async () => {
    boton?.click()
  })
}

/** El fin de la gota: la duración mínima que declara el componente. */
async function terminarLaGota() {
  await act(async () => {
    vi.advanceTimersByTime(1400)
  })
}

describe('RiegoProyecto · el toggle gota → planta', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount()
      })
    }
    container?.remove()
    root = undefined as unknown as Root
    vi.useRealTimers()
  })

  it('en reposo: UN control —planta gris y su número— sin fondo', async () => {
    await montar(true)

    // Un ÚNICO botón: los tres textos («2 riegos», «Ya regaste», «Quitar»)
    // sobraban para lo que ahora es un solo «me gusta».
    const botones = container.querySelectorAll('button')
    expect(botones).toHaveLength(1)
    const boton = botones[0] as HTMLButtonElement
    expect(boton.title).toBe('Regar este proyecto')
    expect(boton.getAttribute('aria-pressed')).toBe('false')

    // Sin píldora de fondo: sólo el ícono y la cifra.
    expect(boton.className).not.toContain('bg-sky-50')
    expect(container.textContent).not.toContain('Ya regaste')
    expect(container.textContent).not.toContain('Quitar')

    const planta = boton.querySelector('.riego-planta')
    expect(planta, 'el ícono de reposo es una planta').toBeTruthy()
    // El MISMO gris del menú (`text-slate-500` en ConsoleLayout).
    expect(planta?.getAttribute('class')).toContain('text-slate-500')
    expect(container.querySelector('.riego-gota')).toBeNull()
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('2')

    // Lo que oye el lector de pantalla: el estado con su número.
    expect(boton.textContent).toContain('Regar este proyecto')
    expect(boton.textContent).toContain('riegos')
  })

  it('al apretar: el ícono se cambia por la gota animada', async () => {
    await montar(true)
    await apretar('Regar este proyecto')

    const gota = container.querySelector('.riego-gota')
    expect(gota, 'la gota tiene que estar mientras dura la animación').toBeTruthy()
    expect(gota?.tagName.toLowerCase()).toBe('svg')
    expect(gota?.getAttribute('class')).toContain('text-sky-500')
    // El pedido salió y en ningún caso vuelve la planta antes de tiempo.
    expect(container.querySelector('.riego-planta')).toBeNull()
  })

  it('la gota se retira: la planta vuelve en VERDE y el botón pasa a QUITAR', async () => {
    await montar(true)
    await apretar('Regar este proyecto')
    await terminarLaGota()

    expect(container.querySelector('.riego-gota')).toBeNull()
    const boton = container.querySelector<HTMLButtonElement>('button')
    expect(boton?.getAttribute('aria-pressed')).toBe('true')
    expect(boton?.title).toBe('Quitar tu riego de este proyecto')
    expect(boton?.querySelector('.riego-planta')?.getAttribute('class')).toContain('text-green-600')
    // Sigue siendo UN control, con el conteo subido.
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('3')
  })

  it('si el pedido FALLA, la planta vuelve GRIS: verde sería mentir', async () => {
    await montar(false)
    await apretar('Regar este proyecto')
    await terminarLaGota()

    expect(container.querySelector('.riego-gota')).toBeNull()
    const boton = container.querySelector<HTMLButtonElement>('button')
    expect(boton?.getAttribute('aria-pressed')).toBe('false')
    expect(boton?.title).toBe('Regar este proyecto')
    expect(boton?.querySelector('.riego-planta')?.getAttribute('class')).toContain('text-slate-500')
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('2')
  })

  it('la planta es SÓLIDA: hojas con relleno, no de trazo', async () => {
    await montar(true)

    const planta = container.querySelector('.riego-planta')
    // Las DOS hojas cerradas van llenas con `currentColor`; el Sprout de
    // lucide era de trazo y al rellenarlo perdía el tallo.
    const llenas = planta?.querySelectorAll('path[fill="currentColor"]') ?? []
    expect(llenas.length).toBe(2)
  })

  it('apretar de nuevo (regado) quita el riego y la planta vuelve gris', async () => {
    await montar(true)
    await apretar('Regar este proyecto')
    await terminarLaGota()

    // El MISMO botón, ahora en modo quitar…
    await apretar('Quitar tu riego de este proyecto')

    // …y de vuelta al reposo: sin verde, sin «regado», conteo deshecho.
    const boton = container.querySelector<HTMLButtonElement>('button')
    expect(boton?.getAttribute('aria-pressed')).toBe('false')
    expect(boton?.title).toBe('Regar este proyecto')
    expect(boton?.querySelector('.riego-planta')?.getAttribute('class')).toContain('text-slate-500')
    expect(container.querySelector('.tabular-nums')?.textContent).toBe('2')
  })
})
