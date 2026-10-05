import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { UltimaSync } from './UltimaSync'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('última sincronización · se ve en Usuarios y en el detalle de evaluación', () => {
  it('la lista de usuarios trae la columna con la última sincronización', () => {
    const src = fuente('../pages/config/Usuarios.tsx')
    expect(src).toContain('Últ. sincronización')
    expect(src).toContain('<UltimaSync ultimaSync={u.ultima_sync} />')
  })

  /* La tarjeta de "Avance por evaluador" se quitó del detalle: tapaba los cargos,
     que es lo que el Líder está mirando. El semáforo sigue en Usuarios, que es
     donde tiene sentido auditar quién tiene avance atascado en el teléfono.

     Con la tarjeta se fue también la consulta de perfiles que la alimentaba: era
     un viaje extra a Supabase en cada recarga (y en vivo cada 15 s) para pintar
     un dato que ya no se pintaba. */
  it('el detalle ya no trae la tarjeta de avance por evaluador', () => {
    const src = fuente('../pages/EvaluacionDetalle.tsx')
    // El encabezado, no el texto suelto: el nombre de la tarjeta queda escrito en
    // un comentario que explica por qué se quitó, y eso no es la tarjeta.
    expect(src).not.toContain('>Avance por evaluador<')
    expect(src).not.toContain('listarPerfilesSync')
    expect(src).not.toContain('<UltimaSync')
  })

  it('el cliente marca la subida solo cuando termina bien, y con throttle', () => {
    const src = fuente('../lib/offline/sync.ts')
    // La marca se pide por RPC al perfil del usuario que sube.
    expect(src).toContain("supabase.rpc('registrar_sync')")
    // Throttle: no se marca en cada respuesta guardada.
    expect(src).toMatch(/INTERVALO_MARCA_SYNC/)
    // Se dispara tras `guardarBorradorNube` y al vaciar la cola offline.
    expect(src.match(/marcarSyncNube\(\)/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('el semáforo distingue nunca / reciente / medio / viejo', () => {
    const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
    const html = (v: string | null) => renderToStaticMarkup(<UltimaSync ultimaSync={v} />)

    expect(html(new Date(Date.now() - 20_000).toISOString())).toContain('recién')
    expect(html(hace(2))).toContain('hace 2 min')
    expect(html(hace(90))).toContain('hace 1 h')
    expect(html(hace(30))).toContain('hace 30 min')
    expect(html(hace(60 * 30))).toContain('ayer')
    expect(html(hace(60 * 72))).toContain('hace 3 días')
    expect(html(null)).toContain('Sin datos')
    // Verde al subir recién, rojo si hace más de un día.
    expect(html(hace(1))).toContain('bg-green-500')
    expect(html(hace(60 * 48))).toContain('bg-red-500')
    expect(html(null)).toContain('bg-slate-300')
  })
})
