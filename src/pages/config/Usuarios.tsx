import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { crearInvitacion, actualizarUsuario, desbloquearUsuario, type ProfileVista } from '../../lib/data/usuarios'
import { supabase } from '../../lib/supabase'
import { ETIQUETAS_ROL, ROLES_EDITABLES } from '../../lib/roles'
import type { Invitacion, Rol, Sucursal } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner } from '../../components/ui'

export function UsuariosPage() {
  const navigate = useNavigate()
  const [usuarios, setUsuarios] = useState<ProfileVista[]>([])
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([])
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editando, setEditando] = useState<ProfileVista | null>(null)
  const [invitando, setInvitando] = useState(false)
  const [linkInv, setLinkInv] = useState('')
  const [desbloqueando, setDesbloqueando] = useState<ProfileVista | null>(null)
  const [passProv, setPassProv] = useState('')
  const [msgDes, setMsgDes] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [cargandoDes, setCargandoDes] = useState(false)

  const cargar = useCallback(async () => {
    setErr(null)
    setCargando(true)
    try {
      const [ur, ir, sr] = await Promise.all([
        supabase.from('profiles').select('*, sucursal:sucursales!profiles_sucursal_id_fkey(id, nombre)').order('created_at', { ascending: false }),
        supabase.from('invitaciones').select('*').order('created_at', { ascending: false }),
        supabase.from('sucursales').select('*').order('nombre')
      ])
      if (ur.error) setErr(`No se pudieron cargar los usuarios: ${ur.error.message}`)
      if (ir.error) setErr((prev) => (prev ? `${prev}\nNo se pudieron cargar las invitaciones: ${ir.error.message}` : `No se pudieron cargar las invitaciones: ${ir.error.message}`))
      if (sr.error) setErr((prev) => (prev ? `${prev}\nNo se cargaron las sucursales: ${sr.error.message}` : `No se cargaron las sucursales: ${sr.error.message}`))
      setUsuarios((ur.data ?? []) as ProfileVista[])
      setInvitaciones((ir.data ?? []) as Invitacion[])
      setSucursales((sr.data ?? []) as Sucursal[])
    } catch (e) {
      setErr(`Error inesperado: ${e instanceof Error ? e.message : String(e)}`)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const pendientes = useMemo(() => invitaciones.filter((i) => !i.usado), [invitaciones])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Usuarios</h2>
          <p className="text-sm text-slate-500">Gestión de roles y accesos (solo Líder)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setInvitando(true)}>＋ Invitar usuario</Button>
        </div>
      </div>

      {pendientes.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-bold text-amber-800">Invitaciones sin usar ({pendientes.length})</h3>
          <div className="space-y-1">
            {pendientes.map((i) => (
              <p key={i.id} className="text-sm text-amber-700">
                {i.email} → {ETIQUETAS_ROL[i.rol]}. Comparte: <code className="rounded bg-amber-100 px-1">{linkRegistro(i)}</code>
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="whitespace-pre-wrap rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      ) : null}

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : (
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
                    {u.bloqueado ? <Badge color={4}>Bloqueado</Badge> : u.activo ? <Badge color={2}>Activo</Badge> : <Badge color={0}>Inactivo</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.bloqueado ? (
                      <>
                        <button onClick={() => { setDesbloqueando(u); setPassProv(''); setMsgDes(null) }} className="font-semibold text-green-700 hover:underline">Desbloquear</button>
                        <span className="mx-1 text-slate-300">·</span>
                      </>
                    ) : null}
                    <button onClick={() => setEditando(u)} className="font-semibold text-primary hover:underline">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editando} onClose={() => setEditando(null)} title="Editar usuario">
        {editando ? (
          <FormUsuario
            usuario={editando}
            sucursales={sucursales}
            onGuardar={async (cambios) => {
              await actualizarUsuario(editando.id, cambios)
              setEditando(null)
              await cargar()
            }}
            onVer={(email) => navigate(`/config/asignaciones?evaluador=${encodeURIComponent(email)}`)}
          />
        ) : null}
      </Modal>

      <Modal open={invitando} onClose={() => { setInvitando(false); setLinkInv('') }} title="Invitar usuario">
        <FormInvitacion
          sucursales={sucursales}
          onCrear={async (data) => {
            const inv = await crearInvitacion(data)
            if (inv) {
              setLinkInv(linkRegistro(inv))
              await cargar()
            }
          }}
        />
        {linkInv ? (
          <div className="mt-4">
            <p className="mb-1 text-sm font-semibold text-slate-700">Comparte este enlace con el nuevo usuario:</p>
            <code className="block break-all rounded-xl bg-slate-50 px-3 py-2 text-xs text-primary">{linkInv}</code>
            <button
              onClick={() => void navigator.clipboard.writeText(linkInv)}
              className="mt-2 text-sm font-semibold text-primary hover:underline"
            >
              Copiar enlace
            </button>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!desbloqueando} onClose={() => setDesbloqueando(null)} title="Desbloquear usuario">
        {desbloqueando ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              setMsgDes(null)
              setCargandoDes(true)
              void desbloquearUsuario(desbloqueando.id, passProv)
                .then(() => {
                  setMsgDes({ tipo: 'ok', texto: 'Usuario desbloqueado. Compartí la contraseña provisional con ' + (desbloqueando.nombre || desbloqueando.usuario) + '.' })
                  setPassProv('')
                  setCargandoDes(false)
                  void cargar()
                })
                .catch((e2) => {
                  setMsgDes({ tipo: 'err', texto: e2 instanceof Error ? e2.message : 'No se pudo desbloquear el usuario.' })
                  setCargandoDes(false)
                })
            }}
          >
            <div>
              <p className="text-sm text-slate-600">
                <strong>{desbloqueando.nombre || desbloqueando.usuario}</strong> está bloqueado por intentos fallidos. Asigná una contraseña provisional
                (mínimo 6 caracteres) para que pueda volver a entrar. Luego debería cambiarla en su perfil.
              </p>
            </div>
            <Field label="Contraseña provisional">
              <Input type="text" value={passProv} onChange={(e) => setPassProv(e.target.value)} required minLength={6} placeholder="Ej: Eva2026Temp" />
            </Field>
            {msgDes ? (
              <div className={`rounded-xl border px-3 py-2 text-sm ${msgDes.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {msgDes.texto}
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDesbloqueando(null)} disabled={cargandoDes}>Cerrar</Button>
              <Button type="submit" disabled={cargandoDes}>{cargandoDes ? 'Desbloqueando…' : 'Desbloquear'}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  )

  function linkRegistro(i: Invitacion): string {
    const origen = window.location.origin
    return `${origen}/registro?token=${encodeURIComponent(i.token)}&email=${encodeURIComponent(i.email)}&usuario=${encodeURIComponent(i.usuario)}`
  }
}

function RolBadge({ rol }: { rol: Rol }) {
  const colores: Record<string, number> = {
    LIDER: 5,
    EVALUADOR: 1,
    GERENTE_S: 0,
    GERENTE_C: 2,
    GERENTE_TH: 3,
    SIN_ROL: 4
  }
  return <Badge color={colores[rol] ?? 0}>{ETIQUETAS_ROL[rol]}</Badge>
}

function FormUsuario({
  usuario: usuarioActual,
  sucursales,
  onGuardar,
  onVer
}: {
  usuario: ProfileVista
  sucursales: Sucursal[]
  onGuardar: (c: { usuario: string; rol: Rol; sucursal_id: string | null; activo: boolean; nombre: string }) => Promise<void>
  onVer: (email: string) => void
}) {
  const [usuario, setUsuario] = useState(usuarioActual.usuario)
  const [rol, setRol] = useState<Rol>(usuarioActual.rol)
  const [sucursal, setSucursal] = useState(usuarioActual.sucursal_id ?? '')
  const [activo, setActivo] = useState(usuarioActual.activo)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({
          usuario,
          rol,
          sucursal_id: rol === 'GERENTE_S' || rol === 'EVALUADOR' ? sucursal || null : null,
          activo,
          nombre: usuarioActual.nombre
        })
      }}
    >
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
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Usuario activo
      </label>
      {usuarioActual.rol === 'EVALUADOR' ? (
        <Button type="button" variant="secondary" className="w-full" onClick={() => onVer(usuarioActual.email)}>
          Ir a asignaciones
        </Button>
      ) : null}
      <Button type="submit" className="w-full">Guardar cambios</Button>
    </form>
  )
}

function FormInvitacion({
  sucursales,
  onCrear
}: {
  sucursales: Sucursal[]
  onCrear: (d: { email: string; usuario: string; rol: Exclude<Rol, 'SIN_ROL'>; sucursal_id: string | null }) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [usuario, setUsuario] = useState('')
  const [rol, setRol] = useState<Exclude<Rol, 'SIN_ROL'>>('EVALUADOR')
  const [sucursal, setSucursal] = useState('')

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onCrear({
          email,
          usuario,
          rol,
          sucursal_id: (rol === 'GERENTE_S' || rol === 'EVALUADOR') && sucursal ? sucursal : null
        })
      }}
    >
      <Field label="Correo del nuevo usuario">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nombre@empresa.com" />
      </Field>
      <Field label="Usuario de acceso" hint="Con este usuario iniciará sesión">
        <Input type="text" value={usuario} onChange={(e) => setUsuario(e.target.value)} required placeholder="Ej: jperez" />
      </Field>
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
      <p className="text-xs text-slate-400">Al registrarse, la cuenta queda vinculada al usuario de acceso indicado. El enlace de registro aparece tras guardar.</p>
      <Button type="submit" className="w-full">Crear invitación</Button>
    </form>
  )
}