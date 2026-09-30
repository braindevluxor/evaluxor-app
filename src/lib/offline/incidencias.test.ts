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

  it('el botón va fijo en la esquina, siempre visible', () => {
    const fab = fuente('../../components/ReportarIncidencia.tsx')
    expect(fab).toMatch(/className="fixed bottom-5 right-5/)
    expect(fab).toContain('aria-label="Reportar incidencia"')
  })

  it('el formulario acepta descripción y fotos, y avisa que queda guardado sin señal', () => {
    const fab = fuente('../../components/ReportarIncidencia.tsx')
    expect(fab).toContain('<Textarea')
    expect(fab).toContain('<PhotoCapture')
    expect(fab).toContain('queda en el teléfono y sube sola después')
  })
})

describe('incidencias · el Líder las ve en el detalle de la evaluación', () => {
  it('la sección va montada en el detalle', () => {
    const detalle = fuente('../../pages/EvaluacionDetalle.tsx')
    expect(detalle).toContain('<IncidenciasEvaluacion evaluacionId={evaluacion.id} />')
  })

  it('si la tabla aún no existe en Supabase, la pantalla no se rompe', () => {
    const panel = fuente('../../components/IncidenciasEvaluacion.tsx')
    expect(panel).toMatch(/setFilas\(error \|\| !data \? \[\]/)
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

  it('las fotos quedan privadas y solo el Líder las lee', () => {
    expect(sql).toContain('storage_incidencias_select')
    expect(sql).toMatch(/bucket_id = 'evidencias'/)
  })
})

describe('regresión: las claves de respuesta no cambian', () => {
  it('normalizarClave sigue abriendo el separador de instancia', () => {
    expect(normalizarClave('itemA')).toBe('itemA::')
  })
})
