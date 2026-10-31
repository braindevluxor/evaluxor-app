import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DetalleVisita, SeguimientoVista } from './Responsables'
import { seguimientoPorEvaluacion } from '../../lib/data/seguimientoEvaluaciones'
import { filasDeAlertas } from '../../lib/data/alertasCargo'
import type { ConjuntoDatos } from '../../lib/data/indicadores'
import type { AlertaCargo, FilaAlerta } from '../../lib/data/alertasCargo'
import type { Item, Modulo, Respuesta, VistaEvaluacion } from '../../lib/types'

/**
 * La vista se renderiza sin efectos (SSR): lo que se prueba es que la lista
 * agrupa unidades → visitas → cargos desde los datos agregados, qué chips y
 * acciones muestra, y cómo se ve el detalle de una visita.
 *
 * Norte tiene DOS visitas: en la primera el cargo se cae, en la segunda se
 * arregla. Así se ve que cada visita manda su propia fila y que la visita buena
 * no genera alerta.
 */

const MODULO: Modulo = { id: 'm1', nombre: 'Higiene y seguridad', descripcion: '', orden: 0, activo: true, created_at: '' }

function ev(id: string, sucursalId: string, nombre: string, fecha: string): VistaEvaluacion {
  return {
    id,
    offline_uuid: id,
    sucursal_id: sucursalId,
    departamento_id: null,
    aperturada_por: 'user',
    fecha,
    estado: 'CERRADA',
    puntuacion: null,
    comentario_general: null,
    abierta_en: null,
    cerrada_en: null,
    created_at: '',
    sucursal: { id: sucursalId, nombre, shop_id: null, branch_id: null, direccion: null },
    aperturador: null
  }
}

function resp(evaluacionId: string, itemId: string, cumple: boolean, responsables: string[]): Respuesta {
  return {
    id: `${evaluacionId}-${itemId}`,
    evaluacion_id: evaluacionId,
    item_id: itemId,
    instancia_id: null,
    valor: { value: cumple, responsables },
    respondido_por: null,
    created_at: ''
  }
}

function datos(): ConjuntoDatos {
  const item: Item = {
    id: 'i1',
    modulo_id: 'm1',
    tipo: 'CUMPLE_NO_CUMPLE',
    texto: 'EPP completo',
    opciones: [],
    orden: 0,
    requerido: false,
    activo: true,
    puntaje: 100,
    responsables: ['Encargado de turno'],
    created_at: ''
  }
  return {
    evaluaciones: [
      ev('ev1', 's1', 'Sucursal Norte', '2026-03-01'),
      ev('ev2', 's1', 'Sucursal Norte', '2026-03-15'),
      ev('ev3', 's2', 'Sucursal Sur', '2026-03-10')
    ],
    respuestas: [
      resp('ev1', 'i1', false, ['Encargado de turno']),
      // La visita 2 aprueba: no genera fila, y es lo que corta la racha.
      resp('ev2', 'i1', true, ['Encargado de turno']),
      resp('ev3', 'i1', false, ['Encargado de turno'])
    ],
    items: [item],
    modulos: [MODULO],
    fotos: [],
    sucursalOpciones: [],
    instancias: []
  }
}

function alerta(extra: Partial<AlertaCargo>): AlertaCargo {
  return {
    id: 'a1',
    clave_cargo: 'encargadodeturno',
    cargo: 'Encargado de turno',
    sucursal_id: 's1',
    departamento_id: null,
    evaluacion_id: 'ev1',
    nivel: 'LLAMADO',
    nota: 0,
    estado: 'PENDIENTE',
    atendida_en: null,
    atendida_por: null,
    created_at: '2026-03-02T10:00:00Z',
    ...extra
  }
}

function fila(extra: Partial<FilaAlerta>): FilaAlerta {
  return {
    clave: 'encargadodeturno',
    cargo: 'Encargado de turno',
    unidadId: 's1',
    unidadNombre: 'Sucursal Norte',
    unidadTipo: 'sucursal',
    evaluacionId: 'ev1',
    fecha: '2026-03-01',
    nota: 0,
    nivel: 'LLAMADO',
    registro: null,
    ...extra
  }
}

function vista(props: Partial<Parameters<typeof SeguimientoVista>[0]> = {}): string {
  const d = datos()
  return renderToStaticMarkup(
    <SeguimientoVista
      datos={d}
      cargando={false}
      error={false}
      onReintentar={() => {}}
      celdas={seguimientoPorEvaluacion(d)}
      alertas={[]}
      onRegistrar={() => {}}
      onAtender={() => {}}
      {...props}
    />
  )
}

describe('SeguimientoVista · la lista por unidad y visita', () => {
  it('muestra cada unidad con sus visitas y la nota del cargo EN ESA visita', () => {
    const html = vista()

    expect(html).toContain('Seguimiento por unidad')
    expect(html).toContain('Alertas de seguimiento')
    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Sucursal Sur')
    // Las visitas donde el cargo quedó en nivel; la visita buena (15/3) no
    // genera fila, que es exactamente el criterio del panel.
    expect(html).toContain('Visita del 1/3/2026')
    expect(html).toContain('Visita del 10/3/2026')
    expect(html).not.toContain('Visita del 15/3/2026')
    expect(html).toContain('Encargado de turno')
    expect(html).toContain('de nota en esta visita')
  })

  it('explica los umbrales y ofrece registrar el nivel que corresponde', () => {
    const html = vista()

    expect(html).toContain('por debajo de 80%')
    expect(html).toContain('70%')
    expect(html).toContain('Registrar llamado de atención')
  })

  it('muestra a quién se le aplicó el llamado, cuando se pudo saber', () => {
    const d = datos()
    const registrada = alerta({ estado: 'ATENDIDA', atendida_en: '2026-03-05T10:00:00Z' })
    const html = renderToStaticMarkup(
      <SeguimientoVista
        datos={d}
        cargando={false}
        error={false}
        onReintentar={() => {}}
        celdas={seguimientoPorEvaluacion(d)}
        alertas={[registrada]}
        onRegistrar={() => {}}
        onAtender={() => {}}
        trabajadoresPorAlerta={new Map([
          [registrada.id, [{ dni: 1, nacionalidad: 'V', nombre: 'Ana Pérez' }, { dni: 2, nacionalidad: 'V', nombre: 'Beto Gómez' }]]
        ])}
      />
    )
    expect(html).toContain('Aplicado a Ana Pérez, Beto Gómez')
  })

  it('cada visita con registro propio muestra su estado, y la limpia no pide acción', () => {
    const html = vista({
      alertas: [
        alerta({ estado: 'ATENDIDA', atendida_en: '2026-03-05T10:00:00Z', atendida: { nombre: 'Ana' } })
      ]
    })

    // La visita 1 quedó atendida: su chip lo dice y no ofrece registrar de nuevo.
    expect(html).toContain('Atendida el 5/3/2026 por Ana')
    // La visita de Sur no tiene registro: sigue pidiendo su propio llamado.
    expect(html).toContain('Registrar llamado de atención')
  })
})

describe('SeguimientoVista · estados', () => {
  it('con error de datos no jura que no hay nada: dice que no sabe y ofrece reintentar', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={null} cargando={false} error onReintentar={() => {}} celdas={null} alertas={[]} />
    )
    expect(html).toContain('No se pudieron cargar los datos')
    expect(html).toContain('Reintentar')
  })

  it('con las alertas caídas no se lista nada: sin el registro no se sabe qué está pendiente', () => {
    const html = vista({ alertas: null, alertasError: true, onReintentarAlertas: () => {} })
    expect(html).toContain('No se pudieron cargar las alertas')
    expect(html).toContain('Reintentar')
    // El nivel se calcula igual, pero no se puede jurar qué visitas ya fueron
    // atendidas: la lista se queda fuera hasta que la consulta vuelva.
    expect(html).not.toContain('Visita del 1/3/2026')
  })

  it('sin nada en nivel lo dice, con el umbral que lo activaría', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={null} cargando={false} error={false} onReintentar={() => {}} celdas={[]} alertas={[]} />
    )
    expect(html).toContain('Ningún cargo está en alerta')
    expect(html).toContain('80%')
  })

  it('sin datos todavía muestra el esqueleto, no un vacío', () => {
    const html = renderToStaticMarkup(
      <SeguimientoVista datos={null} cargando error={false} onReintentar={() => {}} celdas={null} alertas={[]} />
    )
    expect(html).toContain('animate-pulse')
    expect(html).not.toContain('Ningún cargo está en alerta')
  })
})

describe('DetalleVisita · qué le falló en ESA evaluación', () => {
  it('lista los puntos caídos del cargo en esa visita y cuántas veces se repitieron', () => {
    const d = datos()
    // La visita 1 de Norte: el cargo cayó en «EPP completo».
    const f = filasDeAlertas(seguimientoPorEvaluacion(d), []).find((x) => x.evaluacionId === 'ev1')!
    const html = renderToStaticMarkup(<DetalleVisita fila={f} datos={d} onCerrar={() => {}} />)

    expect(html).toContain('Qué le falló en esta visita')
    expect(html).toContain('EPP completo (ítem completo)')
    expect(html).toContain('1 vez sin cumplir en esta unidad')
    // Es la primera vez que cae: no se la puede llamar reincidencia.
    expect(html).toContain('Nueva falla')
    expect(html).not.toContain('Reincidente')
  })

  it('marca Reincidente cuando el mismo punto ya había caído en la visita anterior', () => {
    // Dos visitas seguidas cayendo: la segunda es reincidente.
    const base = datos()
    const d: ConjuntoDatos = {
      ...base,
      evaluaciones: [ev('evA', 's1', 'Sucursal Norte', '2026-04-01'), ev('evB', 's1', 'Sucursal Norte', '2026-04-15')],
      respuestas: [resp('evA', 'i1', false, ['Encargado de turno']), resp('evB', 'i1', false, ['Encargado de turno'])]
    }
    const f = filasDeAlertas(seguimientoPorEvaluacion(d), []).find((x) => x.evaluacionId === 'evB')!
    const html = renderToStaticMarkup(<DetalleVisita fila={f} datos={d} onCerrar={() => {}} />)

    expect(html).toContain('Reincidente')
    expect(html).toContain('2 veces sin cumplir en esta unidad')
    expect(html).toContain('1 vez reincidente')
  })

  it('un cargo sin puntos atribuidos lo explica en vez de mostrar una lista vacía', () => {
    // La visita 2 de Norte aprobó todo: el cargo no tiene nada que mostrar.
    const html = renderToStaticMarkup(
      <DetalleVisita
        fila={fila({ clave: 'otrocargo', cargo: 'Otro cargo', evaluacionId: 'ev2', nota: 100, nivel: null })}
        datos={datos()}
        onCerrar={() => {}}
      />
    )
    expect(html).toContain('Sin puntos caídos atribuidos')
  })
})
