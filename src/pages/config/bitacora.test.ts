import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from '../../lib/supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La bitácora: desde el trigger de la base hasta la fila de la pantalla.
 *
 * Es una función NUEVA, así que el test cubre el cableado entero: que la
 * ruta esté cerrada, que el menú la liste, que la pantalla lea la tabla
 * correcta y que el trigger que la llena exista en `schema.sql`. Si se rompe
 * un eslabón, el historial queda vacío sin que nadie se entere — que es
 * exactamente el tipo de falla silenciosa que este test busca evitar.
 */

describe('bitácora · entra desde la Consola y sólo el Líder', () => {
  it('la ruta está protegida y el menú la lista', () => {
    const app = fuente('../../App.tsx')
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')

    expect(app).toContain('path="/config/bitacora"')
    // Mismo doble cierre que las demás: `SoloLider` en la ruta y el RLS
    // de la tabla como segunda cerradura.
    expect(app).toContain('<SoloLider><BitacoraPage /></SoloLider>')
    expect(consola).toContain("to: '/config/bitacora'")
    expect(consola).toContain("label: 'Bitácora'")
    // Cabecera de la vista: rótulo y subtítulo que dicen qué es.
    expect(consola).toContain("'/config/bitacora': { titulo: 'Bitácora'")
    expect(consola).toContain('Quién cambió cada asignación, y cuándo')
  })
})

describe('bitácora · la pantalla', () => {
  const pagina = fuente('./Bitacora.tsx')

  it('lee su propia tabla y traduce con el módulo puro', () => {
    expect(pagina).toContain('listarBitacora')
    // La traducción de ids a frase no vive en la pantalla: es pura y se
    // prueba aparte (`lib/data/bitacora.test.ts`).
    expect(pagina).toContain('describirBitacora')
    expect(pagina).toContain('estadoDe')
    expect(pagina).toContain('rotuloTabla')
  })

  it('arma los nombres desde el catálogo y desde los perfiles', () => {
    // Módulos, sucursales y departamentos salen del contexto; las personas
    // no están ahí, así que se piden aparte — sin ellas cada fila diría
    // «persona eliminada».
    expect(pagina).toContain('useCatalog()')
    expect(pagina).toContain('listarUsuarios')
    expect(pagina).toContain('personas')
  })

  it('filtra por las cuatro tablas del alcance', () => {
    for (const tabla of [
      'asignaciones',
      'asignaciones_modulos',
      'sucursal_modulos',
      'departamento_modulos'
    ]) {
      expect(pagina).toContain(`valor: '${tabla}'`)
    }
  })

  it('si la tabla no existe, el aviso dice qué SQL correr', () => {
    // El caso real de la primera vez que se abre: el bloque todavía no se
    // corrió. Un error crudo de Postgres no le diría nada a nadie.
    const datos = fuente('../../lib/data/bitacora.ts')
    // La consulta va partida en dos líneas: se busca sólo el `from`.
    expect(datos).toContain(".from('bitacora_asignaciones')")
    expect(datos).toContain('42P01')
    expect(datos).toContain('bitacora-asignaciones.sql')
  })

  it('si llega al techo de filas lo dice en vez de insinuar que no hay más', () => {
    // El techo está en el módulo de datos; la pantalla es la que avisa.
    const datos = fuente('../../lib/data/bitacora.ts')
    expect(datos).toContain('limite?: number')
    expect(pagina).toContain('filas.length >= 200')
  })
})

describe('bitácora · el trigger que la llena', () => {
  const sql = bloqueSql('bitacora-asignaciones.sql')

  it('la tabla existe, con el check de las tres acciones', () => {
    expect(sql).toContain('create table if not exists public.bitacora_asignaciones')
    expect(sql).toContain("check (accion in ('CREADO', 'MODIFICADO', 'ELIMINADO'))")
  })

  it('las cuatro tablas del alcance tienen su trigger', () => {
    for (const tabla of ['asignaciones', 'asignaciones_modulos', 'sucursal_modulos', 'departamento_modulos']) {
      expect(sql).toContain(`on public.${tabla}`)
    }
    // Cuatro `create trigger`, uno por tabla.
    expect(sql.match(/create trigger trg_bitacora_/g)).toHaveLength(4)
  })

  it('la función es SECURITY DEFINER y el revoke va después de definirla', () => {
    // Sin DEFINER el trigger no podría escribir (la bitácora no tiene política
    // de INSERT) y el Líder no podría guardar NINGUNA asignación. Si el
    // revoke se pusiera antes del `create or replace`, éste reactivaría el
    // permiso heredado de PUBLIC y la puerta quedaría abierta.
    expect(sql).toContain('security definer')
    expect(sql.indexOf('create or replace function public.registrar_bitacora_asignaciones()')).toBeLessThan(
      sql.indexOf('revoke execute on function public.registrar_bitacora_asignaciones()')
    )
  })

  it('un UPDATE que no cambia nada no se registra', () => {
    // Es la decisión que evita que cada guardado de la pantalla de
    // configuración deje filas mudas en el historial.
    expect(sql).toContain('if v_previo = v_nuevo then')
  })

  it('la RLS deja leer sólo al Líder y no deja escribir desde la app', () => {
    expect(sql).toContain('bitacora_asignaciones_select')
    expect(sql).toContain('using (public.es_lider())')
    expect(sql).toContain('enable row level security')
    // Sólo hay una política, la de SELECT: sin la de INSERT, UPDATE o DELETE
    // el RLS bloquea cualquier escritura que no venga del trigger.
    const selects = sql.match(/create policy bitacora_asignaciones_select/g)
    expect(selects).toHaveLength(1)
    expect(sql).not.toContain('create policy bitacora_asignaciones_insert')
    expect(sql).not.toContain('create policy bitacora_asignaciones_update')
    expect(sql).not.toContain('create policy bitacora_asignaciones_delete')
  })

  it('anon queda sin acceso aunque RLS quede apagado', () => {
    expect(sql).toContain("revoke select on public.bitacora_asignaciones from anon")
  })
})
