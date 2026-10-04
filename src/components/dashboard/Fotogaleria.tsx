import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Foto } from '../../lib/types'
import { Skeleton } from '../ui'

export function Fotogaleria({ fotos }: { fotos: Foto[] }) {
  const paths = useMemo(() => fotos.map((foto) => foto.path), [fotos])
  return <FotogaleriaRutas paths={paths} />
}

export function FotogaleriaRutas({ paths: pathsEntrada, compacta = false }: { paths: string[]; compacta?: boolean }) {
  const paths = useMemo(() => {
    const unicos = Array.from(new Set(pathsEntrada))
    return compacta ? unicos : unicos.slice(0, 30)
  }, [compacta, pathsEntrada])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  useEffect(() => {
    let activo = true
    setCargando(true)
    setUrls({})
    setErrorCarga(null)
    if (!paths.length) {
      setCargando(false)
      return
    }
    void (async () => {
      try {
        const { data, error } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
        if (error) throw error
        if (activo) {
          const map: Record<string, string> = {}
          for (const d of data ?? []) if (d.signedUrl && d.path) map[d.path] = d.signedUrl
          setUrls(map)
          const faltantes = paths.filter((path) => !map[path]).length
          if (faltantes) setErrorCarga(`No se encontraron ${faltantes} archivo(s) en el almacenamiento.`)
        }
      } catch (error) {
        if (activo) {
          setUrls({})
          setErrorCarga(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => {
      activo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join('|')])

  if (!paths.length) return null

  return (
    <div className={compacta ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8'}>
      {cargando ? (
        <div className={compacta ? 'col-span-full grid grid-cols-4 gap-1.5' : 'col-span-full grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8'}>
          {Array.from({ length: compacta ? Math.min(paths.length, 4) : 8 }).map((_, i) => (
            <Skeleton key={i} className={compacta ? 'aspect-square w-full rounded-md' : 'aspect-square w-full rounded-lg'} />
          ))}
        </div>
      ) : null}
      {paths
        .filter((p) => urls[p])
        .map((p) => (
          <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className={compacta ? 'block min-w-0' : undefined}>
            <img
              src={urls[p]}
              alt="Evidencia"
              className={compacta
                ? 'aspect-square w-full rounded-md border border-slate-200 object-cover transition-transform hover:scale-110'
                : 'aspect-square w-full rounded-lg border border-slate-200 object-cover transition-transform hover:scale-105'}
              loading="lazy"
            />
          </a>
        ))}
      {errorCarga ? (
        <p role="alert" className="col-span-full text-xs text-red-700">
          No se pudieron cargar las fotos: {errorCarga}
        </p>
      ) : null}
    </div>
  )
}