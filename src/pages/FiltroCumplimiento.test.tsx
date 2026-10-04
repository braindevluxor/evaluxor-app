import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { pathsEvidenciaChecklist, pathsEvidenciaCumple } from '../lib/evidencias'
import { FiltroCumplimiento, ValorRespuesta } from './EvaluacionDetalle'
import type { VeredictoItem } from '../lib/scoring'
import type { Item } from '../lib/types'

/**
 * El selector del detalle.
 *
 * Lo que importa acá es que las cuentas que se anuncian antes de filtrar sean las
 * reales: uno elige "No cumplido" justamente para saber cuántos problemas hay, así
 * que un número mentiroso en el botón manda al evaluador a trabajar sobre una lista
 * que no es la que cree.
 */
const CONTEOS: Record<VeredictoItem, number> = { cumple: 7, 'no-cumple': 3, 'no-aplica': 2, 'sin-veredicto': 2 }

function render(props: Partial<Parameters<typeof FiltroCumplimiento>[0]> = {}) {
  return renderToStaticMarkup(
    <FiltroCumplimiento
      filtro="ambos"
      onFiltro={() => {}}
      conteo={CONTEOS}
      {...props}
    />
  )
}

function renderRespuesta(item: Item, valor: unknown, soloIncumplimientos = true) {
  return renderToStaticMarkup(
    <ValorRespuesta item={item} valor={valor} soloIncumplimientos={soloIncumplimientos} />
  )
}

function itemBase(tipo: Item['tipo'], opciones: Item['opciones'] = null): Item {
  return {
    id: 'item-1',
    modulo_id: 'modulo-1',
    tipo,
    texto: 'Ítem de prueba',
    opciones,
    orden: 1,
    requerido: false,
    activo: true,
    created_at: ''
  }
}

describe('FiltroCumplimiento · los tres filtros que pide el detalle', () => {
  it('ofrece cumplido, no cumplido y ambos', () => {
    const html = render()
    expect(html).toContain('Cumple')
    expect(html).toContain('No cumple')
    expect(html).toContain('Ambos')
  })

  it('cada filtro muestra cuántos ítems hay de esa clase', () => {
    const html = render()
    // 10 = 7 cumplidos + 3 no cumplidos; las respuestas No aplica no entran al filtro.
    expect(html).toContain('Ambos<span class="ml-1.5 tabular-nums opacity-70">10</span>')
    expect(html).toContain('Cumple<span class="ml-1.5 tabular-nums opacity-70">7</span>')
    expect(html).toContain('No cumple<span class="ml-1.5 tabular-nums opacity-70">3</span>')
  })

  it('el filtro activo queda marcado, y no los otros', () => {
    const html = render({ filtro: 'no-cumple' })
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain('aria-pressed="true"')
    // El de "no cumplido" es el único con la pastilla blanca.
    const pressed = html.slice(html.indexOf('aria-pressed="true"') - 400)
    expect(pressed).toContain('No cumple')
  })

  it('quita el switch y mantiene No aplica fuera de los filtros de cumplimiento', () => {
    const html = render()
    expect(html).not.toContain('role="switch"')
    expect(html).not.toContain('Mostrar informativos')
    expect(html).toContain('Las respuestas “No aplica” no se muestran.')
    expect(html).not.toContain('Cumple<span class="ml-1.5 tabular-nums opacity-70">9</span>')
  })

  it('explica qué significa el filtro elegido', () => {
    expect(render({ filtro: 'no-cumple' })).toContain('lo pendiente es lo que no está tildado')
    expect(render({ filtro: 'cumple' })).toContain('llegaron al 100%')
    expect(render({ filtro: 'ambos' })).toContain('Todos los ítems con respuesta')
  })

  it('aclara que No aplica se oculta en el filtro Ambos', () => {
    expect(render()).toContain('Las respuestas “No aplica” no se muestran.')
  })
})

describe('ValorRespuesta · detalle del filtro No cumplido', () => {
  it('el checklist solo presenta opciones no cumplidas', () => {
    const html = renderRespuesta(
      itemBase('CHECKLIST', [
        { id: 'cumplida', etiqueta: 'Opción cumplida' },
        { id: 'pendiente', etiqueta: 'Opción pendiente' },
        { id: 'no-aplica', etiqueta: 'Opción no aplica' }
      ]),
      { selected: ['cumplida'], informativos: ['no-aplica'] }
    )

    expect(html).toContain('Opción pendiente')
    expect(html).not.toContain('Opción cumplida')
    expect(html).not.toContain('Opción no aplica')
    expect(html).toContain('<table')
    expect(html).toContain('Descripción')
    expect(html).toContain('Responsable')
    expect(html).toContain('Foto')
  })

  it('muestra responsable solo cuando el checklist tiene opciones no cumplidas', () => {
    const item = itemBase('CHECKLIST', [
      { id: 'ok', etiqueta: 'Equipo limpio', responsables: ['Soporte'] },
      { id: 'fallo', etiqueta: 'Cableado ordenado', responsables: ['Mantenimiento'] }
    ])
    const incumplido = renderRespuesta(item, {
      selected: ['ok'],
      responsablesPorOpcion: { fallo: ['Coordinación'] },
      evidencias: { fallo: { paths: ['ev/evaluacion/item/foto.jpg'] } }
    }, false)
    expect(incumplido).toContain('Responsable')
    expect(incumplido).toContain('Coordinación')
    expect(incumplido).toContain('Cableado ordenado')
    expect(incumplido).toContain('grid-cols-4')

    const cumplido = renderRespuesta(item, { selected: ['ok', 'fallo'] }, false)
    expect(cumplido).not.toContain('Responsable</th>')
    expect(cumplido).toContain('Descripción')
    expect(cumplido).toContain('Foto')
  })

  it('pone un check o una X antes de la descripción y ordena primero los checks', () => {
    const html = renderRespuesta(
      itemBase('CHECKLIST', [
        { id: 'fallo', etiqueta: 'Falla primero' },
        { id: 'ok', etiqueta: 'Correcto segundo' }
      ]),
      { selected: ['ok'] },
      false
    )

    expect(html.indexOf('Correcto segundo')).toBeLessThan(html.indexOf('Falla primero'))
    expect(html).toContain('aria-label="Cumple"')
    expect(html).toContain('aria-label="No cumple"')
    expect(html).not.toContain('>Cumple</span>')
    expect(html).not.toContain('>No cumple</span>')
  })

  it('oculta opciones No aplica y sus evidencias en el detalle normal del checklist', () => {
    const html = renderRespuesta(
      itemBase('CHECKLIST', [
        { id: 'cumplida', etiqueta: 'Opción cumplida' },
        { id: 'excluida', etiqueta: 'Opción no aplicable' }
      ]),
      {
        selected: ['cumplida', 'excluida'],
        informativos: ['excluida'],
        evidencias: { excluida: { paths: ['evidencias/foto.jpg'] } }
      },
      false
    )

    expect(html).toContain('Opción cumplida')
    expect(html).not.toContain('Opción no aplicable')
    expect(html).not.toContain('No aplica')
    expect(html).not.toContain('Con evidencia fotográfica')
  })

  it('oculta colaboradores y opciones marcados No aplica', () => {
    const html = renderRespuesta(
      itemBase('LISTA_COLABORADORES', [
        { id: 'check', etiqueta: 'Punto aplicable' },
        { id: 'excluido', etiqueta: 'Punto no aplicable' }
      ]),
      {
        colaboradores: [
          {
            dni: 1,
            name: 'Ana',
            lastname: 'Aplicable',
            active: true,
            aplica: true,
            selected: ['check'],
            noAplica: ['excluido']
          },
          {
            dni: 2,
            name: 'Luis',
            lastname: 'No aplica',
            active: true,
            aplica: false,
            selected: []
          }
        ]
      },
      false
    )

    expect(html).toContain('Ana Aplicable')
    expect(html).not.toContain('Luis')
    expect(html).not.toContain('No aplica')
  })

  describe('pathsEvidenciaCumple', () => {
    it('recupera y desduplica rutas guardadas dentro de evidencias de Cumple / No cumple', () => {
      expect(pathsEvidenciaCumple({
        value: false,
        evidencias: [
          { comentario: 'Falla visible', paths: ['evaluacion/item/foto-1.jpg'] },
          { paths: ['evaluacion/item/foto-1.jpg', 'evaluacion/item/foto-2.jpg'] }
        ]
      })).toEqual(['evaluacion/item/foto-1.jpg', 'evaluacion/item/foto-2.jpg'])
    })

    it('recupera rutas checklist desde la respuesta aunque falte la fila de fotos', () => {
      expect(pathsEvidenciaChecklist({
        selected: ['limpieza'],
        evidencias: {
          limpieza: { paths: ['ev/job/evidencia/foto.jpg'] },
          otra: { paths: ['ev/job/evidencia/foto.jpg'] }
        }
      })).toEqual(['ev/job/evidencia/foto.jpg'])
    })

    it('tolera valores históricos sin evidencias o con una forma inválida', () => {
      expect(pathsEvidenciaCumple(null)).toEqual([])
      expect(pathsEvidenciaCumple({ value: false, evidencias: 'sin arreglo' })).toEqual([])
    })
  })

  it('la conciliación solo presenta productos con descuadre y no fuerza scroll horizontal', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-OK', nombre: 'Producto conciliado', teorica: 10, fisica: 10 },
          { sku: 'SKU-ERROR', nombre: 'Producto descuadrado', teorica: 10, fisica: 7, finalBase: 25, perdidaEstimada: 37.5 },
          { sku: 'SKU-SOBRANTE', nombre: 'Producto con sobrante', teorica: 0, fisica: 3 },
          { sku: 'SKU-FALTA-UNO', nombre: 'Producto con una unidad faltante', teorica: 4, fisica: 3 },
          { sku: 'SKU-SOBRA-UNO', nombre: 'Producto con una unidad sobrante', teorica: 3, fisica: 4 }
        ]
      }
    )

    expect(html).toContain('Producto descuadrado')
    expect(html).toContain('Producto con sobrante')
    expect(html).toContain('bg-amber-50/70')
    expect(html).toContain('bg-amber-100 text-amber-800')
    expect(html).toContain('bg-red-50/50')
    expect(html).toContain('70% concilia, faltan 3')
    expect(html).toContain('0% concilia, sobran 3')
    expect(html).toContain('75% concilia, falta 1')
    expect(html).toContain('75% concilia, sobra 1')
    expect(html).toContain('Pérdida: $')
    expect(html).toContain('Pérdida estimada por faltantes:')
    expect(html).toContain('37,50')
    expect(html).toContain('producto(s) sin precio base')
    expect(html).not.toContain('Producto conciliado')
    expect(html).not.toContain('overflow-x-auto')
    expect(html).not.toContain('min-w-[620px]')
    expect(html).toContain('table-fixed')
  })
})