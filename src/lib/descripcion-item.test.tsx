import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { ItemRenderer } from '../components/ItemRenderer'
import type { Item } from './types'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

function itemCon(descripcion?: string | null): Item {
  return {
    id: 'it-1',
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'Los pasillos están libres de obstáculos',
    descripcion,
    opciones: null,
    orden: 0,
    requerido: true,
    activo: true,
    puntaje: 10,
    created_at: ''
  }
}

describe('descripción del ítem · se configura aparte del enunciado', () => {
  it('el schema la trae como columna de items (upgrade idempotente)', () => {
    const sql = fuente('../../supabase/schema.sql')
    expect(sql).toContain("alter table public.items add column if not exists descripcion text not null default '';")
  })

  it('guardarItem la persiste al crear el ítem', () => {
    const catalogo = fuente('./data/catalog.ts')
    expect(catalogo).toContain("descripcion: i.descripcion ?? ''")
  })

  it('Config → Ítems la ofrece en el form y la manda al guardar', () => {
    const pagina = fuente('../pages/config/Items.tsx')
    expect(pagina).toContain('label="Descripción (opcional)"')
    // El payload del form la incluye junto al enunciado.
    expect(pagina).toMatch(/texto,\s*\n\s*descripcion,/)
  })

  it('se edita con botones de negrita, viñeta y tabla', () => {
    expect(fuente('../pages/config/Items.tsx')).toContain('<EditorDescripcion')
    const editor = fuente('../components/EditorDescripcion.tsx')
    for (const accion of ['envolverNegrita', 'prefijarViñetas', 'plantillaTabla']) {
      expect(editor, `el botón usa ${accion}`).toContain(accion)
    }
  })

  it('la tabla se ve una sola vez: en la grilla, no en la caja ni en una vista previa', () => {
    const editor = fuente('../components/EditorDescripcion.tsx')
    // La caja muestra el marcador y el texto real (con pipes) sólo al guardar.
    expect(editor).toContain('conMarcadoresDeTabla')
    expect(editor).toContain('sinMarcadoresDeTabla')
    // Sin vista previa: la grilla ya es la vista de la tabla.
    expect(editor).not.toContain('Vista previa')
    expect(editor).not.toContain('from \'./Descripcion\'')
  })

  it('la tabla se arma en una grilla, sin escribir pipes a mano', () => {
    const grilla = fuente('../components/EditorTabla.tsx')
    expect(grilla).toContain('conCelda')
    expect(grilla).toContain('conFilas')
    expect(grilla).toContain('conColumnas')
    // La grilla escribe de vuelta el bloque en el texto (y lo puede quitar).
    const editor = fuente('../components/EditorDescripcion.tsx')
    expect(editor).toContain('reemplazarTabla')
    expect(editor).toContain('quitarTabla')
  })
})

describe('descripción del ítem · se muestra en la evaluación', () => {
  it('aparece debajo del enunciado y antes de los controles de respuesta', () => {
    const html = renderToStaticMarkup(
      <ItemRenderer item={itemCon('Se revisa al cerrar el local.')} valor={undefined} index={0} total={1} onChange={() => {}} />
    )
    expect(html).toContain('Se revisa al cerrar el local.')
    // Después del enunciado numerado y antes del primer veredicto.
    expect(html.indexOf('1. Los pasillos')).toBeLessThan(html.indexOf('Se revisa al cerrar el local.'))
    expect(html.indexOf('Se revisa al cerrar el local.')).toBeLessThan(html.indexOf('aria-label="Cumple"'))
  })

  it('sin descripción no se pinta nada (ni un espacio de más)', () => {
    const conVacia = renderToStaticMarkup(<ItemRenderer item={itemCon('')} valor={undefined} index={0} total={1} onChange={() => {}} />)
    const sinCampo = renderToStaticMarkup(<ItemRenderer item={itemCon(undefined)} valor={undefined} index={0} total={1} onChange={() => {}} />)
    expect(conVacia).not.toContain('Se revisa')
    expect(sinCampo.length).toBe(conVacia.length)
  })

  it('la sección repetible la muestra bajo su encabezado', () => {
    const evaluar = fuente('../pages/evaluar/EvaluarSucursal.tsx')
    expect(evaluar).toContain('texto={paso.descripcion}')
  })
})

describe('descripción del ítem · se muestra en el detalle', () => {
  it('la fila de respuesta y el encabezado de la sección la traen', () => {
    const detalle = fuente('../pages/EvaluacionDetalle.tsx')
    // Dos lugares: la fila de cada ítem y el título de la sección CONTENEDOR.
    expect(detalle.match(/texto=\{item\.descripcion\}/g)?.length).toBe(2)
  })

  it('el formulario público de conciliación también la muestra', () => {
    const publica = fuente('../pages/publico/ConciliacionPublica.tsx')
    expect(publica).toContain('texto={item.descripcion}')
  })
})
