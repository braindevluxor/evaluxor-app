import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Button, Field, Input } from '../../components/ui'

export function RegisterPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const inviteEmail = params.get('email') ?? ''
  const inviteUsuario = params.get('usuario') ?? ''
  const { signUp } = useAuth()
  const [email, setEmail] = useState(inviteEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()

  if (!token || !inviteEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-primary px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-primary-50"><ShoppingCart className="h-8 w-8 text-primary-700" /></div>
          <h1 className="text-xl font-extrabold text-primary-900">Acceso solo por invitación</h1>
          <p className="mt-2 text-sm text-slate-500">
            Las cuentas las crea el Líder enviando una invitación. Pídele tu enlace de registro para continuar.
          </p>
          <Button className="mt-5 w-full" onClick={() => navigate('/login')}>Ir a iniciar sesión</Button>
        </div>
      </div>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setEnviando(true)
    const r = await signUp(email, password)
    setEnviando(false)
    if (r.error) {
      setError(r.error)
      return
    }
    setOkMsg('Cuenta creada. Tu rol de invitación se asignó automáticamente. Ya puedes ingresar.')
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-white/10"><ShoppingCart className="h-8 w-8" /></div>
          <h1 className="text-3xl font-extrabold">Crear cuenta</h1>
          <p className="mt-1 text-sm text-primary-200">Registro por invitación del Líder</p>
        </div>
        <form onSubmit={onSubmit} className="rounded-2xl bg-white p-6">
          <div className="space-y-4">
            <Field label="Correo electrónico (solo para respaldo)">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="nombre@empresa.com" />
            </Field>
            {inviteUsuario ? (
              <Field label="Usuario de acceso" hint="Definido por el Líder en la invitación">
                <Input type="text" value={inviteUsuario} readOnly tabIndex={-1} />
              </Field>
            ) : null}
            <Field label="Contraseña">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Mínimo 6 caracteres" />
            </Field>
            <Field label="Confirmar contraseña">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="Repite la contraseña" />
            </Field>
            {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p> : null}
            {okMsg ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{okMsg}</p> : null}
            <Button type="submit" disabled={enviando} className="w-full">
              {enviando ? 'Creando…' : 'Crear cuenta'}
            </Button>
            <p className="text-center text-sm text-slate-500">
              ¿Ya tienes cuenta?{' '}
              <Link to="/login" className="font-semibold text-primary hover:underline">
                Ingresar
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}