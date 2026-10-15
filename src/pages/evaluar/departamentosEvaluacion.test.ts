import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * El ciclo completo de una evaluación de DEPARTAMENTO: el Líder la apertura,
 * el evaluador la ve en la misma lista que las sucursales, la llena con los
 * módulos de ese departamento, la sube y después aparece en el historial y en
 * el detalle. No se resuelve en una sola pantalla, así que el test repite el
 * recorrido por los archivos por los que pasa la evaluación.
 */
describe('evaluaciones de departamento · el Líder las apertura desde Historial', () => {
  it('el formulario ofrece sucursales y departamentos en una sola unidad', () => {
    const pagina = fuente('../dashboard/Historial.tsx')
    // Un solo selector con las dos clases agrupadas: no hay dos formularios.
    expect(pagina).toContain('<optgroup label="Sucursales">')
    expect(pagina).toContain('<optgroup label="Departamentos">')
    // Una evaluación mide UNA unidad: se manda la que corresponda y la otra en null.
    expect(pagina).toContain('sucursal_id: esDepartamentoAbrir ? null : unidadAbrir')
    expect(pagina).toContain('departamento_id: esDepartamentoAbrir ? unidadAbrir : null')
    expect(pagina).toContain("setError('Selecciona la unidad y la fecha.')")
    // La restricción de unicidad es por unidad y fecha, no por sucursal.
    expect(pagina).toContain('Una por unidad y fecha.')
  })

  it('el historial se puede filtrar por departamento y la tabla nombra la unidad', () => {
    const pagina = fuente('../dashboard/Historial.tsx')
    expect(pagina).toContain('departamento_ids: departamentoSel ? [departamentoSel] : null')
    // Los dos filtros son excluyentes: una fila no puede ser de las dos cosas.
    expect(pagina).toContain("if (e.target.value) setDepartamentoSel('')")
    expect(pagina).toContain('if (e.target.value) setSucursalSel(\'\')')
    expect(pagina).toContain('<th className="px-4 py-3">Unidad</th>')
    expect(pagina).toContain('{ev.departamento?.nombre ?? ev.sucursal?.nombre ?? \'Sucursal\'}')
    expect(pagina).toContain('<Badge color={0}>Departamento</Badge>')
  })

  it('aperturar sin unidad o con la dos puestas es un error que se explica', () => {
    const datos = fuente('../../lib/data/indicadores.ts')
    expect(datos).toContain("if (!args.sucursal_id && !args.departamento_id) {")
    expect(datos).toContain("if (error.code === '23505') return 'Ya existe una evaluación para esa unidad y fecha.'")
    expect(datos).toContain("if (error.code === '23514') return 'Una evaluación pertenece a una sola unidad: sucursal o departamento.'")
  })
})

describe('evaluaciones de departamento · el evaluador las ve en la misma lista', () => {
  it('EvaluarHome junta sucursales y departamentos con la etiqueta', () => {
    const pagina = fuente('./EvaluarHome.tsx')
    expect(pagina).toContain('const departamentosAbiertos = departamentos.filter((departamento) => !!activas[departamento.id])')
    expect(pagina).toContain("to={`/evaluar/departamento/${d.id}`}")
    // La etiqueta es la única pista visual que separa una tarjeta de la otra.
    expect(pagina).toMatch(/<span[^>]*>\s*Departamento\s*<\/span>/)
    // El borrador local se busca también en los departamentos: si no, «Continuar»
    // no aparecería y el avance sin señal quedaría huérfano.
    expect(pagina).toContain('for (const dep of departamentos) {')
    // El mapa de activas acepta las dos clases de id: son UUIDs de tablas distintas.
    expect(pagina).toContain('const unidad = e.departamento_id ?? e.sucursal_id')
  })

  it('la ruta del departamento existe y es más específica que la de sucursal', () => {
    const app = fuente('../../App.tsx')
    expect(app).toContain('path="/evaluar/departamento/:departamentoId"')
    expect(app).toContain('path="/evaluar/departamento/:departamentoId/resumen"')
    // Las dos pantallas siguen protegidas por las mismas roles.
    expect(app).toMatch(/path="\/evaluar\/departamento\/:departamentoId"\s*\n\s*element=\{\s*\n\s*<RequireAuth>/)
  })

  it('EvaluarSucursal lee la unidad de la ruta y no asume sucursal', () => {
    const pagina = fuente('./EvaluarSucursal.tsx')
    expect(pagina).toContain("const { sucursalId = '', departamentoId = '' } = useParams()")
    expect(pagina).toContain('const unidadId = sucursalId || departamentoId')
    expect(pagina).toContain('const rutaBase = departamentoId ? `/evaluar/departamento/${departamentoId}` : `/evaluar/${sucursalId}`')
    // Los módulos/ítems/opciones salen de la configuración de la unidad elegida.
    expect(pagina).toContain('useModulosActivos(sucursalId, departamentoId)')
    expect(pagina).toContain('.filter((e) => (departamentoId ? e.departamento_id === departamentoId : e.sucursal_id === sucursalId))')
    // El borrador y la barra de progreso se cuelgan de la unidad, no de la sucursal.
    expect(pagina).toContain('unidad_id: unidadId')
    expect(pagina).toContain('departamento_id: departamentoId || null')
    expect(pagina).toContain('const existente = await getDraft(unidadId)')
    expect(pagina).toContain('navigate(`${rutaBase}/resumen`)')
    // El botón de incidencia también dice a qué unidad pertenece.
    expect(pagina).toContain('departamentoId={departamentoId}')
  })

  it('EvaluarResumen vuelve a la ruta de su propia unidad', () => {
    const pagina = fuente('./EvaluarResumen.tsx')
    expect(pagina).toContain('const unidadId = sucursalId || departamentoId')
    expect(pagina).toContain('useModulosActivos(sucursalId, departamentoId)')
    expect(pagina).toContain('void getDraft(unidadId).then')
    expect(pagina).toContain('sessionStorage.removeItem(`evx:${unidadId}:mod`)')
  })
})

describe('evaluaciones de departamento · lo que se guarda en el teléfono', () => {
  it('el borrador se identifica por unidad, no por sucursal', () => {
    const db = fuente('../../lib/offline/db.ts')
    expect(db).toMatch(/export interface DraftEval \{[\s\S]{0,600}?unidad_id: string/)
    expect(db).toContain('await db.put(\'drafts\', { ...draft, updated_at: Date.now() }, draft.unidad_id)')
    // Sin `departamento_id` la cola subiría contra `sucursal_id` y no encontraría nada.
    expect(db).toContain('departamento_id?: string | null')
    // La caché del catálogo acepta los departamentos; los caches viejos no los traen
    // y `normalizarCache` los completa con listas vacías.
    expect(db).toContain('departamentos: oLista(c.departamentos)')
    expect(db).toContain('departamentoOpciones: oLista(c.departamentoOpciones)')
  })

  it('la cola elige la columna de la unidad al resolver la evaluación', () => {
    const sync = fuente('../../lib/offline/sync.ts')
    expect(sync).toContain('? base.eq(\'departamento_id\', unidad.departamento_id)')
    expect(sync).toContain(': base.eq(\'sucursal_id\', unidad.unidad_id)')
    // Una incidencia hereda la unidad de su evaluación al insertarse en la nube.
    expect(sync).toContain('sucursal_id: inc.departamento_id ? null : inc.unidad_id')
    expect(sync).toContain('departamento_id: inc.departamento_id ?? null')
    // El permiso de guardado también se resuelve con la configuración de la unidad.
    expect(sync).toContain("supabase.from('departamento_modulos').select('modulo_id').eq('departamento_id', departamentoId)")
  })

  it('el catálogo del teléfono trae departamentos y su configuración', () => {
    const catalogo = fuente('../../lib/data/catalog.ts')
    expect(catalogo).toContain("from('departamentos_centralizados')")
    for (const tabla of ['departamento_modulos', 'departamento_items', 'departamento_opciones']) {
      expect(catalogo).toContain(`from('${tabla}')`)
    }
    const contexto = fuente('../../context/CatalogContext.tsx')
    expect(contexto).toContain('departamentoId?: string | null')
    // La configuración de departamentos vive en el mismo cache que la de sucursales.
    expect(contexto).toContain('setDepartamentoModulos(data.departamentoModulos ?? [])')
  })
})

describe('evaluaciones de departamento · lo que se ve y lo que se imprime', () => {
  it('el detalle nombra la unidad que se midió', () => {
    const detalle = fuente('../EvaluacionDetalle.tsx')
    expect(detalle).toContain('{evaluacion.sucursal?.nombre ?? evaluacion.departamento?.nombre ?? \'Sucursal\'}')
  })

  it('el PDF distingue sucursal de departamento en la portada y en el pie', () => {
    const pdf = fuente('../../lib/pdf/index.ts')
    expect(pdf).toContain("['Departamento', texto(ev.departamento.nombre ?? '—')]")
    expect(pdf).toContain("const pie = `${ev.departamento?.nombre ?? ev.sucursal?.nombre ?? 'Sucursal'} | ${fecha}`")
    // Sin sucursal no hay código de tienda ni dirección que imprimir.
    expect(pdf).toContain('const filasUnidad: string[][] = ev.departamento')
  })

  it('las incidencias de un departamento no llevan sucursal', () => {
    const pagina = fuente('./IncidenciasPage.tsx')
    expect(pagina).toContain('.select(\'id, sucursal_id, departamento_id, fecha, modulo_id, descripcion, fotos, created_at, responsables\')')
    expect(pagina).toContain('departamento_id: (fila.departamento_id as string | null) ?? null')
    // Lo que está en el teléfono se convierte con la misma regla al listar.
    expect(pagina).toContain('sucursal_id: incidente.departamento_id ? null : incidente.unidad_id')
    expect(pagina).toContain('departamento_id: incidente.departamento_id ?? null')
  })
})

describe('evaluaciones de departamento · SQL de Supabase', () => {
  const sql = fuente('../../../supabase/departamentos-evaluaciones.sql')

  it('la evaluación admite departamento y sigue exigiendo exactamente una unidad', () => {
    expect(sql).toContain('alter table public.evaluaciones alter column sucursal_id drop not null')
    expect(sql).toContain('evaluaciones_unidad_check')
    expect(sql).toContain('check ((sucursal_id is null) <> (departamento_id is null))')
    expect(sql).toContain('create unique index if not exists uniq_evaluaciones_departamento_fecha')
  })

  it('la incidencia hereda la unidad con la misma regla', () => {
    expect(sql).toContain('alter table public.incidencias alter column sucursal_id drop not null')
    expect(sql).toContain('incidencias_unidad_check')
    expect(sql).toContain('check ((sucursal_id is null) <> (departamento_id is null))')
  })

  it('los permisos delegan en una sola función para las dos unidades', () => {
    expect(sql).toContain('create or replace function public.modulo_aplica_a_ev(e public.evaluaciones, mod_id uuid)')
    for (const fn of ['puede_ver_evaluacion', 'puede_responder', 'puede_manejar_instancia', 'puede_reportar_incidencia']) {
      expect(sql).toContain(`create or replace function public.${fn}`)
    }
    // La configuración de módulos se lee según la unidad: una tabla o la otra.
    expect(sql).toContain('sucursal_modulos')
    expect(sql).toContain('departamento_modulos')
  })

  it('el esquema consolidado trae lo mismo', () => {
    const schema = fuente('../../../supabase/schema.sql')
    expect(schema).toContain('modulo_aplica_a_ev')
    expect(schema).toContain('evaluaciones_unidad_check')
    expect(schema).toContain('incidencias_unidad_check')
  })
})
