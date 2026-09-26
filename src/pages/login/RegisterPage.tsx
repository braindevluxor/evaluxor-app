import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Button, Field, Input } from '../../components/ui'
import { AuthShell, MarcaAuth, botonAuth, hintAuth, inputAuth, labelAuth } from '../../components/auth/AuthShell'

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
      <AuthShell>
        <div className="text-center">
          <MarcaAuth titulo="Acceso solo por invitación" subtitulo="EvaLuxor" />
          <p className="-mt-6 text-sm leading-relaxed text-primary-200/90">
            Las cuentas las crea el Líder enviando una invitación. Pídele tu enlace de registro para continuar.
          </p>
          <Button className={`mt-8 ${botonAuth}`} onClick={() => navigate('/login')}>
            Ir a iniciar sesión
          </Button>
        </div>
      </AuthShell>
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
    <AuthShell>
      <MarcaAuth titulo="Crear cuenta" subtitulo="Registro por invitación del Líder" />

      <form onSubmit={onSubmit} className="space-y-5">
        <Field label="Correo electrónico (solo para respaldo)" labelClassName={labelAuth}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="nombre@empresa.com"
            className={inputAuth}
          />
        </Field>
        {inviteUsuario ? (
          <Field label="Usuario de acceso" hint="Definido por el Líder en la invitación" labelClassName={labelAuth} hintClassName={hintAuth}>
            <Input type="text" value={inviteUsuario} readOnly tabIndex={-1} className={inputAuth} />
          </Field>
        ) : null}
        <Field label="Contraseña" labelClassName={labelAuth}>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Mínimo 6 caracteres"
            className={inputAuth}
          />
        </Field>
        <Field label="Confirmar contraseña" labelClassName={labelAuth}>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            placeholder="Repite la contraseña"
            className={inputAuth}
          />
        </Field>
        {error ? (
          <p className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-2 text-sm font-medium text-red-200">{error}</p>
        ) : null}
        {okMsg ? (
          <p className="rounded-xl border border-green-400/30 bg-green-500/15 px-3 py-2 text-sm font-medium text-green-200">{okMsg}</p>
        ) : null}
        <Button type="submit" disabled={enviando} className={botonAuth}>
          {enviando ? 'Creando…' : 'Crear cuenta'}
        </Button>
        <p className="pt-1 text-center text-sm text-primary-200/80">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-semibold text-white underline-offset-4 hover:underline">
            Ingresar
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}