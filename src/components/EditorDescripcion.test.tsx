// @vitest-environment jsdom
/**
 * El editor de descripción visto por el Líder: la tabla se ve una sola vez.
 * La caja de texto muestra un marcador `[[Tabla N]]` (nunca pipes), la grilla
 * es lo interactivo y no hay vista previa; el texto real con las tablas es el
 * que sale por `onChange` y viaja en `items.descripcion`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorDescripcion } from './EditorDescripcion'

const CON_TABLA = ['Intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'Fin'].join('\n')
const CAJA_ESPERADA = 'Intro\n\n[[Tabla 1]]\n\nFin'

function Harness({ inicial, alCambiar }: { inicial: string; alCambiar?: (t: string) => void }) {
  const [texto, setTexto] = useState(inicial)
  return (
    <EditorDescripcion
      value={texto}
      onChange={(t) => {
        setTexto(t)
        alCambiar?.(t)
      }}
    />
  )
}

let container: HTMLDivElement
let root: Root
let ultimo: string

async function montar(inicial: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ultimo = inicial
  await act(async () => {
    root.render(<Harness inicial={inicial} alCambiar={(t) => (ultimo = t)} />)
  })
}

async function desmontar() {
  await act(async () => {
    root.unmount()
  })
}

const caja = () => container.querySelector<HTMLTextAreaElement>('textarea')!
const grilla = () => [...container.querySelectorAll<HTMLInputElement>('tbody input')]
const botones = () => [...container.querySelectorAll<HTMLButtonElement>('button')]
const pantalla = () => container.textContent ?? ''

async function escribir(texto: string) {
  const campo = caja()
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(campo, texto)
    campo.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function apretar(etiqueta: string) {
  const boton = botones().find((b) => b.textContent?.trim() === etiqueta)
  expect(boton, `no encontré el botón «${etiqueta}»`).toBeTruthy()
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

describe('EditorDescripcion · la tabla se ve una sola vez', () => {
  it('la caja muestra el marcador, no los pipes, y no hay vista previa', async () => {
    await montar(CON_TABLA)
    expect(caja().value).toBe(CAJA_ESPERADA)
    expect(caja().value).not.toContain('|')
    expect(pantalla()).not.toContain('Vista previa')
    // La grilla es lo interactivo y muestra las mismas celdas.
    expect(grilla().map((c) => c.value)).toEqual(['A', 'B', '1', '2'])
    await desmontar()
  })

  it('escribir en la caja devuelve el texto real con la tabla de vuelta', async () => {
    await montar(CON_TABLA)
    await escribir('Intro\n\n[[Tabla 1]]\n\nFin!')
    expect(ultimo).toBe(['Intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'Fin!'].join('\n'))
    await desmontar()
  })

  it('el texto sin tablas se escribe tal cual', async () => {
    await montar('')
    await escribir('Dos líneas\ncon salto')
    expect(ultimo).toBe('Dos líneas\ncon salto')
    await desmontar()
  })

  it('apretar «Tabla» inserta la tabla en el texto y la caja queda con el marcador', async () => {
    await montar('Intro')
    await apretar('Tabla')
    expect(ultimo).toContain('| --- | --- |')
    expect(ultimo.startsWith('Intro\n\n')).toBe(true)
    expect(caja().value).toBe('Intro\n\n[[Tabla 1]]')
    // Y el foco cae en la primera celda de la grilla recién creada.
    expect(document.activeElement).toBe(grilla()[0])
    await desmontar()
  })

  it('sin la caja enfocada, la tabla nueva entra al final del texto', async () => {
    await montar(CON_TABLA)
    await apretar('Tabla')
    expect(tablasEn(ultimo)).toBe(2)
    expect(ultimo.endsWith('|  |  |  |')).toBe(true)
    expect(caja().value).toBe(CAJA_ESPERADA + '\n\n[[Tabla 2]]')
    await desmontar()
  })

  it('poner en negrita todo no se lleva la tabla de la caja', async () => {
    await montar(CON_TABLA)
    const campo = caja()
    await act(async () => {
      campo.focus()
      campo.setSelectionRange(0, campo.value.length)
    })
    await apretar('Negrita')
    // El texto real sigue teniendo la tabla…
    expect(tablasEn(ultimo)).toBe(1)
    // …y en la caja el marcador sigue intacto, con lo demás en negrita.
    expect(caja().value).toContain('[[Tabla 1]]')
    expect(caja().value).toContain('**Intro**')
    expect(caja().value).toContain('**Fin**')
    await desmontar()
  })
})

function tablasEn(texto: string): number {
  // Cuenta líneas separadoras (`| --- |`), una por tabla: así no se confunde
  // con una fila de datos que también contenga esos guiones.
  return texto.split('\n').filter((l) => /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(l)).length
}
