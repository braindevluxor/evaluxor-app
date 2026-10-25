import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SeguimientoVista, DetalleCargo, PanelAlertas } from './Responsables'
import {
  seguimientoResponsables,
  type ConjuntoDatos,
  type ResumenItemFalla
} from '../../lib/data/indicadores'
import type { AlertaCargo, FilaAlerta } from '../../lib/data/alertasCargo'
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

/**
 * Mismos datos con dos ítems más: Norte queda en 75% (amonestación) y Sur en
 * 50% (llamado), para ver los dos umbrales en pantalla con la misma matriz.
 */
function datosNiveles(): ConjuntoDatos {
  const d = datos()
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
  const resp = (evaluacionId: string, itemId: string): Respuesta => ({
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: true, responsables: ['Encargado de turno'] },
    respondido_por: null,
    created_at: ''
  })
  d.items.push(item('i3', 'Casco puesto'), item('i4', 'Mascarilla puesta'))
  d.respuestas.push(resp('ev1', 'i3'), resp('ev1', 'i4'), resp('ev2', 'i3'), resp('ev2', 'i4'))
  return d
}

/** Alerta persistida, para el panel y el detalle. */
function alerta(extra: Partial<AlertaCargo>): AlertaCargo {
  return {
    id: 'a1',
    clave_cargo: 'encargadodeturno',
    cargo: 'Encargado de turno',
    sucursal_id: 's1',
    departamento_id: null,
    nivel: 'AMONESTACION',
    nota: 50,
    estado: 'PENDIENTE',
    atendida_en: null,
    atendida_por: null,
    created_at: '2026-09-10T10:00:00Z',
    sucursal: { nombre: 'Sucursal Norte' },
    ...extra
  }
}

/** Fila del panel de seguimiento. */
function filaAlerta(extra: Partial<FilaAlerta>): FilaAlerta {
  return {
    clave: 'encargadodeturno',
    cargo: 'Encargado de turno',
    unidadId: 's1',
    unidadNombre: 'Sucursal Norte',
    unidadTipo: 'sucursal',
    nota: 75,
    nivel: 'AMONESTACION',
    registro: null,
    ...extra
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

  it('la leyenda de colores es los mismos umbrales que las alertas: 80% y 70%', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={datos()}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        seguimiento={seguimientoResponsables(datos())}
      />
    )

    expect(html).toContain('70–79% · amonestación')
    expect(html).toContain('menos de 70% · llamado de atención')
    // El rojo sólido ya no es «la peor celda» (un ancla relativa): es el llamado.
    expect(html).not.toContain('la peor celda')
  })

  it('cada celda en nivel anuncia el nivel en su aria-label, no sólo el color', () => {
    const d = datosNiveles()
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={d} cargando={false} error={false} onReintentar={() => {}} seguimiento={seguimientoResponsables(d)} />
    )

    // Norte 75% → amonestación; Sur 50% → llamado de atención.
    expect(html).toContain('nota 75%, amonestación. Ver detalle')
    expect(html).toContain('nota 50%, llamado de atención. Ver detalle')
  })

  it('el panel de seguimiento se pinta debajo de la matriz con las filas en nivel', () => {
    const d = datosNiveles()
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={d}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        seguimiento={seguimientoResponsables(d)}
        alertas={[]}
        onRegistrar={() => {}}
        onAtender={() => {}}
      />
    )

    expect(html).toContain('Alertas de seguimiento')
    expect(html).toContain('Por debajo de 80%')
    expect(html).toContain('Registrar amonestación')
    expect(html).toContain('Registrar llamado de atención')
    expect(html).toContain('Sin registrar')
  })

  it('sin callbacks la pantalla queda en modo sólo lectura: se ven los chips, no los botones', () => {
    const d = datosNiveles()
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={d} cargando={false} error={false} onReintentar={() => {}} seguimiento={seguimientoResponsables(d)} />
    )

    expect(html).toContain('Alertas de seguimiento')
    expect(html).not.toContain('Registrar amonestación')
    expect(html).not.toContain('Registrar llamado de atención')
  })
})

describe('PanelAlertas', () => {
  it('cada fila muestra unidad, cargo, nota, nivel, estado y la acción que corresponde', () => {
    const html = renderToStaticMarkup(
      <PanelAlertas
        onRegistrar={() => {}}
        onAtender={() => {}}
        filas={[
          filaAlerta({}),
          filaAlerta({ clave: 'depositaria', cargo: 'Depositaría', nota: 50, nivel: 'LLAMADO', registro: alerta({ id: 'a2', nivel: 'LLAMADO', estado: 'PENDIENTE' }) }),
          filaAlerta({ clave: 'cajero', cargo: 'Cajero', nota: 95, nivel: null, registro: alerta({ id: 'a3', estado: 'ATENDIDA', atendida_en: '2026-09-20T10:00:00Z', atendida: { nombre: 'Ana' } }) })
        ]}
      />
    )

    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Encargado de turno')
    expect(html).toContain('Amonestación')
    expect(html).toContain('Llamado de atención')
    expect(html).toContain('Sin registrar')
    expect(html).toContain('Pendiente')
    expect(html).toContain('Atendida el 20/9/2026 por Ana')
    // La acción es única por fila: o se registra o se atiende, nunca las dos.
    expect(html).toContain('Registrar amonestación')
    expect(html).toContain('Marcar atendida')
    expect(html.match(/Registrar amonestación/g)).toHaveLength(1)
    // Una celda que mejoró quedó sin nivel pero conserva su registro.
    expect(html).toContain('Sin alerta')
  })

  it('el conteo de cabecera separa lo sin registrar, lo pendiente y lo atendido', () => {
    const html = renderToStaticMarkup(
      <PanelAlertas
        filas={[
          filaAlerta({}),
          filaAlerta({ registro: alerta({ id: 'a2', estado: 'PENDIENTE' }) }),
          filaAlerta({ clave: 'cajero', cargo: 'Cajero', registro: alerta({ id: 'a3', estado: 'ATENDIDA' }) })
        ]}
      />
    )

    expect(html).toContain('1 sin registrar')
    expect(html).toContain('1 pendientes')
    expect(html).toContain('1 atendidas')
  })

  it('sin ninguna alerta lo dice, con el umbral de cuándo empieza el seguimiento', () => {
    const html = renderToStaticMarkup(<PanelAlertas filas={[]} />)

    expect(html).toContain('Ningún cargo está en alerta')
    expect(html).toContain('Ninguna nota bajó de 80%')
    expect(html).not.toContain('<table')
  })

  it('si falló la consulta lo dice y ofrece reintentar, sin jurar que no hay alertas', () => {
    const html = renderToStaticMarkup(<PanelAlertas filas={[]} error onReintentar={() => {}} />)

    expect(html).toContain('No se pudieron cargar las alertas')
    expect(html).toContain('Reintentar')
    expect(html).not.toContain('Ningún cargo está en alerta')
  })

  it('mientras carga no muestra ni el panel vacío ni el de error', () => {
    const html = renderToStaticMarkup(<PanelAlertas filas={[]} cargando />)

    expect(html).not.toContain('Ningún cargo está en alerta')
    expect(html).not.toContain('No se pudieron cargar las alertas')
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

  const base = {
    cargo: 'Encargado de turno',
    alcance: 'Sucursal Norte',
    items,
    vecesTotal: 6,
    grupos,
    porModulo,
    visibles: 40,
    onVerMas: () => {},
    onCerrar: () => {}
  }

  it('en nivel sin registro ofrece registrar la alerta y lo dice con chip y botón', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo {...base} nota={75} nivel="AMONESTACION" registro={null} onRegistrar={() => {}} />
    )

    expect(html).toContain('Amonestación')
    expect(html).toContain('Sin registrar')
    expect(html).toContain('Registrar amonestación')
    expect(html).not.toContain('Marcar atendida')
  })

  it('con la alerta pendiente la acción es atender, no registrar una segunda vez', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo
        {...base}
        nota={65}
        nivel="LLAMADO"
        registro={alerta({ nivel: 'LLAMADO', estado: 'PENDIENTE' })}
        onRegistrar={() => {}}
        onAtender={() => {}}
      />
    )

    expect(html).toContain('Llamado de atención')
    expect(html).toContain('Pendiente')
    expect(html).toContain('Marcar atendida')
    expect(html).not.toContain('Registrar llamado')
  })

  it('desde el total de la fila (sin unidad) informa nivel y estado pero no ofrece acciones', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo {...base} nota={75} nivel="AMONESTACION" registro={null} />
    )

    expect(html).toContain('Amonestación')
    expect(html).toContain('Sin registrar')
    expect(html).not.toContain('Registrar amonestación')
    expect(html).not.toContain('Marcar atendida')
  })

  it('una celda sin nivel y sin registro no pinta ningún chip de alerta', () => {
    const html = renderToStaticMarkup(
      <DetalleCargo {...base} nota={95} nivel={null} registro={null} onRegistrar={() => {}} />
    )

    expect(html).toContain('Sin alerta')
    expect(html).not.toContain('Registrar')
  })
})
