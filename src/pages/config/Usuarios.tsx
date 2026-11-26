import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearUsuario, actualizarUsuario, reiniciarContrasena, listarAsignacionesModulosAdmin, asignarModulo, desasignarModulo, listarAsignacionasAdmin, asignarEvaluador, desasignarEvaluador, type CredencialesCreadas, type ProfileVista } from '../../lib/data/usuarios'
import { listarModulosAdmin } from '../../lib/data/catalog'
import { supabase } from '../../lib/supabase'
import { ETIQUETAS_ROL, ROLES_EDITABLES } from '../../lib/roles'
import { avisar } from '../../lib/aviso'
import type { Modulo, Rol, Sucursal } from '../../lib/types'
import { Badge, Button, ButtonIcon, Confirmar, Field, Input, Modal, Select, Skeleton, SkeletonFilas, cn } from '../../components/ui'
import { UltimaSync } from '../../components/UltimaSync'
import { Copy, FolderOpen, KeyRound, Pencil, Snowflake } from 'lucide-react'

export function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<ProfileVista[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editando, setEditando] = useState<ProfileVista | null>(null)
  /** El alta de un usuario: abierto, o cerrado con las credenciales a la vista. */
  const [creando, setCreando] = useState(false)
  const [credenciales, setCredenciales] = useState<CredencialesCreadas | null>(null)
  /** El usuario al que se le está reiniciando la contraseña (`null` = cerrado). */
  const [reiniciando, setReiniciando] = useState<ProfileVista | null>(null)
  const [passNueva, setPassNueva] = useState('')
  const [passRepetida, setPassRepetida] = useState('')
  const [msgReiniciar, setMsgReiniciar] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [cargandoReiniciar, setCargandoReiniciar] = useState(false)
  /** El usuario que se está por congelar (`null` = sin confirmación abierta). */
  const [congelando, setCongelando] = useState<ProfileVista | null>(null)
  const [modulos, setModulos] = useState<Modulo[]>([])
  const [asignados, setAsignados] = useState<Set<string>>(new Set())
  const [asignando, setAsignando] = useState<ProfileVista | null>(null)
  const [cargandoMod, setCargandoMod] = useState(false)
  const [guardandoMod, setGuardandoMod] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setErr(null)
    setCargando(true)
    try {
      const [ur, sr] = await Promise.all([
        supabase.from('profiles').select('*, sucursal:sucursales!profiles_sucursal_id_fkey(id, nombre)').order('created_at', { ascending: false }),
        supabase.from('sucursales').select('*').order('nombre')
      ])
      if (ur.error) setErr(`No se pudieron cargar los usuarios: ${ur.error.message}`)
      if (sr.error) setErr((prev) => (prev ? `${prev}\nNo se cargaron las sucursales: ${sr.error.message}` : `No se cargaron las sucursales: ${sr.error.message}`))
      setUsuarios((ur.data ?? []) as ProfileVista[])
      setSucursales((sr.data ?? []) as Sucursal[])
    } catch (e) {
      setErr(`Error inesperado: ${e instanceof Error ? e.message : String(e)}`)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const duenos = useMemo(() => {
    const m = new Map<string, { id: string; nombre: string }>()
    for (const k of asignados) {
      const [eid, mid] = k.split('|')
      const mod = modulos.find((x) => x.id === mid)
      // En módulos compartidos cualquiera puede estar asignado (no hay "dueño" único).
      if (mod?.compartido) continue
      const ev = usuarios.find((x) => x.id === eid)
      if (!m.has(mid)) m.set(mid, { id: eid, nombre: ev?.nombre || ev?.email || 'Otro evaluador' })
    }
    return m
  }, [asignados, usuarios, modulos])

  const cargarModulos = useCallback(async () => {
    setCargandoMod(true)
    try {
      const [mods, asig] = await Promise.all([listarModulosAdmin(), listarAsignacionesModulosAdmin()])
      // Los módulos-herramienta (Revisión Pre-Entrega) no se asignan a usuarios:
      // los usa quien abre la herramienta, y no puntúan en la evaluación.
      setModulos(mods.filter((m) => !m.herramienta))
      setAsignados(new Set(asig.filter((a) => a.activa).map((a) => `${a.evaluador_id}|${a.modulo_id}`)))
    } finally {
      setCargandoMod(false)
    }
  }, [])

  function abrirAsignacion(u: ProfileVista) {
    setAsignando(u)
    void cargarModulos()
  }

  async function toggleModulo(moduloId: string) {
    if (!asignando) return
    const key = `${asignando.id}|${moduloId}`
    const activo = asignados.has(key)
    setGuardandoMod(key)
    try {
      // El chequeo va ANTES de mover el estado local: si el módulo no está
      // compartido y ya tiene evaluador, la base lo rechaza y el aviso tiene
      // que decirlo en vez de pintar la casilla igual.
      if (activo) await desasignarModulo(asignando.id, moduloId)
      else await asignarModulo(asignando.id, moduloId)
      setAsignados((prev) => {
        const n = new Set(prev)
        if (n.has(key)) n.delete(key)
        else n.add(key)
        return n
      })
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el módulo del evaluador.', 'error')
    } finally {
      setGuardandoMod(null)
    }
  }

  /**
   * CONGELAR: apaga el `activo` del perfil. Con eso se cierran DOS puertas —
   * `intento_login` ya no deja entrar («Usuario no encontrado o inactivo») y
   * `cargarPerfil` de AuthContext cierra la sesión de quien esté adentro en su
   * próximo movimiento (recarga o refresco de token).
   */
  async function congelar() {
    if (!congelando) return
    const nombre = congelando.nombre || congelando.usuario
    try {
      await actualizarUsuario(congelando.id, { activo: false })
      avisar(`«${nombre}» quedó congelado: no puede entrar y se le cerrará la sesión.`)
      setCongelando(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo congelar el usuario.', 'error')
    }
  }

  /** Descongelar vuelve a encender el `activo`: el acceso y la sesión vuelven. */
  async function descongelar(u: ProfileVista) {
    try {
      await actualizarUsuario(u.id, { activo: true })
      avisar(`«${u.nombre || u.usuario}» volvió a estar activo.`)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo descongelar el usuario.', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setCreando(true); setCredenciales(null) }}>＋ Crear usuario</Button>
        </div>
      </div>      {err ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      ) : null}

      {cargando ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <SkeletonFilas n={7} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Correo</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Sucursal</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Últ. sincronización</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{u.nombre || '—'}</td>
                  <td className="px-4 py-3 font-mono text-sm text-primary">{u.usuario || '—'}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <RolBadge rol={u.rol} />
                  </td>
                  <td className="px-4 py-3">{u.sucursal?.nombre || '—'}</td>
                  <td className="px-4 py-3">
                    {u.bloqueado ? <Badge color={4}>Bloqueado</Badge> : u.activo ? <Badge color={2}>Activo</Badge> : <Badge color={0}>Congelado</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <UltimaSync ultimaSync={u.ultima_sync} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Siempre visible: reiniciar sirve para un bloqueado
                          (limpia el bloqueo) y para cualquiera que olvidó su
                          clave. El icono de candado abierto era sólo del
                          bloqueo y escondía la acción al que más la necesita. */}
                      <ButtonIcon
                        variant="primary"
                        onClick={() => {
                          setReiniciando(u)
                          setPassNueva('')
                          setPassRepetida('')
                          setMsgReiniciar(null)
                        }}
                        title="Reiniciar contraseña"
                        aria-label="Reiniciar contraseña"
                      >
                        <KeyRound className="h-5 w-5" />
                      </ButtonIcon>
                      {/* Congelar / descongelar: un clic sobre el `activo`,
                          sin abrir Editar. El congelado pide confirmación (es
                          un clic que saca a alguien de la app); el
                          descongelado va directo, porque deshacer no rompe
                          nada. */}
                      {u.activo ? (
                        <ButtonIcon
                          variant="neutral"
                          onClick={() => setCongelando(u)}
                          title="Congelar"
                          aria-label="Congelar"
                        >
                          <Snowflake className="h-5 w-5" />
                        </ButtonIcon>
                      ) : (
                        <ButtonIcon
                          variant="success"
                          onClick={() => void descongelar(u)}
                          title="Descongelar"
                          aria-label="Descongelar"
                        >
                          <Snowflake className="h-5 w-5" />
                        </ButtonIcon>
                      )}
                      {u.rol === 'EVALUADOR' ? (
                        <ButtonIcon variant="primary" onClick={() => abrirAsignacion(u)} title="Asignar módulos" aria-label="Asignar módulos">
                          <FolderOpen className="h-5 w-5" />
                        </ButtonIcon>
                      ) : null}
                      <ButtonIcon variant="primary" onClick={() => setEditando(u)} title="Editar" aria-label="Editar">
                        <Pencil className="h-5 w-5" />
                      </ButtonIcon>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title="Editar usuario"
        footer={<Button type="submit" form="form-usuario" className="w-full">Guardar cambios</Button>}
      >
        {editando ? (
          <FormUsuario
            usuario={editando}
            sucursales={sucursales}
            onGuardar={async (cambios) => {
              await actualizarUsuario(editando.id, cambios)
              setEditando(null)
              await cargar()
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={creando}
        onClose={() => { setCreando(false); setCredenciales(null) }}
        title="Crear usuario"
        footer={
          credenciales ? (
            <Button className="w-full" onClick={() => { setCreando(false); setCredenciales(null) }}>Listo</Button>
          ) : (
            <Button type="submit" form="form-crear-usuario" className="w-full">Crear usuario</Button>
          )
        }
      >
        {credenciales ? (
          /* Las credenciales, listas para copiar y mandar: no hay enlace que
             la persona tenga que abrir, la cuenta YA existe. */
          <div className="space-y-4">
            <div
              className={`rounded-xl border px-3 py-2 text-sm ${
                credenciales.confirmacionPendiente
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {credenciales.confirmacionPendiente
                ? 'Cuenta creada, pero Supabase pide confirmar el correo antes de dejar entrar. Revisá la configuración de Auth → Sign In / Providers → Email.'
                : 'Cuenta creada. Ya puede entrar con estas credenciales.'}
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="mb-1 text-xs font-extrabold uppercase tracking-wide text-slate-400">
                Compartile estas credenciales
              </p>
              <dl className="space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Usuario</dt>
                  <dd className="font-mono font-semibold text-slate-800">{credenciales.usuario}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Correo</dt>
                  <dd className="font-mono font-semibold text-slate-800">{credenciales.email}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Contraseña</dt>
                  <dd className="font-mono font-semibold text-slate-800">{credenciales.password}</dd>
                </div>
              </dl>
            </div>
            <div className="flex items-center gap-2">
              <ButtonIcon
                variant="primary"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `Usuario: ${credenciales.usuario}\nCorreo: ${credenciales.email}\nContraseña: ${credenciales.password}`
                  )
                }
                title="Copiar credenciales"
                aria-label="Copiar credenciales"
              >
                <Copy className="h-5 w-5" />
              </ButtonIcon>
              <span className="text-xs text-slate-500">Copiar las tres juntas</span>
            </div>
            <p className="text-xs text-slate-500">
              Pedile que cambie su contraseña apenas entre: <strong>Configuración → Cambiar contraseña</strong>.
              La actual queda válida hasta que lo haga.
            </p>
          </div>
        ) : (
          <FormUsuarioNuevo
            sucursales={sucursales}
            onCrear={async (datos) => {
              const creadas = await crearUsuario(datos)
              setCredenciales(creadas)
              await cargar()
            }}
          />
        )}
      </Modal>

      <Modal
        open={!!reiniciando}
        onClose={() => setReiniciando(null)}
        title="Reiniciar contraseña"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setReiniciando(null)} disabled={cargandoReiniciar}>Cerrar</Button>
            <Button type="submit" form="form-reiniciar" disabled={cargandoReiniciar}>{cargandoReiniciar ? 'Reiniciando…' : 'Reiniciar contraseña'}</Button>
          </div>
        }
      >
        {reiniciando ? (
          <form
            id="form-reiniciar"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              setMsgReiniciar(null)
              // Las DOS contraseñas tienen que coincidir: una clave mal
              // tecleada deja al usuario fuera de su propia cuenta.
              if (passNueva !== passRepetida) {
                setMsgReiniciar({ tipo: 'err', texto: 'Las dos contraseñas no coinciden.' })
                return
              }
              setCargandoReiniciar(true)
              void reiniciarContrasena(reiniciando.id, passNueva)
                .then(() => {
                  // Las claves NO se borran: quedan a la vista para que el
                  // Líder pueda copiarlas y compartirlas. Al reabrir el
                  // modal (el botón de la fila) se limpian igual.
                  setMsgReiniciar({
                    tipo: 'ok',
                    texto:
                      'Contraseña reiniciada. Ya puede entrar con la que quedó escrita en los campos de arriba — compartila por un canal confiable. La actual dejó de servir' +
                      (reiniciando.bloqueado ? ' y además se limpió el bloqueo y los intentos fallidos.' : '.')
                  })
                  setCargandoReiniciar(false)
                  void cargar()
                })
                .catch((e2) => {
                  setMsgReiniciar({ tipo: 'err', texto: e2 instanceof Error ? e2.message : 'No se pudo reiniciar la contraseña.' })
                  setCargandoReiniciar(false)
                })
            }}
          >
            <p className="text-sm text-slate-600">
              La contraseña actual de <strong>{reiniciando.nombre || reiniciando.usuario}</strong> deja de
              servir al instante. Escribí una nueva (mínimo 6 caracteres), compartila por un canal
              confiable y quien la reciba podrá entrar a la consola. Él/ella la cambia cuando quiera
              desde su perfil.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contraseña nueva">
                <Input
                  type="text"
                  value={passNueva}
                  onChange={(e) => setPassNueva(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="off"
                  placeholder="Ej: Eva2026Temp"
                />
              </Field>
              <Field label="Repetir contraseña">
                <Input
                  type="text"
                  value={passRepetida}
                  onChange={(e) => setPassRepetida(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="off"
                  placeholder="La misma de nuevo"
                />
              </Field>
            </div>
            {msgReiniciar ? (
              <div className={`rounded-xl border px-3 py-2 text-sm ${msgReiniciar.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {msgReiniciar.texto}
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <Confirmar
        open={!!congelando}
        texto={`¿Congelar a ${congelando ? congelando.nombre || congelando.usuario : ''}? No podrá iniciar sesión y, en su próximo movimiento (recarga o refresco de token), se le cerrará la sesión. Si te congelás a vos mismo, salís de la consola en ese momento.`}
        textoConfirmar="Congelar"
        onConfirm={() => void congelar()}
        onCancel={() => setCongelando(null)}
      />

      <Modal open={!!asignando} onClose={() => setAsignando(null)} title={`Módulos de ${asignando?.nombre || asignando?.email || 'evaluador'}`}>
        {cargandoMod ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
          </div>
        ) : modulos.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {modulos.map((m) => {
              if (!asignando) return null
              const key = `${asignando.id}|${m.id}`
              const activo = asignados.has(key)
              const dueno = duenos.get(m.id)
              const ajeno = !m.compartido && dueno !== undefined && dueno.id !== asignando.id
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={guardandoMod === key || ajeno}
                  onClick={() => void toggleModulo(m.id)}
                  title={ajeno ? `Asignado a ${dueno.nombre}` : m.compartido ? 'Módulo compartido: puede tener varios evaluadores' : undefined}
                  className={cn(
                    'truncate rounded-full border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors disabled:opacity-50',
                    activo
                      ? 'border-primary bg-primary text-white'
                      : ajeno
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-primary'
                  )}
                >
                  {m.nombre}
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {activo ? 'Asignado' : ajeno ? `Otra persona · ${dueno.nombre}` : m.compartido ? 'Compartido · Sin asignar' : 'Sin asignar'}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-400">No hay módulos creados.</p>
        )}
        <p className="mt-4 rounded-xl bg-primary-50 px-3 py-2 text-[11px] leading-relaxed text-primary-700">
            Los módulos etiquetados «Compartido» pueden tener varios evaluadores asignados a la vez y ven el avance del otro en vivo. En los módulos no compartidos, un módulo solo puede estar asignado a un evaluador a la vez; si muestra «Otra persona · X», ya está en uso por ese evaluador.
          </p>
      </Modal>
    </div>
  )
}

function RolBadge({ rol }: { rol: Rol }) {
  const colores: Record<string, number> = {
    LIDER: 5,
    EVALUADOR: 1,
    GERENTE_S: 0,
    GERENTE_C: 2,
    GERENTE_TH: 3,
    SIN_ROL: 4,
    // El equipo de TI: el Gerente manda (mismo tono que el Líder) y el
    // Técnico resuelve (verde), para que se distingan de un vistazo.
    GERENTE_TI: 5,
    TECNICO_TI: 2
  }
  return <Badge color={colores[rol] ?? 0}>{ETIQUETAS_ROL[rol]}</Badge>
}

function FormUsuario({
  usuario: usuarioActual,
  sucursales,
  onGuardar
}: {
  usuario: ProfileVista
  sucursales: Sucursal[]
  onGuardar: (c: { usuario: string; rol: Rol; sucursal_id: string | null; activo: boolean; nombre: string }) => Promise<void>
}) {
  const [nombre, setNombre] = useState(usuarioActual.nombre ?? '')
  const [usuario, setUsuario] = useState(usuarioActual.usuario)
  const [rol, setRol] = useState<Rol>(usuarioActual.rol)
  const [sucursal, setSucursal] = useState(usuarioActual.sucursal_id ?? '')
  const [activo, setActivo] = useState(usuarioActual.activo)

  // Las tiendas que este evaluador puede evaluar (tabla `asignaciones`): era
  // la pantalla «Asignaciones», que ahora vive acá para gestionar todo desde
  // el usuario. `null` mientras carga; el original queda aparte para poder
  // calcular qué alta y qué baja mandar al guardar.
  const [tiendas, setTiendas] = useState<Set<string> | null>(null)
  const [tiendasOriginales, setTiendasOriginales] = useState<Set<string>>(new Set())
  const [cargandoTiendas, setCargandoTiendas] = useState(false)

  useEffect(() => {
    // Sólo para rol EVALUADOR: es el único que usa el flujo móvil con tiendas.
    if (rol !== 'EVALUADOR') return
    let vivo = true
    setCargandoTiendas(true)
    void listarAsignacionasAdmin()
      .then((filas) => {
        if (!vivo) return
        const m = new Set(
          filas.filter((a) => a.evaluador_id === usuarioActual.id && a.activa).map((a) => a.sucursal_id)
        )
        setTiendas(m)
        setTiendasOriginales(new Set(m))
      })
      .catch(() => {
        if (!vivo) return
        setTiendas(new Set())
        setTiendasOriginales(new Set())
      })
      .finally(() => {
        if (vivo) setCargandoTiendas(false)
      })
    return () => {
      vivo = false
    }
  }, [rol, usuarioActual.id])

  async function guardar() {
    // Primero las tiendas: si algo falla, el modal queda abierto con el error
    // y no se pierden los cambios de arriba. Las altas son upsert y las
    // bajas apagan la fila, así que repetir el guardado no duplica nada.
    if (rol === 'EVALUADOR' && tiendas) {
      const aPoner = [...tiendas].filter((id) => !tiendasOriginales.has(id))
      const aQuitar = [...tiendasOriginales].filter((id) => !tiendas.has(id))
      for (const id of aPoner) await asignarEvaluador(usuarioActual.id, id)
      for (const id of aQuitar) await desasignarEvaluador(usuarioActual.id, id)
    }
    await onGuardar({
      nombre,
      usuario,
      rol,
      sucursal_id: rol === 'GERENTE_S' || rol === 'EVALUADOR' ? sucursal || null : null,
      activo
    })
  }

  return (
    <form
      id="form-usuario"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void guardar().catch((err) =>
          avisar(err instanceof Error ? err.message : 'No se pudo guardar el usuario.', 'error')
        )
      }}
    >
      <Field label="Nombre">
        <Input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" />
      </Field>
      <Field label="Usuario de acceso">
        <Input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
      </Field>
      <Field label="Rol">
        <Select value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
          {['SIN_ROL', ...ROLES_EDITABLES].map((r) => <option key={r} value={r}>{ETIQUETAS_ROL[r as Rol]}</option>)}
        </Select>
      </Field>
      <Field label="Sucursal" hint="Necesaria para GERENTE_S y útil para asignar evaluadores">
        <Select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          <option value="">Ninguna</option>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>

      {/* Las tiendas del flujo móvil: era la pantalla «Asignaciones». La de
          arriba es la SUYA (casa); éstas son las que puede evaluar. */}
      {rol === 'EVALUADOR' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Tiendas que puede evaluar</p>
          <p className="text-xs text-slate-500">
            Son las que aparecen en el celular del evaluador. La sucursal de arriba es su casa; éstas son las
            tiendas del flujo móvil.
          </p>
          {cargandoTiendas || !tiendas ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
              {sucursales.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={tiendas.has(s.id)}
                    onChange={() =>
                      setTiendas((prev) => {
                        if (!prev) return prev
                        const n = new Set(prev)
                        if (n.has(s.id)) n.delete(s.id)
                        else n.add(s.id)
                        return n
                      })
                    }
                  />
                  <span className="truncate">{s.nombre}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Usuario activo
      </label>
      <p className="text-xs text-slate-400">
        Apagando esto la cuenta queda <strong>congelada</strong>: no puede entrar y se le cierra la
        sesión en su próximo movimiento. Es lo mismo que hace el botón de la nieve en la lista.
      </p>
    </form>
  )
}

function FormUsuarioNuevo({
  sucursales,
  onCrear
}: {
  sucursales: Sucursal[]
  onCrear: (d: {
    email: string
    usuario: string
    password: string
    nombre?: string
    rol: Exclude<Rol, 'SIN_ROL'>
    sucursal_id: string | null
  }) => Promise<void>
}) {
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [repetir, setRepetir] = useState('')
  const [rol, setRol] = useState<Exclude<Rol, 'SIN_ROL'>>('EVALUADOR')
  const [sucursal, setSucursal] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  return (
    <form
      id="form-crear-usuario"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError('')
        // Las DOS contraseñas tienen que coincidir: una clave mal tecleada
        // deja a la persona fuera de su propia cuenta.
        if (password !== repetir) {
          setError('Las dos contraseñas no coinciden.')
          return
        }
        setEnviando(true)
        void onCrear({
          email,
          usuario,
          password,
          nombre: nombre.trim() || undefined,
          rol,
          sucursal_id: (rol === 'GERENTE_S' || rol === 'EVALUADOR') && sucursal ? sucursal : null
        }).catch((e2) => {
          setError(e2 instanceof Error ? e2.message : 'No se pudo crear el usuario.')
          setEnviando(false)
        })
      }}
    >
      <Field label="Nombre completo" hint="Opcional: es lo que se ve en la consola.">
        <Input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: María Pérez"
          autoComplete="off"
        />
      </Field>
      <Field label="Correo del nuevo usuario">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="nombre@empresa.com"
          autoComplete="off"
        />
      </Field>
      <Field label="Usuario de acceso" hint="Con este usuario iniciará sesión">
        <Input
          type="text"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          required
          placeholder="Ej: jperez"
          autoComplete="off"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contraseña">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="Mínimo 6 caracteres"
            autoComplete="new-password"
          />
        </Field>
        <Field label="Repetir contraseña">
          <Input
            type="password"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            required
            minLength={6}
            placeholder="La misma de nuevo"
            autoComplete="new-password"
          />
        </Field>
      </div>
      <Field label="Rol a asignar">
        <Select value={rol} onChange={(e) => setRol(e.target.value as Exclude<Rol, 'SIN_ROL'>)}>
          {ROLES_EDITABLES.map((r) => <option key={r} value={r}>{ETIQUETAS_ROL[r]}</option>)}
        </Select>
      </Field>
      <Field label="Sucursal">
        <Select value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
          <option value="">Ninguna</option>
          {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>
      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      ) : null}
      <p className="text-xs text-slate-400">
        La cuenta se crea YA: al terminar vas a ver las credenciales para mandárselas. No hay enlace que
        abrir — y esa persona cambia su clave cuando quiera desde Configuración.
      </p>
      {enviando ? <p className="text-xs font-semibold text-slate-500">Creando la cuenta…</p> : null}
    </form>
  )
}