import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SeguimientoVista, DetalleCargo } from './Responsables'
import {
  seguimientoResponsables,
  type ConjuntoDatos,
  type ResumenItemFalla
} from '../../lib/data/indicadores'
import type { Item, Modulo, Respuesta, VistaEvaluacion } from '../../lib/types'

/**
 * La vista se renderiza sin efectos (SSR), así que el detalle no se abre acá:
 * lo que se prueba es que la matriz arma columnas, filas y totales a partir de
 * los datos agregados, y sus estados vacíos.
 */
/**
 * Norte (ev1) falla «EPP completo» y acierta «Piso limpio»; Sur (ev2) falla los
 * dos y le atribuye el primero a Depositaría.
 *
 * Los ítems llevan el cargo configurado porque es de ahí de donde sale la nota
 * cuando la respuesta sale bien: un check cumplido no tiene selección del
 * evaluador que repartir.
 */
function datos(): ConjuntoDatos {
  const modulos: Modulo[] = [
    { id: 'm1', nombre: 'Higiene y seguridad', descripcion: '', orden: 0, activo: true, created_at: '' }
  ]
  const item = (id: string, texto: string): Item => ({
    id,
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto,
    opciones: [],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje: 100,
    responsables: ['Encargado de turno'],
    created_at: ''
  })
  const items: Item[] = [item('i1', 'EPP completo'), item('i2', 'Piso limpio')]
  const ev = (id: string, sucursalId: string, nombre: string): VistaEvaluacion => ({
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    departamento_id: null,
    aperturada_por: 'user',
    fecha: '2026-09-01',
    estado: 'CERRADA',
    puntuacion: null,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: { id: sucursalId, nombre, shop_id: null, branch_id: null, direccion: null },
    aperturador: null
  })
  const resp = (evaluacionId: string, itemId: string, cumple: boolean, responsables: string[]): Respuesta => ({
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: cumple, responsables },
    respondido_por: null,
    created_at: ''
  })
  return {
    evaluaciones: [ev('ev1', 's1', 'Sucursal Norte'), ev('ev2', 's2', 'Sucursal Sur')],
    respuestas: [
      resp('ev1', 'i1', false, ['Encargado de turno']),
      resp('ev1', 'i2', true, ['Encargado de turno']),
      resp('ev2', 'i1', false, ['Encargado de turno', 'Depositaría']),
      resp('ev2', 'i2', false, ['Encargado de turno'])
    ],
    items,
    modulos,
    fotos: [],
    sucursalOpciones: [],
    instancias: []
  }
}

describe('SeguimientoVista', () => {
  it('arma la matriz con los cargos, las sucursales y las notas', () => {
    const d = datos()
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={d}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        seguimiento={seguimientoResponsables(d)}
      />
    )

    expect(html).toContain('Encargado de turno')
    expect(html).toContain('Depositaría')
    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Nota por sucursal')
    expect(html).toContain('Nota promedio por cargo')
    // Norte: falló EPP pero acertó Piso limpio → 50%. Sur: falló los dos → 0%.
    expect(html).toContain('>50%</button>')
    expect(html).toContain('>0%</button>')
    // El total del encargado es 100 logrados sobre 400 posibles.
    expect(html).toContain('>25%</button>')
    // Depositaría nunca pasó por Norte: su celda es «—», no un cero.
    expect(html).toContain('—')
  })

  it('mientras carga no dibuja la matriz', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={null} cargando error={false} onReintentar={() => {}} seguimiento={null} />
    )

    expect(html).not.toContain('<table')
  })

  it('si falló la consulta lo dice, en vez de jurar que no hay puntos', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={null} cargando={false} error onReintentar={() => {}} seguimiento={null} />
    )

    expect(html).toContain('No se pudieron cargar los datos')
    expect(html).not.toContain('Todavía no hay notas por cargo')
  })

  it('sin datos dice que todavía no hay notas por cargo', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={{ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [], instancias: [] }}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        seguimiento={null}
      />
    )

    expect(html).toContain('Todavía no hay notas por cargo')
  })
})

describe('DetalleCargo', () => {
  // Un mismo ítem en tres evaluaciones y con dos checks concretos fallados: el
  // detalle tiene que contar las veces y nombrar los checks, no listar renglones
  // iguales.
  const items: ResumenItemFalla[] = [
    {
      item_id: 'i1',
      item: 'EPP completo',
      modulo: 'Higiene y seguridad',
      veces: 3,
      checks: [
        { texto: 'Sin EPP completo', veces: 2 },
        { texto: 'Guantes de seguridad', veces: 1 }
      ],
      unidades: [
        { nombre: 'Sucursal Norte', veces: 2 },
        { nombre: 'Sucursal Sur', veces: 1 }
      ],
      ultima: '2026-09-15'
    },
    {
      item_id: 'i2',
      item: 'Piso limpio',
      modulo: 'Higiene y seguridad',
      veces: 1,
      checks: [],
      unidades: [{ nombre: 'Sucursal Sur', veces: 1 }],
      ultima: '2026-09-01'
    },
    {
      item_id: 'i3',
      item: 'Etiquetas fuera de zona',
      modulo: 'Operación de góndola',
      veces: 2,
      checks: [],
      unidades: [{ nombre: 'Sucursal Norte', veces: 2 }],
      ultima: '2026-08-20'
    }
  ]
  // El subtotal del módulo es 4 aunque en el panel sólo se esté mostrando uno:
  // la lista se corta, el número de arriba no.
  const grupos = [
    { modulo: 'Higiene y seguridad', veces: 4 },
    { modulo: 'Operación de góndola', veces: 2 }
  ]
  const porModulo = new Map<string, ResumenItemFalla[]>([
    ['Higiene y seguridad', items.slice(0, 1)],
    ['Operación de góndola', items.slice(2)]
  ])

  it('nombra los checks concretos que fallaron y cuántas veces', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        alcance="Sucursal Norte"
        nota={87}
        items={items}
        vecesTotal={6}
        grupos={grupos}
        porModulo={porModulo}
        visibles={40}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('Encargado de turno')
    expect(html).toContain('87% de nota')
    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Higiene y seguridad')
    expect(html).toContain('4 veces sin cumplir')
    expect(html).toContain('EPP completo')
    // Cada check con su texto y su conteo: es la respuesta a «¿en qué le falló?».
    expect(html).toContain('Sin EPP completo')
    expect(html).toContain('2 veces sin cumplir')
    expect(html).toContain('Guantes de seguridad')
    expect(html).toContain('1 vez sin cumplir')
    // Con una celda pulsada la sucursal ya está en el título del panel, así que
    // el renglón sólo repite la fecha.
    expect(html).toContain('Última vez: 15/9/2026')
  })

  it('sin una celda pulsada dice en qué sucursales pasó', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        nota={87}
        items={items}
        vecesTotal={6}
        grupos={grupos}
        porModulo={porModulo}
        visibles={40}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('en todas las unidades')
    expect(html).toContain('Sucursal Norte (2)')
    expect(html).toContain('Sucursal Sur (1)')
  })

  it('ofrece ver más cuando la lista está cortada', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        nota={null}
        items={items}
        vecesTotal={6}
        grupos={grupos}
        porModulo={porModulo}
        visibles={1}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('Sin nota')
    expect(html).toContain('Ver más')
    expect(html).toContain('2 restantes')
    expect(html).toContain('en todas las unidades')
  })

  it('sin hallazgos lo dice en vez de dejar el panel vacío', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Limpieza"
        nota={100}
        items={[]}
        vecesTotal={0}
        grupos={[]}
        porModulo={new Map()}
        visibles={40}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('100% de nota')
    expect(html).toContain('Sin hallazgos en este alcance')
  })
})
