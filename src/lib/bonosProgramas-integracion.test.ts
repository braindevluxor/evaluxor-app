import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Programas de bonificación: el cableado.
 *
 * Las reglas de forma y de permisos tienen sus propios tests
 * (`bonosProgramas-sql.test.ts`); éste mira lo que ningún test de
 * comportamiento ve: que la pantalla exista con SU ruta y SU menú (la misma
 * cerradura que los bonos), que el cargo pueda apuntarle, y —lo que motiva
 * todo esto— que los MÓDULOS sigan aparte.
 */
describe('programas de bonificación · la ruta y el menú', () => {
  const app = fuente('../App.tsx')
  const consola = fuente('../components/layouts/ConsoleLayout.tsx')

  it('la ruta está adentro de la consola y pide los DOS roles de bonos', () => {
    const grupo = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/config/programas-bono"')
    expect(ruta).toBeGreaterThan(-1)
    expect(ruta).toBeGreaterThan(grupo)

    // La MISMA cerradura que /config/bonos: ruta + RLS `puede_bonos`.
    const bloque = app.slice(ruta, ruta + 400)
    expect(bloque).toContain('RequireRol')
    expect(bloque).toContain("roles={['LIDER', 'GERENTE_TH']}")
    expect(app).toContain("import('./pages/config/ProgramasBonos')")
  })

  it('el menú lo ofrece a los dos roles que gestionan bonos', () => {
    expect(consola).toContain("to: '/config/programas-bono'")
    // Aparece en las DOS ramas de `config`: la del Líder (bloque Compensación)
    // y la del Gerente de Talento Humano (sólo bonos).
    const apariciones = consola.split("to: '/config/programas-bono'").length - 1
    expect(apariciones).toBe(2)
    // Y con rótulo en la cabecera, para no llegar a una vista sin título.
    expect(consola).toContain("'/config/programas-bono': {")
    expect(consola).toContain("titulo: 'Programas de bonificación'")
  })
})

describe('programas de bonificación · la pantalla', () => {
  const pagina = fuente('../pages/config/ProgramasBonos.tsx')
  const datos = fuente('./data/bonosProgramas.ts')
  const bonos = fuente('./data/bonos.ts')

  it('todo pasa por el data layer, con sus dos tipos de fuente', () => {
    expect(pagina).toContain('listarProgramas')
    expect(pagina).toContain('agregarFuente')
    expect(pagina).toContain('quitarFuente')
    expect(pagina).toContain('notasDePrograma')
    expect(datos).toContain("from('bonos_programa')")
    expect(datos).toContain("from('bonos_programa_fuente')")
    expect(datos).toContain("from('bonos_programa_nota')")
    // La pantalla no arma consultas sueltas.
    expect(pagina).not.toContain('supabase.rpc(')
    expect(pagina).not.toContain(".from('bonos")
  })

  it('las DOS formas de la nota están en el formulario', () => {
    expect(pagina).toContain('MODULO')
    expect(pagina).toContain('ACTIVIDAD')
    expect(pagina).toContain('Tipo de fuente')
    expect(pagina).toContain('listarModulosFuente')
    // La nota de un módulo NO se carga a mano: el modal de notas sólo
    // ofrece las fuentes ACTIVIDAD.
    expect(pagina).toContain("const actividades = programa.fuentes.filter((f) => f.tipo === 'ACTIVIDAD')")
  })

  it('el CARGO puede apuntar a un programa, filtrado por su periodicidad', () => {
    // En Bonos: el select del formulario…
    expect(bonos).toContain('bono_programa_id')
    expect(paginaBonos()).toContain('Programa de bonificación')
    // …que se guarda en el cargo…
    expect(bonos).toContain('entrada.bono_programa_id')
    // …y sólo se ofrece si coincide el formato de período: un programa
    // mensual no puede alimentar un cargo trimestral.
    expect(paginaBonos()).toContain('p.periodicidad === form.periodicidad')
  })

  it('los MÓDULOS siguen aparte: esta pantalla no los toca', () => {
    // Es el punto de todo el cambio: configurar un programa no es
    // configurar un módulo, y la pantalla de Módulos no sabe nada de esto.
    expect(pagina).not.toContain('guardarModulo')
    expect(pagina).not.toContain('listarModulosAdmin')
    expect(pagina).not.toContain('/config/items')
    expect(fuente('../pages/config/Modulos.tsx')).not.toContain('bonos_programa')
  })
})

/** El código de la pantalla de Bonos, para no releerlo en cada test. */
function paginaBonos(): string {
  return readFileSync(fileURLToPath(new URL('../pages/config/Bonos.tsx', import.meta.url)), 'utf8')
}

describe('programas de bonificación · el SQL', () => {
  it('el bloque existe con sus tres tablas y las tres políticas', () => {
    const sql = bloqueSql('bonos-programas.sql')
    expect(sql).toContain('create table if not exists public.bonos_programa (')
    expect(sql).toContain('create table if not exists public.bonos_programa_fuente (')
    expect(sql).toContain('create table if not exists public.bonos_programa_nota (')
    // La cerradura es la de los bonos, no una nueva.
    for (const tabla of ['bonos_programa', 'bonos_programa_fuente', 'bonos_programa_nota']) {
      expect(sql).toContain(`alter table public.${tabla} enable row level security;`)
      expect(sql).toContain(`using (public.puede_bonos())`)
      expect(sql).toContain(`revoke all on public.${tabla} from anon`)
    }
    // Y el enlace con el cargo, opcional.
    expect(sql).toContain('add column if not exists bono_programa_id uuid')
  })

  it('la fuente separa los DOS tipos y respalda el nombre del módulo', () => {
    const sql = bloqueSql('bonos-programas.sql')
    expect(sql).toContain("check (tipo in ('MODULO', 'ACTIVIDAD'))")
    // Si el módulo se borra, la fuente queda sin módulo pero CON nombre:
    // borrar un módulo no puede borrar el programa.
    expect(sql).toContain('references public.modulos(id) on delete set null')
    expect(sql).toContain('nombre text not null check (length(trim(nombre)) > 0)')
  })
})
