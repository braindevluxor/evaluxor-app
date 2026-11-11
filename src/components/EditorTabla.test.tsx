// @vitest-environment jsdom
/**
 * La grilla de tablas: se tipea en las celdas y se agregan o sacan filas y
 * columnas sin escribir un solo pipe. Monta `EditorTabla` de verdad (jsdom +
 * createRoot) sobre un estado controlado, igual que el modelo que después
 * `reemplazarTabla` escribe en el texto.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorTabla } from './EditorTabla'
import { nuevaTabla, type ModeloTabla } from '../lib/markdown'

function Harness({ inicial, alQuitar }: { inicial: ModeloTabla; alQuitar?: () => void }) {
  const [modelo, setModelo] = useState(inicial)
  return <EditorTabla numero={1} modelo={modelo} onChange={setModelo} onQuitar={alQuitar ?? (() => {})} />
}

let container: HTMLDivElement
let root: Root

async function montar(inicial: ModeloTabla, alQuitar?: () => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Harness inicial={inicial} alQuitar={alQuitar} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

const celdas = () => [...container.querySelectorAll<HTMLInputElement>('tbody input')]
const botones = () => [...container.querySelectorAll<HTMLButtonElement>('button')]
const contador = (palabra: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="Cantidad de ${palabra}s de la tabla"]`)!

/** Escribe como lo haría una persona: enfoca, setter nativo + evento `input` (React lo escucha). */
async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function apretar(ariaLabel: string) {
  const boton = botones().find((b) => b.getAttribute('aria-label') === ariaLabel)
  expect(boton, `no encontré el botón «${ariaLabel}»`).toBeTruthy()
  await act(async () => {
    boton?.click()
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  container?.remove()
})

describe('EditorTabla · grilla sin pipes', () => {
  it('arranca con el encabezado y las filas del modelo', async () => {
    await montar(nuevaTabla(3, 2))
    expect(celdas()).toHaveLength(9) // 3 columnas × (encabezado + 2 filas)
    expect(celdas().map((c) => c.value)).toEqual([
      'Columna 1', 'Columna 2', 'Columna 3',
      '', '', '',
      '', '', ''
    ])
    await desmontar()
  })

  it('escribir en una celda actualiza el modelo sin tocar las demás', async () => {
    await montar(nuevaTabla(2, 1))
    await escribir(celdas()[2], 'Almacén')
    expect(celdas().map((c) => c.value)).toEqual(['Columna 1', 'Columna 2', 'Almacén', ''])
    await desmontar()
  })

  it('un pipe tipeado en la celda se filtra (rompería el renglón)', async () => {
    await montar(nuevaTabla(2, 1))
    await escribir(celdas()[2], 'a | b')
    expect(celdas()[2].value).toBe('a  b')
    await desmontar()
  })

  it('«Agregar una fila» mete una fila de datos con el ancho de la grilla', async () => {
    await montar(nuevaTabla(2, 1))
    await apretar('Agregar una fila a la tabla')
    expect(celdas()).toHaveLength(6) // 2 columnas × (encabezado + 2 filas)
    await desmontar()
  })

  it('«Agregar una columna» crece también el encabezado', async () => {
    await montar(nuevaTabla(2, 1))
    await apretar('Agregar una columna a la tabla')
    expect(celdas()[0].value).toBe('Columna 1')
    expect(celdas()[2].value).toBe('Columna 3')
    expect(celdas()).toHaveLength(6)
    await desmontar()
  })

  it('los contadores no se pasan de los topes', async () => {
    await montar(nuevaTabla(1, 1))
    const menosFila = botones().find((b) => b.getAttribute('aria-label') === 'Quitar una fila de la tabla')
    const menosColumna = botones().find((b) => b.getAttribute('aria-label') === 'Quitar una columna de la tabla')
    expect(menosFila?.disabled).toBe(true)
    expect(menosColumna?.disabled).toBe(true)
    await desmontar()
  })

  it('se tipea la cantidad de filas de una, sin apretar + cuarenta veces', async () => {
    await montar(nuevaTabla(2, 1))
    await escribir(contador('fila'), '20')
    await act(async () => {
      contador('fila').blur()
    })
    // Encabezado + 20 filas, con 2 columnas.
    expect(celdas()).toHaveLength(42)
    await desmontar()
  })

  it('lo que se tipee fuera del rango se recorta al tope', async () => {
    await montar(nuevaTabla(2, 1))
    await escribir(contador('fila'), '0')
    await act(async () => {
      contador('fila').blur()
    })
    // Sigue con la fila mínima.
    expect(celdas()).toHaveLength(4)
    await desmontar()
  })

  it('«Quitar esta tabla» avisa al editor para borrar el bloque', async () => {
    let quitada = false
    await montar(nuevaTabla(2, 1), () => {
      quitada = true
    })
    await apretar('Quitar la tabla 1')
    expect(quitada).toBe(true)
    await desmontar()
  })
})
