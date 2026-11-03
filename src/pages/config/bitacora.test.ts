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

  it('si lo que falta es el permiso de la tabla, también dice qué SQL correr', () => {
    // 42501 es el otro modo de fallar de la primera vez: la tabla existe pero
    // `authenticated` no tiene SELECT (bloque corrido a medias). Sin este
    // caso el usuario veía un «No se pudo cargar» sin ninguna pista.
    const datos = fuente('../../lib/data/bitacora.ts')
    expect(datos).toContain("'42501'")
    expect(datos).toContain('bitacora-asignaciones.sql')
  })

  it('si llega al techo de filas lo dice en vez de insinuar que no hay más', () => {
    // El techo vive en una sola constante: el módulo de datos lo aplica al
    // consultar y la pantalla lo usa para avisar, así no divergen.
    const datos = fuente('../../lib/data/bitacora.ts')
    expect(datos).toContain('limite?: number')
    expect(datos).toContain('export const LIMITE_BITACORA = 200')
    expect(datos).toContain('opciones.limite ?? LIMITE_BITACORA')
    expect(pagina).toContain('filas.length >= LIMITE_BITACORA')
    expect(pagina).toContain('LIMITE_BITACORA,')
  })

  it('se relee al volver a la pestaña, sin abrir ningún canal', () => {
    // Sin realtime: la pantalla no se suscribe a nada, sólo vuelve a leer
    // cuando alguien la mira de nuevo. Si algún día aparece un `.channel(`
    // acá, éste es el test que lo hace ruido.
    expect(pagina).toContain("document.addEventListener('visibilitychange'")
    expect(pagina).toContain('document.visibilityState')
    expect(pagina).not.toContain('.channel(')
    expect(pagina).not.toContain('postgres_changes')
    expect(fuente('../../lib/data/bitacora.ts')).not.toContain('.channel(')
  })
})

describe('bitácora · lo que escribe las cuatro tablas no calla el error', () => {
  /** El cuerpo de una función de nivel superior, hasta la llave que la cierra. */
  function cuerpo(src: string, nombre: string): string {
    return src.match(new RegExp(`export async function ${nombre}\\s*\\([^]*?\\n\\}`, 'm'))?.[0] ?? ''
  }

  it('cada escritura levanta el error en vez de darse por guardada', () => {
    // Un builder de PostgREST resuelve con el error DENTRO: si no se lee, la
    // pantalla pinta el cambio igual, la base no escribe nada y la bitácora
    // queda muda. Ese era el modo de falla de las cuatro funciones.
    const usuarios = fuente('../../lib/data/usuarios.ts')
    for (const fn of ['asignarEvaluador', 'desasignarEvaluador', 'asignarModulo', 'desasignarModulo']) {
      expect(cuerpo(usuarios, fn), fn).toContain('if (error) throw new Error')
    }
    // La lectura previa también: sin ella se escribiría a ciegas.
    expect(cuerpo(fuente('../../lib/data/catalog.ts'), 'configurarSucursalModulos')).toContain('throw new Error')
    expect(cuerpo(fuente('../../lib/data/departamentos.ts'), 'configurarDepartamentoModulos')).toContain('throw new Error')
  })

  it('las pantallas avisan en vez de quedarse mudas', () => {
    // Sin catch el rechazo se iba a la consola y el usuario no veía nada:
    // ni se movía el estado local ni decía por qué no se guardó.
    expect(fuente('./Asignaciones.tsx')).toContain("avisar(e instanceof Error ? e.message")
    expect(fuente('./Usuarios.tsx')).toContain("avisar(e instanceof Error ? e.message")
    expect(fuente('./SucursalConfig.tsx')).toContain("avisar(e instanceof Error ? e.message")
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
