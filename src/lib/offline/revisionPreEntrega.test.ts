import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('revisión pre-entrega · el chequeo sobrevive sin señal', () => {
  it('existe un store local propio y se cuentan las pendientes', () => {
    const db = fuente('./db.ts')
    expect(db).toContain('preentrega: { key: string; value: PreEntregaRecord }')
    expect(db).toMatch(/createObjectStore\('preentrega'\)/)
    expect(db).toContain('export async function preEntregasPendientes()')
  })

  it('se sube con id propio (upsert) y se borra de local al confirmar', () => {
    const sync = fuente('./syncPreEntrega.ts')
    expect(sync).toContain('export async function sincronizarRevisionesPreEntrega')
    // La fila primero y las fotos después: la política de storage exige que la
    // revisión ya exista, al revés que en las fotos de una evaluación.
    expect(sync.indexOf('guardarRevisionPreEntrega')).toBeLessThan(sync.indexOf('storage.from'))
    expect(sync).toContain('marcarPreEntregaEnviada')
  })

  it('la foto vive en su propia carpeta del bucket', () => {
    const sync = fuente('./syncPreEntrega.ts')
    expect(sync).toContain("'pre-entrega'")
    expect(sync).not.toContain("'incidencias'")
    expect(sync).not.toContain("'ev/'")
  })
})

describe('revisión pre-entrega · las preguntas son el catálogo, no texto suelto', () => {
  it('la pantalla renderiza los ítems reales y resuelve su check list', () => {
    const pagina = fuente('../../pages/herramientas/RevisionPreEntrega.tsx')
    expect(pagina).toContain('<ItemRenderer')
    expect(pagina).toContain('resolverPregunta')
    expect(pagina).toContain('<FirmaCanvas')
  })

  it('el módulo-herramienta se saca de la evaluación pero se puede configurar', () => {
    const ctx = fuente('../../context/CatalogContext.tsx')
    expect(ctx).toContain('useModuloHerramienta')
    expect(ctx).toMatch(/m\.activo && !m\.herramienta/)
    // En Ítems de evaluación sí aparece: es donde el Líder lo configura.
    const items = fuente('../../pages/config/Items.tsx')
    expect(items).not.toContain('!m.herramienta')
  })

  it('no se asigna por usuario ni por sucursal', () => {
    expect(fuente('../../pages/config/Usuarios.tsx')).toContain('mods.filter((m) => !m.herramienta)')
    expect(fuente('../../pages/config/SucursalConfig.tsx')).toContain('mods.filter((m) => !m.herramienta)')
  })
})

describe('revisión pre-entrega · entra desde el menú y guarda su propia tabla', () => {
  it('la ruta está protegida y el menú apunta a ella', () => {
    const app = fuente('../../App.tsx')
    const menu = fuente('../../components/layouts/MobileLayout.tsx')
    expect(app).toContain('path="/herramientas/revision-pre-entrega"')
    expect(app).toContain('<RevisionPreEntregaPage />')
    expect(menu).toContain('to="/herramientas/revision-pre-entrega"')
    expect(menu).toContain('label="Revisión Pre-Entrega"')
  })
})

describe('revisión pre-entrega · SQL de Supabase', () => {
  const sql = fuente('../../../supabase/revision-pre-entrega.sql')

  it('crea la tabla con RLS y la marca de herramienta', () => {
    expect(sql).toContain('create table if not exists public.revision_pre_entrega')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('add column if not exists herramienta')
    expect(sql).toContain("herramienta = 'REVISION_PRE_ENTREGA'")
  })

  it('cada evaluador ve las suyas y el Líder todas', () => {
    expect(sql).toContain('puede_usar_revision_pre_entrega')
    expect(sql).toMatch(/using \(evaluador_id = auth\.uid\(\) or public\.es_lider\(\)\)/)
  })

  it('las fotos se guardan bajo la revisión y no bajo una evaluación', () => {
    expect(sql).toContain('storage_pre_entrega_insert')
    expect(sql).toContain("name like 'pre-entrega/' || r.id::text || '/%'")
    expect(sql).not.toContain('evaluacion_id')
  })

  it('siembra un check list real (opciones por pregunta) más el dictamen', () => {
    expect(sql).toContain("'CHECKLIST'")
    expect(sql).toContain("'CUMPLE_NO_CUMPLE'")
    // Las opciones sembradas son objetos con id/etiqueta, no un campo de texto.
    expect(sql).toMatch(/\{"id":"ppe-doc-1","etiqueta":"SOAT vigente"\}/)
  })
})
