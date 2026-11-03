import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History } from 'lucide-react'
import { useCatalog } from '../../context/CatalogContext'
import {
  describirBitacora,
  estadoDe,
  listarBitacora,
  rotuloTabla,
  LIMITE_BITACORA,
  type FilaBitacora,
  type NombresBitacora
} from '../../lib/data/bitacora'
import { listarUsuarios } from '../../lib/data/usuarios'
import { formatearFechaHora } from '../../lib/tiempo'
import { Badge, Button, EmptyState, SkeletonFilas, cn } from '../../components/ui'

/**
 * Configuración > Bitácora: quién cambió qué asignación, y cuándo.
 *
 * Es la respuesta a «¿quién le quitó el módulo X a Juan el martes?» — algo
 * que antes no se podía preguntar, porque desasignar sólo hacía
 * `update activa = false` sin dejar constancia de nada.
 *
 * Sólo el LÍDER entra: lo decide el RLS de la tabla (política
 * `bitacora_asignaciones_select`) y lo replica la ruta con `SoloLider`. Acá no
 * se filtra nada por usuario: si el RLS está bien, ya llegan sólo las suyas.
 *
 * La traducción de ids a frase vive en `lib/data/bitacora` y es pura; esta
 * pantalla sólo la arma con los catálogos y la pinta.
 */

/** Las cuatro tablas del alcance, en el orden en que se muestran. */
const TABLAS: { valor: string; etiqueta: string }[] = [
  { valor: '', etiqueta: 'Todo' },
  { valor: 'asignaciones', etiqueta: 'Evaluador por sucursal' },
  { valor: 'asignaciones_modulos', etiqueta: 'Módulo por evaluador' },
  { valor: 'sucursal_modulos', etiqueta: 'Módulo por sucursal' },
  { valor: 'departamento_modulos', etiqueta: 'Módulo por departamento' }
]

/** El chip de estado, con el color de la escala de la casa. */
function ChipEstado({ estado }: { estado: 'Alta' | 'Baja' | null }) {
  if (!estado) return null
  return <Badge color={estado === 'Alta' ? 2 : 4}>{estado}</Badge>
}

export function BitacoraPage() {
  const { modulos, sucursales, departamentos, cargado } = useCatalog()
  const [filas, setFilas] = useState<FilaBitacora[] | null>(null)
  const [personas, setPersonas] = useState<Map<string, string>>(new Map())
  const [filtro, setFiltro] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  // Una vuelta en el aire bloquea a la siguiente: el montaje y el regreso a
  // la pestaña pueden pisarse, y el resultado viejo llegando último taparía
  // al nuevo.
  const cargandoRef = useRef(false)

  const cargar = useCallback(async () => {
    if (cargandoRef.current) return
    cargandoRef.current = true
    setMsg(null)
    try {
      setFilas(await listarBitacora())
    } catch (e) {
      // Sin la tabla creada el error ya dice qué SQL correr: se muestra tal
      // cual, porque es la única pista de qué hacer.
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar la bitácora.')
      setFilas([])
    } finally {
      cargandoRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!cargado) return
    void cargar()
  }, [cargado, cargar])

  /**
   * Refresco SIN realtime: al volver a la pestaña se vuelve a leer la tabla.
   *
   * Es una consulta nueva, no una suscripción — la pantalla no abre ningún
   * canal ni queda escuchando nada. Con eso alcanza: quien cambia una
   * asignación está en otra pantalla, y al volver acá ya ve el resultado.
   */
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  // Los nombres de las personas van aparte del catálogo: `profiles` no vive
  // en el contexto y sin esto cada fila diría «persona eliminada».
  useEffect(() => {
    let activo = true
    void listarUsuarios()
      .then((usuarios) => {
        if (!activo) return
        setPersonas(new Map(usuarios.map((u) => [u.id, u.nombre || u.email])))
      })
      .catch(() => {
        // Sin nombres la bitácora se lee igual, sólo que sin el responsable.
      })
    return () => {
      activo = false
    }
  }, [])

  /**
   * Los mapas de resolución, uno por render.
   *
   * Van con `useMemo` porque `describirBitacora` se llama por fila y crear
   * cuatro `Map` nuevos en cada pintura haría el listado re-renderizar sin
   * motivo. Las dependencias son los catálogos, que sólo cambian al cargar.
   */
  const nombres: NombresBitacora = useMemo(
    () => ({
      modulos: new Map(modulos.map((m) => [m.id, m.nombre])),
      sucursales: new Map(sucursales.map((s) => [s.id, s.nombre])),
      departamentos: new Map(departamentos.map((d) => [d.id, d.nombre])),
      personas
    }),
    [modulos, sucursales, departamentos, personas]
  )

  const visibles = useMemo(
    () => (filas ?? []).filter((f) => !filtro || f.tabla === filtro),
    [filas, filtro]
  )

  if (!cargado || filas === null) {
    return (
      <div className="space-y-4">
        <p className="max-w-2xl text-sm text-slate-500">
          Historial de cambios en las asignaciones: quién las hizo, cuándo y en qué quedaron.
        </p>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <SkeletonFilas n={6} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-500">
        Historial de cambios en las asignaciones: quién las hizo, cuándo y en qué quedaron. Se
        registra solo —lo escribe la base—, así que no depende de que nadie lo recuerde anotar.
      </p>

      {msg ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{msg}</p>
      ) : null}

      {/* Filtro por tabla: las cuatro del alcance, más Todo. */}
      <div className="flex flex-wrap gap-1.5">
        {TABLAS.map((t) => (
          <button
            key={t.valor}
            type="button"
            onClick={() => setFiltro(t.valor)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
              filtro === t.valor
                ? 'bg-primary text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-primary'
            )}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {!visibles.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <EmptyState
            title={msg ? 'Sin historial' : 'Aún no hay cambios registrados'}
            subtitle={
              msg
                ? 'Cuando se cree la bitácora, los cambios aparecerán acá.'
                : 'Cada alta, baja o eliminación de una asignación va a aparecer en esta lista.'
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Cuándo</th>
                <th className="px-4 py-3">Qué pasó</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Quién</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const quien = f.actor ? personas.get(f.actor) ?? 'Usuario eliminado' : 'Sin sesión'
                return (
                  <tr key={f.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-500">
                      {formatearFechaHora(f.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">
                      {describirBitacora(f, nombres)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-xs text-slate-500">{rotuloTabla(f.tabla)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <ChipEstado estado={estadoDe(f)} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{quien}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filas.length >= LIMITE_BITACORA ? (
        <p className="text-xs text-slate-400">
          Se muestran los últimos {LIMITE_BITACORA} cambios. Si necesitás ver más viejos, decímelo.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => void cargar()} disabled={filas === null}>
          <History className="mr-1.5 h-4 w-4" />
          Actualizar
        </Button>
      </div>
    </div>
  )
}
