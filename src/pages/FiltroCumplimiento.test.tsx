import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { pathsEvidenciaChecklist, pathsEvidenciaConciliacion, pathsEvidenciaCumple, pathsEvidenciaProducto } from '../lib/evidencias'
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

  it('oculta trabajadores y opciones marcados No aplica', () => {
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

    expect(html).toContain('Aplicable Ana')
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

    it('recupera y desduplica las rutas de evidencia de cada producto de la conciliación', () => {
      expect(
        pathsEvidenciaConciliacion({
          productos: [
            { sku: 'SKU-1', nombre: 'Pan', paths: ['ev/eval/item/f1.jpg', 'ev/eval/item/f2.jpg'] },
            { sku: 'SKU-2', nombre: 'Queso', paths: ['ev/eval/item/f1.jpg'] }
          ]
        })
      ).toEqual(['ev/eval/item/f1.jpg', 'ev/eval/item/f2.jpg'])
      // Un producto puede no tener fotos.
      expect(pathsEvidenciaConciliacion({ productos: [{ sku: 'SKU-3' }] })).toEqual([])
      expect(pathsEvidenciaConciliacion({ value: true })).toEqual([])
      expect(pathsEvidenciaConciliacion(null)).toEqual([])
    })

    it('la evidencia de un producto sale de sus paths y nunca de sus photoIds locales', () => {
      expect(pathsEvidenciaProducto({ sku: 'A', paths: ['ev/e/i/f1.jpg'] })).toEqual(['ev/e/i/f1.jpg'])
      expect(pathsEvidenciaProducto({ sku: 'A', paths: ['ev/e/i/f1.jpg'], photoIds: ['local-1'] })).toEqual(['ev/e/i/f1.jpg'])
      expect(pathsEvidenciaProducto({ sku: 'A', photoIds: ['local-1'] })).toEqual([])
      expect(pathsEvidenciaProducto(null)).toEqual([])
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
    // El estado es el signo de la diferencia y nada más: "sobran 3" ocupaba media
    // columna para decir lo mismo que "+3" con el color del distintivo al lado.
    expect(html).toMatch(/bg-red-100 text-red-700">-3</)
    expect(html).toMatch(/bg-red-100 text-red-700">-1</)
    expect(html).toMatch(/bg-amber-100 text-amber-800">\+3</)
    expect(html).toMatch(/bg-amber-100 text-amber-800">\+1</)
    // Y el porcentaje por fila ya no está: los dos montos de al lado lo dicen.
    expect(html).not.toContain('concilia,')
    expect(html).not.toContain('% concilia')
    expect(html).toContain('Pérdida: $')
    expect(html).toContain('37,50')
    expect(html).toContain('producto(s) sin precio base')
    // El cierre separa el sobrante (buscar mercadería) de la pérdida (plata), y
    // solo la segunda va en rojo.
    expect(html).toContain('unidades sobrantes')
    expect(html).toContain('unidades faltantes con un valor estimado de USD37,50')
    expect(html).toContain('text-red-700')
    expect(html).toMatch(/text-red-700[^>]*>\s*4 unidades faltantes/)
    expect(html).not.toContain('Producto conciliado')
    expect(html).not.toContain('overflow-x-auto')
    expect(html).not.toContain('min-w-[620px]')
    expect(html).toContain('table-fixed')
  })

  it('la conciliación rotula la evidencia con el producto al que pertenece', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-1', nombre: 'Pan', teorica: 10, fisica: 7, paths: ['ev/eval/item/foto.jpg'] },
          { sku: 'SKU-2', nombre: 'Queso', teorica: 5, fisica: 5 }
        ]
      }
    )
    expect(html).toContain('Evidencia fotográfica')
    // La foto queda casada a su SKU: se rótula en lugar de un bloque general.
    expect(html).toContain('Evidencia fotográfica · SKU-1 · Pan')
    expect(html).not.toContain('Evidencia fotográfica · SKU-2')
    // Sin fotos en ningún producto, la sección no aparece.
    const sinFotos = renderRespuesta(itemBase('CONCILIACION'), {
      productos: [{ sku: 'SKU-1', nombre: 'Pan', teorica: 10, fisica: 7 }]
    })
    expect(sinFotos).not.toContain('Evidencia fotográfica')
  })

  it('en la conciliación de precio el estado lleva el signo de plata y los montos van con $', () => {
    const html = renderRespuesta(
      { ...itemBase('CONCILIACION'), contra_dato: 'FINAL_BASE' },
      {
        productos: [
          { sku: 'SKU-OK', nombre: 'Conciliado', teorica: 10, fisica: 10, finalBase: 25 },
          { sku: 'SKU-FALTA', nombre: 'Falta plata', teorica: 10, fisica: 7.5, finalBase: 25 },
          { sku: 'SKU-SOBRA', nombre: 'Sobra plata', teorica: 4, fisica: 9.25, finalBase: 25 }
        ]
      }
    )

    // La diferencia se marca con el mismo signo que la columna Sistema/Hablador,
    // y con los dos decimales de siempre para que los tres números de la fila se
    // puedan comparar de un vistazo.
    expect(html).toMatch(/bg-red-100 text-red-700">-\$2,50</)
    expect(html).toMatch(/bg-amber-100 text-amber-800">\+\$5,25</)
    expect(html).toMatch(/tabular-nums text-slate-700[^>]*>\$10,00</)
    expect(html).toMatch(/tabular-nums text-slate-700[^>]*>\$7,50</)
    expect(html).toContain('Sync')
    // Sin el precio base por fila: la columna Sync es solo la fecha.
    expect(html).not.toContain('Precio base')
    expect(html).not.toMatch(/bg-red-100 text-red-700[^>]*>[^<]*\$[^<]*\$/)
  })

  it('el producto sin hablador entra como descuadre, no como fila sin datos', () => {
    const html = renderRespuesta(
      { ...itemBase('CONCILIACION'), contra_dato: 'FINAL_BASE' },
      {
        productos: [
          { sku: 'SKU-OK', nombre: 'Conciliado', teorica: 10, fisica: 10, finalBase: 25 },
          { sku: 'SKU-SIN', nombre: 'Sin etiqueta', teorica: 10, fisica: null, finalBase: 25, sinHablador: true }
        ]
      }
    )

    // Con «solo incumplimientos» activo (el default del detalle): la fila sin
    // hablador es un descuadre y tiene que estar, aunque no haya precio que
    // comparar. La columna Hablador dice por qué no hay número.
    expect(html).toContain('Sin etiqueta')
    expect(html).toContain('Sin hablador')
    expect(html).toMatch(/bg-red-100 text-red-700">No Match</)
    expect(html).not.toMatch(/text-slate-500">Sin datos</)
    // Uno de dos productos descuadra → la tasa del pie lo refleja.
    expect(html).toContain('tasa de descuadre 50%')
  })

  it('el estado de la conciliación de cantidades no lleva signo de plata', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-FALTA', nombre: 'Faltan unidades', teorica: 10, fisica: 7, finalBase: 25 }
        ]
      }
    )

    // Son unidades, no dólares: ponerle `$` haría creer que faltan tres dólares
    // de producto.
    expect(html).toMatch(/bg-red-100 text-red-700">-3</)
    expect(html).not.toMatch(/bg-red-100 text-red-700">-\$/)
  })

  it('la pérdida de la conciliación se valúa al precio de venta', () => {
    // Caso real de la API: base 2,84 con 44,07% de descuento ya viene en 1,59 y
    // el IVA de 0,25 va aparte. Tres unidades perdidas son 5,52, no 4,77.
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [{ sku: 'SKU-PAPEL', nombre: 'Papel Rosal Plus', teorica: 10, fisica: 7, finalBase: 1.59, finalTax: 0.25 }]
      }
    )

    expect(html).toContain('USD5,52')
    expect(html).not.toContain('USD4,77')
  })

  it('muestra la pérdida de los sobrantes y suma real + sobrantes en la absoluta', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-FALTA', nombre: 'Faltan unidades', teorica: 10, fisica: 7, finalBase: 12.5 },
          { sku: 'SKU-SOBRA', nombre: 'Sobran unidades', teorica: 2, fisica: 5, finalBase: 2 }
        ]
      }
    )

    // Faltantes: 3 × 12,5 = 37,5 (pérdida real). Sobrantes: 3 × 2 = 6. La suma
    // de ambos es la pérdida absoluta: 43,50. El resumen etiquetado pone el
    // monto en un <span> aparte, así que se verifica en tramos contiguos.
    expect(html).toContain('3 unidades sobrantes')
    expect(html).toContain('3 unidades faltantes')
    // En la fila: el faltante conserva su "Pérdida:" y el sobrante ahora muestra
    // su valor en ámbar, con el mismo formato de precio ($).
    expect(html).toContain('Pérdida: $37,50')
    expect(html).toContain('Sobrante: $6,00')
    expect(html).toContain('Pérdida absoluta: USD43,50')
  })

  it('los productos salen agrupados por departamento', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-PAN', nombre: 'Pan cocido', teorica: 5, fisica: 2, finalBase: 1, departamento: 'PANADERÍA' },
          { sku: 'SKU-LIM1', nombre: 'Cloro', teorica: 4, fisica: 1, finalBase: 2, departamento: 'LIMPIEZA' },
          { sku: 'SKU-LIM2', nombre: 'Jabón', teorica: 9, fisica: 8, finalBase: 1, departamento: 'LIMPIEZA' }
        ]
      }
    )

    // Los rótulos de departamento salen como encabezado de grupo, con la cuenta
    // de filas de cada uno.
    expect(html).toContain('LIMPIEZA')
    expect(html).toContain('PANADERÍA')
    expect(html).toMatch(/LIMPIEZA[\s\S]{0,80}\(2\)/)

    // Y LIMPIEZA va antes que PANADERÍA aunque en PANADERÍA esté la pérdida más
    // grande: el recorrido lo manda el pasillo, no el monto.
    expect(html.indexOf('LIMPIEZA')).toBeLessThan(html.indexOf('PANADERÍA'))
    expect(html.indexOf('SKU-PAN')).toBeGreaterThan(html.indexOf('SKU-LIM2'))

    // Cada producto sale DESPUÉS de su propio rótulo y ANTES del rótulo siguiente.
    // Esto es lo que convierte a los rótulos en encabezados de grupo y no en una
    // lista suelta arriba de la tabla: los productos de LIMPIEZA tienen que estar
    // entre el rótulo de LIMPIEZA y el de PANADERÍA.
    expect(html.indexOf('SKU-LIM1')).toBeGreaterThan(html.indexOf('LIMPIEZA'))
    expect(html.indexOf('SKU-LIM1')).toBeLessThan(html.indexOf('PANADERÍA'))
    expect(html.indexOf('SKU-PAN')).toBeGreaterThan(html.indexOf('PANADERÍA'))
  })

  it('el rótulo del departamento lleva la pérdida de ese pasillo', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-PAN', nombre: 'Pan cocido', teorica: 5, fisica: 2, finalBase: 1, departamento: 'PANADERÍA' },
          { sku: 'SKU-LIM1', nombre: 'Cloro', teorica: 4, fisica: 1, finalBase: 2, departamento: 'LIMPIEZA' },
          { sku: 'SKU-LIM2', nombre: 'Jabón', teorica: 9, fisica: 8, finalBase: 1, departamento: 'LIMPIEZA' }
        ]
      }
    )

    // LIMPIEZA pierde 3 unidades a $2 (cloro) y 1 unidad a $1 (jabón) = $7.
    // PANADERÍA pierde 3 unidades a $1 = $3.
    expect(html).toMatch(/LIMPIEZA[\s\S]{0,220}Pérdida \$7,00/)
    expect(html).toMatch(/PANADERÍA[\s\S]{0,220}Pérdida \$3,00/)

    // Y los rótulos suman lo mismo que la pérdida estimada del pie: el desglose por
    // departamento tiene que poder reconstruirse contra el total.
    expect(html).toContain('USD10,00')
  })

  it('un departamento que concilia no muestra pérdida en el rótulo', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-LIM1', nombre: 'Cloro', teorica: 4, fisica: 1, finalBase: 2, departamento: 'LIMPIEZA' },
          // Sobran unidades: hay descuadre, pero no plata perdida.
          { sku: 'SKU-BAZ', nombre: 'Cubeta', teorica: 1, fisica: 6, finalBase: 3, departamento: 'BAZAR' }
        ]
      }
    )

    // El rótulo de LIMPIEZA sí lleva su pérdida...
    expect(html).toMatch(/LIMPIEZA[\s\S]{0,220}Pérdida \$6,00/)
    // ...y el de BAZAR no, porque ahí sobraron unidades y no se está perdiendo
    // nada. Ponerle un $0 haría creer que el pasillo está en cero.
    expect(html).toMatch(/BAZAR[\s\S]{0,220}/)
    expect(html).not.toMatch(/BAZAR[\s\S]{0,220}Pérdida \$0,00/)
  })

  it('con un solo departamento no se imprime el rótulo', () => {
    const html = renderRespuesta(
      itemBase('CONCILIACION'),
      {
        productos: [
          { sku: 'SKU-A', nombre: 'Cloro', teorica: 4, fisica: 1, finalBase: 2, departamento: 'LIMPIEZA' },
          { sku: 'SKU-B', nombre: 'Jabón', teorica: 9, fisica: 8, finalBase: 1, departamento: 'LIMPIEZA' }
        ]
      }
    )

    // Sería una fila repetida por cada producto, sin información.
    expect(html).not.toContain('LIMPIEZA')
  })

  it('si los dos precios se leen iguales, la fila concilia', () => {
    const html = renderRespuesta(
      { ...itemBase('CONCILIACION'), contra_dato: 'FINAL_BASE' },
      {
        productos: [
          // La diferencia existe en el float y no se ve: los dos se muestran
          // $2,56. Marcarla descuadrada mandaría a buscar mercadería que está.
          { sku: 'SKU-CENTIMO', nombre: 'Diferencia invisible', teorica: 2.564, fisica: 2.566, finalBase: 25 },
          { sku: 'SKU-CENTAVO', nombre: 'Un centavo de verdad', teorica: 2.56, fisica: 2.55, finalBase: 25 },
          { sku: 'SKU-LIMPIO', nombre: 'Precio exacto', teorica: 12.5, fisica: 12.5, finalBase: 25 }
        ]
      }
    )

    // Este renderer es el del filtro "No cumplido", así que solo muestra las
    // descuadradas: la prueba de que la fila invisible no cuenta es que no está.
    expect(html).not.toContain('SKU-CENTIMO')
    expect(html).not.toContain('Diferencia invisible')
    expect(html).not.toContain('SKU-LIMPIO')
    expect(html).toContain('1 producto(s) con descuadre')
    expect(html).toContain('tasa de descuadre 66.67%')
    // El centavo que sí existe sale como descuadre, con el signo de plata.
    expect(html).toMatch(/bg-red-100 text-red-700">-\$0,01</)
    // Y los precios se muestran cortados, no redondeados.
    expect(html).not.toContain('$2,57')
    expect(html).toMatch(/tabular-nums text-slate-700[^>]*>\$2,56</)
  })
})