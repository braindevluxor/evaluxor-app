import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * La barra de sincronización y lo que dice.
 *
 * El síntoma que abre esto: la barra mostraba «3 evaluación(es) pendiente(s)
 * de sincronizar» al lado de un botón que decía «Sincronizado correctamente.»
 * —dos verdades que se contradecían—, y de fondo la cola no bajaba porque los
 * trabajos habían quedado varados en `processing` tras una subida interrumpida
 * y `procesarCola` los saltaba en silencio hasta el timeout de 15 minutos.
 *
 * Montar la barra exige los tres contextos, así que ésta cubre el cableado que
 * sólo se rompe con un cambio de una línea del fuente.
 */
describe('sincronización · el mensaje dice lo que pasó de verdad', () => {
  const banner = fuente('./MobileLayout.tsx')
  const contexto = fuente('../../context/OfflineContext.tsx')
  const cola = fuente('../../lib/offline/sync.ts')

  it('el resultado sólo describe la cola que se pulsó, y no se queda pegado', () => {
    expect(banner).toContain('pendientesAlPulsar')
    // Si el contador crece (entró trabajo nuevo), el botón vuelve a «Sincronizar».
    expect(banner).toContain('pendientes <= resultado.pendientesAlPulsar')
    expect(banner).toContain("resultado.texto : 'Sincronizar'")
  })

  it('sin trabajo subido no dice «correctamente»', () => {
    // ok:0 fail:0 es «no había nada que subir»: la cola vacía o un sync que no
    // encontró nada por reclamar. Decir lo contrario era mentir.
    expect(banner).toContain("return 'Nada que subir'")
    expect(banner).toContain('if (resultado.ok > 0)')
    expect(banner).toContain('if (resultado.fail > 0)')
  })

  it('un sync manual reclama los trabajos varados; el automático no', () => {
    // El varado está en `processing` porque la subida no terminó: el timeout lo
    // rescata a los 15 minutos, pero un toque del botón es la persona pidiendo
    // que se intente ahora. La subida es idempotente, así que el riesgo de dos
    // pestañas a la vez es subir dos veces lo mismo, no duplicar datos.
    expect(contexto).toContain('sync: (manual?: boolean) => Promise<ResultadoSync>')
    expect(contexto).toContain('procesarCola({ reclamarProcesando: manual })')
    // La programada (1,2 s tras volver la señal) sigue esperando el timeout.
    expect(contexto).toContain('void sync()')
    expect(cola).toContain('opciones: { reclamarProcesando?: boolean } = {}')
    expect(cola).toContain('if (!opciones.reclamarProcesando && !trabajoProcesandoVencido(job)) continue')
    // Los dos botones «Sincronizar» de la app tocan como manual.
    expect(banner).toContain('await sync(true)')
    expect(fuente('../VersionApp.tsx')).toContain('void sync(true)')
  })
})
