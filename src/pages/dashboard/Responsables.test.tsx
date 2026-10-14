import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SeguimientoVista, DetalleCargo } from './Responsables'
import {
  seguimientoResponsables,
  type ConjuntoDatos,
  type HallazgoResponsable
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
  const hallazgos: HallazgoResponsable[] = [
    {
      evaluacion_id: 'ev1',
      fecha: '2026-09-15',
      unidad: 'Sucursal Sur',
      modulo: 'Higiene y seguridad',
      item: 'EPP completo',
      puntos: 1
    },
    {
      evaluacion_id: 'ev2',
      fecha: '2026-09-01',
      unidad: 'Sucursal Norte',
      modulo: 'Higiene y seguridad',
      item: 'Piso limpio',
      puntos: 1
    },
    {
      evaluacion_id: 'ev3',
      fecha: '2026-08-20',
      unidad: 'Sucursal Norte',
      modulo: 'Operación de góndola',
      item: 'Etiquetas fuera de zona',
      puntos: 1
    }
  ]
  // El subtotal del módulo es 2 aunque en el panel sólo se esté mostrando uno:
  // la lista se corta, el número de arriba no.
  const grupos = [
    { modulo: 'Higiene y seguridad', puntos: 2 },
    { modulo: 'Operación de góndola', puntos: 1 }
  ]
  const porModulo = new Map<string, HallazgoResponsable[]>([
    ['Higiene y seguridad', hallazgos.slice(0, 1)],
    ['Operación de góndola', hallazgos.slice(2)]
  ])

  it('muestra el cargo, el alcance y el subtotal del módulo', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        alcance="Sucursal Norte"
        nota={87}
        hallazgos={hallazgos}
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
    expect(html).toContain('2 pts')
    expect(html).toContain('EPP completo')
  })

  it('ofrece ver más cuando la lista está cortada', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        nota={null}
        hallazgos={hallazgos}
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
        hallazgos={[]}
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
