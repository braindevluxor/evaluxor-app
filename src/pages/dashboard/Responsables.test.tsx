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
function datos(): ConjuntoDatos {
  const modulos: Modulo[] = [
    { id: 'm1', nombre: 'Higiene y seguridad', descripcion: '', orden: 0, activo: true, created_at: '' }
  ]
  const items: Item[] = [
    {
      id: 'i1',
      modulo_id: 'm1',
      tipo: 'CUMPLE_NO_CUMPLE',
      texto: 'EPP completo',
      opciones: [],
      orden: 0,
      requerido: false,
      activo: true,
      puntaje: 100,
      created_at: ''
    }
  ]
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
  const resp = (id: string, responsables: string[]): Respuesta => ({
    id,
    evaluacion_id: id,
    item_id: 'i1',
    instancia_id: null,
    valor: { value: false, responsables },
    respondido_por: null,
    created_at: ''
  })
  return {
    evaluaciones: [ev('ev1', 's1', 'Sucursal Norte'), ev('ev2', 's2', 'Sucursal Sur')],
    respuestas: [resp('ev1', ['Encargado de turno']), resp('ev2', ['Encargado de turno', 'Depositaría'])],
    items,
    modulos,
    fotos: [],
    sucursalOpciones: [],
    instancias: []
  }
}

describe('SeguimientoVista', () => {
  it('arma la matriz con los cargos, las sucursales y los totales', () => {
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
    expect(html).toContain('Total por sucursal')
    // El encargado falló en las dos; Depositaría sólo en Sur.
    expect(html).toContain('>2</button>')
    expect(html).toContain('>1</button>')
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
    expect(html).not.toContain('Todavía no hay puntos sin cumplir')
  })

  it('sin datos dice que todavía no hay puntos sin cumplir', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={{ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [], instancias: [] }}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        seguimiento={null}
      />
    )

    expect(html).toContain('Todavía no hay puntos sin cumplir')
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
        hallazgos={hallazgos}
        grupos={grupos}
        porModulo={porModulo}
        visibles={40}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('Encargado de turno')
    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Higiene y seguridad')
    expect(html).toContain('2 pts')
    expect(html).toContain('EPP completo')
  })

  it('ofrece ver más cuando la lista está cortada', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Encargado de turno"
        hallazgos={hallazgos}
        grupos={grupos}
        porModulo={porModulo}
        visibles={1}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('Ver más')
    expect(html).toContain('2 restantes')
    expect(html).toContain('en todas las unidades')
  })

  it('sin hallazgos lo dice en vez de dejar el panel vacío', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        cargo="Limpieza"
        hallazgos={[]}
        grupos={[]}
        porModulo={new Map()}
        visibles={40}
        onVerMas={() => {}}
        onCerrar={() => {}}
      />
    )

    expect(html).toContain('Sin hallazgos en este alcance')
  })
})
