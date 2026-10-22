import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  cargarParametrosSucursal,
  guardarParametrosSucursal,
  estadoPermiso,
  hoyLocal,
  COLUMNAS_CONTADORES,
  DIAS_AVISO_VENCIMIENTO,
  type ParametrosEditados,
  type EstadoPermiso
} from '../../lib/data/sucursalParametros'
import type { Sucursal, SucursalComputador, SucursalPermiso, TipoComputador } from '../../lib/types'
import { Badge, Button, ButtonIcon, Field, Input, Modal, Select, Skeleton } from '../../components/ui'

/** Rótulo y ayuda de cada contador, en el mismo orden en que se guardan. */
const EQUIPOS: { columna: (typeof COLUMNAS_CONTADORES)[number]; label: string; hint?: string }[] = [
  { columna: 'equipos_pos', label: 'Equipos POS', hint: 'Cajas y terminales de punto de venta' },
  { columna: 'verificadores_precio', label: 'Verificadores de precio' },
  { columna: 'pantallas_publicitarias', label: 'Pantallas publicitarias' },
  { columna: 'cabezales', label: 'Cabezales' },
  { columna: 'pda', label: 'PDA', hint: 'Handhelds de inventario y reposición' }
]

const COLOR_ESTADO: Record<EstadoPermiso, number> = {
  SIN_FECHA: 0,
  VIGENTE: 2,
  POR_VENCER: 3,
  VENCIDO: 4
}

const TEXTO_ESTADO: Record<EstadoPermiso, string> = {
  SIN_FECHA: 'Sin fecha de vencimiento',
  VIGENTE: 'Vigente',
  POR_VENCER: 'Por vencer',
  VENCIDO: 'Vencido'
}

/**
 * Ficha operativa de la sucursal: cuántos equipos de cada tipo hay, qué
 * computadores hay en cada puesto (RRHH, Recibidor…) y qué permisos operativos
 * tiene la tienda al día (sanitario, bomberos…).
 *
 * Va aparte de «Configurar módulos e ítems» porque no es lo mismo: eso define
 * QUÉ se evalúa en la tienda; esto define CON QUÉ CUENTA la tienda, que es lo
 * con lo que se mide después. Los contadores viven en la fila de `sucursales`
 * y las dos listas en sus tablas, así que el guardado toca tres destinos.
 */
export function ParametrosSucursalModal({
  sucursal,
  onClose,
  onGuardado
}: {
  sucursal: Sucursal | null
  onClose: () => void
  onGuardado: () => void
}) {
  const [edit, setEdit] = useState<ParametrosEditados | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sucursal) return
    let activo = true
    setEdit(null)
    setMsg('')
    setError('')
    void cargarParametrosSucursal(sucursal.id)
      .then((p) => {
        if (activo) setEdit(p)
      })
      .catch((e: unknown) => {
        if (activo) setError(`No se pudieron cargar los parámetros: ${detalle(e)}`)
      })
    return () => { activo = false }
  }, [sucursal])

  function cambiarContador(columna: (typeof COLUMNAS_CONTADORES)[number], texto: string) {
    setEdit((prev) => (prev ? { ...prev, [columna]: contar(texto) } : prev))
  }

  function agregarComputador() {
    setEdit((prev) =>
      prev ? { ...prev, computadores: [...prev.computadores, { nombre: '', tipo: 'OPERATIVO', cantidad: 1 }] } : prev
    )
  }

  function cambiarComputador(i: number, fila: Partial<SucursalComputador>) {
    setEdit((prev) => {
      if (!prev) return prev
      const computadores = prev.computadores.map((c, j) => (j === i ? { ...c, ...fila } : c))
      return { ...prev, computadores }
    })
  }

  function agregarPermiso() {
    setEdit((prev) =>
      prev ? { ...prev, permisos: [...prev.permisos, { nombre: '', numero: null, vigente: true, emision: null, vence: null, observacion: null }] } : prev
    )
  }

  function cambiarPermiso(i: number, fila: Partial<SucursalPermiso>) {
    setEdit((prev) => {
      if (!prev) return prev
      const permisos = prev.permisos.map((p, j) => (j === i ? { ...p, ...fila } : p))
      return { ...prev, permisos }
    })
  }

  async function guardar() {
    if (!edit) return
    // Una fila sin nombre no es un dato: no se guarda, se dice cuál es. Guardarla
    // en blanco produciría una fila fantasma que nadie sabe de quién es.
    const pcSinNombre = edit.computadores.findIndex((c) => !c.nombre.trim())
    if (pcSinNombre >= 0) {
      setError(`El computador de la fila ${pcSinNombre + 1} no tiene nombre (p. ej. «RRHH» o «Recibidor»).`)
      return
    }
    const permisoSinNombre = edit.permisos.findIndex((p) => !p.nombre.trim())
    if (permisoSinNombre >= 0) {
      setError(`El permiso de la fila ${permisoSinNombre + 1} no tiene nombre (p. ej. «Sanitario» o «Bomberos»).`)
      return
    }
    setGuardando(true)
    setError('')
    setMsg('')
    try {
      await guardarParametrosSucursal(sucursal!.id, edit)
      setMsg('Parámetros guardados.')
      onGuardado()
    } catch (e: unknown) {
      setError(`No se pudieron guardar los parámetros: ${detalle(e)}`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      open={sucursal != null}
      onClose={onClose}
      title={`Parámetros${sucursal ? ` · ${sucursal.nombre}` : ''}`}
      wide
      footer={
        edit ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
            <Button className="flex-1" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? 'Guardando…' : 'Guardar parámetros'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!edit ? (
        <div className="space-y-4">
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h4 className="mb-1 text-sm font-bold text-primary-900">Equipos de la tienda</h4>
            <p className="mb-3 text-xs text-slate-500">
              Cuántos equipos de cada tipo tiene la sucursal. Es el parámetro con el que se mide contra lo que exige el estándar.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {EQUIPOS.map(({ columna, label, hint }) => (
                <Field key={columna} label={label} hint={hint}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={String(edit[columna])}
                    onChange={(e) => cambiarContador(columna, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-1 text-sm font-bold text-primary-900">Computadores</h4>
            <p className="mb-3 text-xs text-slate-500">
              Uno por puesto, con el nombre del área que atiende (RRHH, Recibidor, Caja…). Marca si es administrativo u operativo.
            </p>
            {edit.computadores.length ? (
              <div className="space-y-2">
                {edit.computadores.map((c, i) => (
                  <div key={c.id ?? `nuevo-${i}`} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-2.5">
                    <Field label="Puesto / área" className="min-w-[10rem] flex-1">
                      <Input
                        value={c.nombre}
                        placeholder="RRHH, Recibidor…"
                        onChange={(e) => cambiarComputador(i, { nombre: e.target.value })}
                      />
                    </Field>
                    <Field label="Tipo" className="w-40">
                      <Select value={c.tipo} onChange={(e) => cambiarComputador(i, { tipo: e.target.value as TipoComputador })}>
                        <option value="ADMINISTRATIVO">Administrativo</option>
                        <option value="OPERATIVO">Operativo</option>
                      </Select>
                    </Field>
                    <Field label="Cantidad" className="w-24">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={String(c.cantidad)}
                        onChange={(e) => cambiarComputador(i, { cantidad: contar(e.target.value) })}
                      />
                    </Field>
                    <ButtonIcon
                      variant="dangerGhost"
                      title={`Quitar el computador «${c.nombre || 'sin nombre'}»`}
                      aria-label="Quitar computador"
                      onClick={() => setEdit({ ...edit, computadores: edit.computadores.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-5 w-5" />
                    </ButtonIcon>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">Sin computadores registrados.</p>
            )}
            <Button variant="secondary" className="mt-3" onClick={agregarComputador}>
              <Plus className="h-4 w-4" /> Agregar computador
            </Button>
          </section>

          <section>
            <h4 className="mb-1 text-sm font-bold text-primary-900">Permisos operativos</h4>
            <p className="mb-3 text-xs text-slate-500">
              Sanitario, bomberos, municipal… el que exija la operación. La fecha de vencimiento marca el estado: «por vencer» avisa con {DIAS_AVISO_VENCIMIENTO} días.
            </p>
            {edit.permisos.length ? (
              <div className="space-y-3">
                {edit.permisos.map((p, i) => {
                  const estado = p.vigente ? estadoPermiso(p.vence, hoyLocal()) : 'SIN_FECHA'
                  return (
                    <div key={p.id ?? `nuevo-${i}`} className="space-y-2 rounded-xl border border-slate-200 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="min-w-[10rem] flex-1 font-semibold"
                          value={p.nombre}
                          placeholder="Sanitario, Bomberos…"
                          onChange={(e) => cambiarPermiso(i, { nombre: e.target.value })}
                        />
                        {p.vigente ? (
                          <Badge color={COLOR_ESTADO[estado]}>{TEXTO_ESTADO[estado]}</Badge>
                        ) : (
                          <Badge>No vigente</Badge>
                        )}
                        <ButtonIcon
                          variant="dangerGhost"
                          title={`Quitar el permiso «${p.nombre || 'sin nombre'}»`}
                          aria-label="Quitar permiso"
                          onClick={() => setEdit({ ...edit, permisos: edit.permisos.filter((_, j) => j !== i) })}
                        >
                          <Trash2 className="h-5 w-5" />
                        </ButtonIcon>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Field label="Nº de resolución">
                          <Input value={p.numero ?? ''} onChange={(e) => cambiarPermiso(i, { numero: e.target.value })} />
                        </Field>
                        <Field label="Emisión">
                          <Input type="date" value={p.emision ?? ''} onChange={(e) => cambiarPermiso(i, { emision: e.target.value })} />
                        </Field>
                        <Field label="Vence">
                          <Input type="date" value={p.vence ?? ''} onChange={(e) => cambiarPermiso(i, { vence: e.target.value })} />
                        </Field>
                        <label className="flex items-center gap-2 self-center pt-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-5 w-5 accent-primary"
                            checked={p.vigente}
                            onChange={(e) => cambiarPermiso(i, { vigente: e.target.checked })}
                          />
                          Vigente hoy
                        </label>
                      </div>
                      <Field label="Observación">
                        <Input value={p.observacion ?? ''} onChange={(e) => cambiarPermiso(i, { observacion: e.target.value })} />
                      </Field>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">Sin permisos registrados.</p>
            )}
            <Button variant="secondary" className="mt-3" onClick={agregarPermiso}>
              <Plus className="h-4 w-4" /> Agregar permiso
            </Button>
          </section>

          {msg ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{msg}</p> : null}
          {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        </div>
      )}
    </Modal>
  )
}

/** Enteros sin negativos: un contador no admite «-2» ni «1,5». */
function contar(texto: string): number {
  const n = Number.parseInt(texto.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function detalle(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
