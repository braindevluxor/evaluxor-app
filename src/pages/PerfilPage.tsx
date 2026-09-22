import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field, Input, Card } from '../components/ui'

export function PerfilPage() {
  const { profile, session, cambiarPassword } = useAuth()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [cargando, setCargando] = useState(false)

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div>
        <Link to={profile?.rol === 'EVALUADOR' ? '/evaluar' : '/dashboard'} className="text-sm text-primary hover:underline">
          ← Volver
        </Link>
        <h2 className="mt-1 text-xl font-extrabold text-primary-900">Mi perfil</h2>
      </div>

      <Card className="space-y-1">
        <p className="text-sm text-slate-500">Nombre</p>
        <p className="font-semibold text-slate-800">{profile?.nombre || '—'}</p>
        <p className="mt-2 text-sm text-slate-500">Usuario</p>
        <p className="font-semibold text-slate-800">{profile?.usuario || '—'}</p>
        <p className="mt-2 text-sm text-slate-500">Correo</p>
        <p className="font-semibold text-slate-800">{session?.user?.email || profile?.email || '—'}</p>
      </Card>

      <Card>
        <h3 className="mb-3 text-base font-bold text-slate-800">Cambiar contraseña</h3>

        {msg ? (
          <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${msg.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {msg.texto}
          </div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              if (nueva.length < 6) {
                setMsg({ tipo: 'err', texto: 'La nueva contraseña debe tener al menos 6 caracteres.' })
                return
              }
              if (nueva !== confirmar) {
                setMsg({ tipo: 'err', texto: 'Las contraseñas no coinciden.' })
                return
              }
              setCargando(true)
              setMsg(null)
              const r = await cambiarPassword(actual, nueva)
              setCargando(false)
              if (r.error) {
                setMsg({ tipo: 'err', texto: r.error })
              } else {
                setMsg({ tipo: 'ok', texto: 'Contraseña actualizada correctamente.' })
                setActual('')
                setNueva('')
                setConfirmar('')
              }
            })()
          }}
        >
          <Field label="Contraseña actual">
            <Input type="password" value={actual} onChange={(e) => setActual(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Field label="Nueva contraseña" hint="Mínimo 6 caracteres">
            <Input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <Input type="password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required placeholder="••••••••" />
          </Field>
          <Button type="submit" className="w-full" disabled={cargando}>
            {cargando ? 'Guardando…' : 'Actualizar contraseña'}
          </Button>
        </form>
      </Card>
    </div>
  )
}