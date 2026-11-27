import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ETIQUETAS_ROL,
  ROLES_EDITABLES,
  cobraAcuerdos,
  esEquipoAcuerdos,
  esEquipoTi,
  gestionaAcuerdos,
  gestionaMesaAyuda,
  homePorRol,
} from './roles'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Los DOS roles nuevos de la Mesa de Ayuda: GERENTE_TI y TECNICO_TI.
 *
 * Un rol se corta en tres lugares que tienen que decir lo mismo —la casa a
 * la que vuelve, quién atiende y quién administra—, más la pantalla y el
 * menú que lo usan. Si alguno se queda corto, el usuario cae en una ruta
 * que lo rebota o en un botón que RLS rechaza.
 */
describe('roles · el equipo de TI', () => {
  it('casa en la Mesa de Ayuda, y cualquier ruta fuera les vuelve a casa', () => {
    expect(homePorRol('GERENTE_TI')).toBe('/helpdesk')
    expect(homePorRol('TECNICO_TI')).toBe('/helpdesk')
    // Los demás no se mueven: el corte de cada rol sigue donde estaba.
    expect(homePorRol('JUEZ')).toBe('/gran-cosecha/proyectos')
    expect(homePorRol('EVALUADOR')).toBe('/evaluar')
    expect(homePorRol('SIN_ROL')).toBe('/pendiente')
  })

  it('la vista TI es de los TRES; administrar el equipo, sólo de Líder y Gerente', () => {
    for (const rol of ['LIDER', 'GERENTE_TI', 'TECNICO_TI'] as const) {
      expect(esEquipoTi(rol)).toBe(true)
    }
    for (const rol of ['SIN_ROL', 'EVALUADOR', 'GERENTE_S', 'GERENTE_C', 'GERENTE_TH', 'JUEZ'] as const) {
      expect(esEquipoTi(rol)).toBe(false)
    }

    expect(gestionaMesaAyuda('LIDER')).toBe(true)
    expect(gestionaMesaAyuda('GERENTE_TI')).toBe(true)
    // El Técnico atiende, no arma el equipo.
    expect(gestionaMesaAyuda('TECNICO_TI')).toBe(false)
  })

  it('los dos roles nuevos tienen etiqueta y se pueden asignar desde Usuarios', () => {
    expect(ETIQUETAS_ROL.GERENTE_TI).toBeTruthy()
    expect(ETIQUETAS_ROL.TECNICO_TI).toBeTruthy()
    expect(ROLES_EDITABLES).toContain('GERENTE_TI')
    expect(ROLES_EDITABLES).toContain('TECNICO_TI')
    // Y Configuración sigue siendo del Líder: el corte no se corrió.
    expect(fuente('./roles.ts')).toContain("return rol === 'LIDER'")
  })

  it('Acuerdos Comerciales tiene sus TRES roles, con casa en el módulo', () => {
    expect(homePorRol('COOR_ACU')).toBe('/acuerdos')
    expect(homePorRol('AUD_EX')).toBe('/acuerdos')
    expect(ETIQUETAS_ROL.COOR_ACU).toBeTruthy()
    expect(ETIQUETAS_ROL.AUD_EX).toBeTruthy()
    expect(ROLES_EDITABLES).toContain('COOR_ACU')
    expect(ROLES_EDITABLES).toContain('AUD_EX')

    // Los tres entran al módulo; el Líder sólo ve, el Coordinador gestiona
    // y el Auditor cobra — la misma terna que `puede_ver_acuerdos()` en RLS.
    for (const rol of ['LIDER', 'COOR_ACU', 'AUD_EX'] as const) {
      expect(esEquipoAcuerdos(rol)).toBe(true)
    }
    for (const rol of ['EVALUADOR', 'GERENTE_S', 'GERENTE_TI', 'TECNICO_TI'] as const) {
      expect(esEquipoAcuerdos(rol)).toBe(false)
    }
    expect(gestionaAcuerdos('COOR_ACU')).toBe(true)
    expect(gestionaAcuerdos('LIDER')).toBe(false)
    expect(gestionaAcuerdos('AUD_EX')).toBe(false)
    expect(cobraAcuerdos('AUD_EX')).toBe(true)
    expect(cobraAcuerdos('COOR_ACU')).toBe(false)
    expect(cobraAcuerdos('LIDER')).toBe(false)
  })

  it('la consola les ofrece SÓLO la Mesa de Ayuda y la pantalla usa los mismos cortes', () => {
    const consola = fuente('../components/layouts/ConsoleLayout.tsx')
    expect(consola).toContain(
      "if (rol === 'GERENTE_TI' || rol === 'TECNICO_TI') return visibles.filter((s) => s.seccion === 'Soporte')"
    )

    const ayuda = fuente('../pages/helpdesk/Helpdesk.tsx')
    // La vista TI sale de `esEquipoTi` y el equipo de técnicos de
    // `gestionaMesaAyuda`: misma regla que en RLS y en este archivo.
    expect(ayuda).toContain('esEquipoTi(rol)')
    expect(ayuda).toContain('gestionaMesaAyuda(rol)')
  })

  it('el Gerente de Sucursal sólo cuenta lo SUYO y no ve el gráfico por sucursal', () => {
    const ayuda = fuente('../pages/helpdesk/Helpdesk.tsx')

    // El dashboard se acota a SU tienda: KPIs, categoría, carga y urgencias
    // salen de los casos de su sucursal, no de la red.
    expect(ayuda).toContain("const esGerenteSucursal = rol === 'GERENTE_S'")
    expect(ayuda).toContain('tickets.filter((t) => t.branch === sucursalPropia)')

    // El gráfico que COMPARA sucursales no se pinta para él (sólo tendría
    // una curva) y la categoría ocupa el ancho completo en su lugar.
    expect(ayuda).toContain('{esGerenteSucursal ? null : (')
    expect(ayuda).toContain("esGerenteSucursal ? 'lg:col-span-12' : 'lg:col-span-5'")
    // Y se le avisa de dónde salen los números.
    expect(ayuda).toContain('Tus estadísticas: sólo los casos de')
  })

  it('la lista de asignación sale de los usuarios TECNICO_TI y repartir es sólo del Gerente', () => {
    const ayuda = fuente('../pages/helpdesk/Helpdesk.tsx')

    // Candidatos = los USUARIOS con rol TECNICO_TI (no la nómina ni la
    // tabla de guardia)…
    expect(ayuda).toContain('listarCandidatosHelpdesk')
    expect(ayuda).toContain('const [candidatos, setCandidatos]')
    const datos = fuente('../lib/data/helpdesk.ts')
    expect(datos).toContain(".from('profiles')")
    expect(datos).toContain(".eq('rol', 'TECNICO_TI')")
    // …y la identidad con la que se guarda es el USUARIO (no hay DNI).
    expect(datos).toContain('usuarioId: p.id')
    const sqlDebe = fuente('../../supabase/schema.sql')
    expect(sqlDebe).toContain('tecnico_usuario')
    // Repartir es de Gerente o Líder: en la pantalla (los tres selectores y
    // la función)…
    expect(ayuda).toContain('if (!puedeAdministrarTecnicos) return;')
    expect(ayuda).toContain('{puedeAdministrarTecnicos && (')
    expect(ayuda).toContain('{puedeAdministrarTecnicos ? (')

    // …y en la BASE, con el disparador del bloque helpdesk.sql: RLS no puede
    // mirar columnas, así que el corte vive en el trigger.
    expect(sqlDebe).toContain('helpdesk_solo_gerente_asigna')
    expect(sqlDebe).toContain('Sólo el Gerente de TI (o el Líder) asigna casos.')
  })
})
