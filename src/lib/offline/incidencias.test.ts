import { describe, it, expect } from 'vitest'
import { pathFotoIncidencia } from './sync'
import { normalizarClave } from './db'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('incidencias · ruta de la foto', () => {
  it('agrupa las fotos del reporte en su propia carpeta del bucket', () => {
    expect(pathFotoIncidencia('inc-1', 'foto-2')).toBe('incidencias/inc-1/foto-2')
  })

  it('no se mezcla con las fotos de evidencia de los ítems', () => {
    // Las evidencias de respuestas viven en otra ruta del mismo bucket: si el
    // reporte compartiera prefijo, un listado por evaluación traería las dos.
    const evidencia = fuente('./transform.ts').match(/export function photoPath[\s\S]{0,220}/)?.[0] ?? ''
    expect(evidencia).toContain('`ev/')
    expect(pathFotoIncidencia('x', 'y')).not.toContain('ev/')
  })
})

describe('incidencias · la ficha se guarda local antes de subir', () => {
  it('existe un store de incidencias en la base local', () => {
    const db = fuente('./db.ts')
    expect(db).toContain("incidentes: { key: string; value: IncidenteRecord }")
    expect(db).toMatch(/createObjectStore\('incidentes'\)/)
  })

  it('cada ficha nace pendiente de subir y con id propio (para resumir tras corte)', () => {
    const db = fuente('./db.ts')
    expect(db).toMatch(/sync: 'pendiente'/)
    expect(db).toMatch(/id: crypto\.randomUUID\(\)/)
  })
})

describe('incidencias · la evaluación también cuenta las pendientes', () => {
  it('el contexto expone y sincroniza las incidencias junto a la cola', () => {
    const ctx = fuente('../../context/OfflineContext.tsx')
    expect(ctx).toContain('incidentesPendientes')
    expect(ctx).toMatch(/pendientes \+ incidentes > 0/)
    expect(ctx).toContain('sincronizarIncidentes()')
  })

  it('"Restaurar app" avisa si quedó una incidencia sin subir', () => {
    const restore = fuente('../restore.ts')
    expect(restore).toContain('r.incidentes > 0')
  })
})

describe('incidencias · el botón flotante está en toda la evaluación', () => {
  it('se monta en la pantalla de evaluar sucursal', () => {
    const pagina = fuente('../../pages/evaluar/EvaluarSucursal.tsx')
    expect(pagina).toContain('<ReportarIncidencia')
    // Con los datos de la evaluación en curso: sin sucursal/fecha no hay a qué asociarlo.
    expect(pagina).toContain('fecha={actual.fecha}')
    expect(pagina).toContain('evaluadorId={profile.id}')
  })

  it('el botón va dentro de la barra de controles, no suelto en la esquina', () => {
    // Regresión delvisibility: como botón flotante con `fixed bottom-5` quedaba
    // detrás de la barra fija de navegación. Tiene que montarse dentro de ella.
    const pagina = fuente('../../pages/evaluar/EvaluarSucursal.tsx')
    const barra = pagina.indexOf('fixed inset-x-0 bottom-0 z-40')
    const boton = pagina.indexOf('<ReportarIncidencia')
    expect(barra).toBeGreaterThan(-1)
    expect(boton).toBeGreaterThan(barra)

    const fab = fuente('../../components/ReportarIncidencia.tsx')
    expect(fab).toContain('aria-label="Reportar incidencia"')
    expect(fab).not.toMatch(/className="fixed bottom-/)
  })

  it('la barra queda en una sola línea: el botón comparte fila con la navegación', () => {
    const pagina = fuente('../../pages/evaluar/EvaluarSucursal.tsx')
    // Un solo contenedor flex con `items-center`: nada se apila en dos alturas.
    expect(pagina).toContain('mx-auto flex w-full max-w-lg items-center gap-1 px-2 py-3')
    // Y sin la fila extra que se había hecho en el intento anterior.
    expect(pagina).not.toContain('mt-2 flex items-center gap-3')
    expect(pagina).not.toMatch(/<div className="h-40" \/>/)
    // Con cinco botones en 360 px, los textos largos se cortan en vez de partir
    // la fila en dos alturas.
    expect(pagina).toMatch(/<span className="truncate">Siguiente módulo<\/span>/)
    expect(pagina).not.toContain('Agregar otro registro')
  })

  it('el formulario acepta descripción y fotos, y avisa que queda guardado sin señal', () => {
    const fab = fuente('../../components/ReportarIncidencia.tsx')
    expect(fab).toContain('<Textarea')
    expect(fab).toContain('<PhotoCapture')
    expect(fab).toContain('queda en el teléfono y sube sola después')
  })
})

describe('incidencias · pantalla independiente en el menú', () => {
  it('ofrece la pantalla desde el menú hamburguesa y protege su ruta', () => {
    const menu = fuente('../../components/layouts/MobileLayout.tsx')
    const app = fuente('../../App.tsx')
    expect(menu).toContain('to="/evaluar/incidencias" label="Incidencias"')
    expect(app).toContain('path="/evaluar/incidencias"')
    expect(app).toContain('<IncidenciasPage />')
  })

  it('mantiene el listado y edición fuera de la pantalla de evaluación', () => {
    const pagina = fuente('../../pages/evaluar/EvaluarSucursal.tsx')
    const incidencias = fuente('../../pages/evaluar/IncidenciasPage.tsx')
    expect(pagina).toContain('<ReportarIncidencia')
    expect(pagina).not.toContain('Incidencias de la visita')
    expect(incidencias).toContain('listIncidentes()')
    expect(incidencias).toContain(".from('incidencias')")
    expect(incidencias).toContain('updateIncidente(editando.id')
  })
})

describe('incidencias · el Líder las ve en el detalle de la evaluación', () => {
  it('la sección va montada en el detalle', () => {
    const detalle = fuente('../../pages/EvaluacionDetalle.tsx')
    expect(detalle).toContain('<IncidenciasEvaluacion evaluacionId={evaluacion.id} />')
  })

  it('si la tabla aún no existe en Supabase, la pantalla no se rompe', () => {
    const panel = fuente('../../components/IncidenciasEvaluacion.tsx')
    expect(panel).toContain('setError(queryError.message)')
    expect(panel).toContain('setFilas(filasNormalizadas)')
  })
})

describe('incidencias · SQL de Supabase', () => {
  const sql = fuente('../../../supabase/incidencias.sql')

  it('crea la tabla con RLS y los índices de consulta', () => {
    expect(sql).toContain('create table if not exists public.incidencias')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('idx_incidencias_evaluacion')
  })

  it('solo el evaluador asignado y con evaluación activa puede reportar', () => {
    expect(sql).toContain('puede_reportar_incidencia')
    expect(sql).toMatch(/with check \(\s*auth\.uid\(\) = evaluador_id/)
    // La función exige evaluación ACTIVA: reportar no es una puerta trasera para
    // escribir en evaluaciones cerradas.
    expect(sql).toMatch(/ev\.estado = 'ACTIVA'/)
  })

  it('el evaluador dueño puede ver y borrar sus fotos; el Líder puede verlas', () => {
    expect(sql).toContain('storage_incidencias_select')
    expect(sql).toMatch(/bucket_id = 'evidencias'/)
    expect(sql).toContain('storage_incidencias_delete')
    expect(sql).toContain('storage_incidencias_update')
    expect(sql).toMatch(/public\.es_lider\(\)\s+or exists/)
    expect(sql).toContain('i.evaluador_id = auth.uid()')
    expect(sql).toContain("name like 'incidencias/' || i.id::text || '/%'")
  })
})

describe('incidencias · edición de fotos', () => {
  it('permite reemplazar fotos en la pantalla y persiste las rutas actualizadas', () => {
    const pagina = fuente('../../pages/evaluar/IncidenciasPage.tsx')
    expect(pagina).toContain('<PhotoCapture')
    expect(pagina).toContain(".from('evidencias').upload(path")
    expect(pagina).toContain('.update({ descripcion: texto, fotos: fotosFinales, responsables })')
    expect(pagina).toContain(".from('evidencias').remove(quitarFotos)")
  })
})

describe('incidencias · responsables', () => {
  const sql = fuente('../../../supabase/incidencias.sql')

  it('la columna es un jsonb con default de array vacío', () => {
    // El default importa: sin él, una incidencia insertada por el sync sin la
    // columna (por ejemplo una fila vieja) queda en null y `jsonb_typeof` da
    // null. Con `[]` siempre hay un array y el lector no tiene que adivinar.
    expect(sql).toMatch(
      /add column if not exists responsables jsonb not null default '\[\]'::jsonb/
    )
    expect(sql).toContain('comment on column public.incidencias.responsables')
  })

  it('la marca `por_validar` viaja al servidor, no se queda en el teléfono', () => {
    // El Líder ve las incidencias desde la nube, sin pasar por el teléfono del
    // evaluador. Si la marca no subiera, ahí parecerían todos verificados.
    const sync = fuente('./sync.ts')
    expect(sync).toMatch(/responsables: responsablesAColumna\(normalizarResponsables\(inc\.responsables\)\)/)
  })

  it('el formulario de reportar monta el buscador', () => {
    const fab = fuente('../../components/ReportarIncidencia.tsx')
    expect(fab).toContain('<EditorResponsablesIncidencia')
    expect(fab).toContain('sucursalId={sucursalId}')
    // Y guarda lo que se eligió: si el editor se monta pero el `addIncidente`
    // no lo recibe, los cargos se pierden al cerrar el modal.
    expect(fab).toMatch(/responsables: normalizarResponsables\(responsables\)/)
  })

  it('el buscador se puede usar también al editar, y se guarda en los dos caminos', () => {
    const pagina = fuente('../../pages/evaluar/IncidenciasPage.tsx')
    expect(pagina).toContain('<EditorResponsablesIncidencia')
    // El camino local (todavía en el teléfono) y el remoto (ya subida) tienen
    // que guardar lo mismo: si solo lo guardara uno, dependería de si hay señal.
    expect(pagina).toMatch(/updateIncidente\(editando\.id, \{[\s\S]{0,220}?responsables: normalizarResponsables\(responsablesEditando\)/)
    expect(pagina).toMatch(/\.update\(\{ descripcion: texto, responsables \}\)/)
    expect(pagina).toMatch(/\.update\(\{ descripcion: texto, fotos: fotosFinales, responsables \}\)/)
  })

  it('el listado y la vista del Líder leen la columna', () => {
    const pagina = fuente('../../pages/evaluar/IncidenciasPage.tsx')
    expect(pagina).toContain('created_at, responsables')
    expect(pagina).toContain('<ChipsResponsables valor={incidente.responsables}')

    const lider = fuente('../../components/IncidenciasEvaluacion.tsx')
    expect(lider).toContain('created_at, responsables,')
    expect(lider).toContain('<ChipsResponsables valor={f.responsables}')
    // Y avisa que hay cargos sin verificar, que es el dato que el Líder necesita.
    expect(lider).toContain('pendientes de validar')
  })

  it('el registro local acepta y completa los responsables', () => {
    const db = fuente('./db.ts')
    expect(db).toMatch(/'modulo_id' \| 'responsables' \| 'sync'/)
    // Las fichas ya guardadas no tienen la lista: `listIncidentes` la completa en
    // vez de devolver `undefined` y romper el render.
    expect(db).toMatch(/responsables: normalizarResponsables\(incidente\.responsables\)/)
  })

  it('el buscador solo usa el catálogo de la sucursal y la central', () => {
    const editor = fuente('../../components/EditorResponsablesIncidencia.tsx')
    expect(editor).toContain('catalogoDeIncidencia(branchId)')
    expect(editor).toContain("sucursales.find((s) => s.id === sucursalId)?.branch_id")
    // El texto libre es el camino sin catálogo (sin señal, o sucursal sin
    // branch configurado), y lo que entra por ahí queda marcado.
    expect(editor).toMatch(/agregarResponsable\(([\s\S]{0,200}?), porValidar\)/)
    expect(editor).toMatch(/const agregarLoEscrito = \(\) => agregar\(texto, true\)/)
  })
})

describe('regresión: las claves de respuesta no cambian', () => {
  it('normalizarClave sigue abriendo el separador de instancia', () => {
    expect(normalizarClave('itemA')).toBe('itemA::')
  })
})
