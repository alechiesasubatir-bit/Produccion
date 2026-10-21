import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { mensajeError } from '../lib/errores'
import { supabase } from '../lib/supabase'
import { Cargando } from './RequireRol'
import { useSesion } from './useSesion'

// Solo rutas internas: evita redirigir a otro sitio con ?next=https://…
function destinoSeguro(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function Login() {
  const { cargando, usuario } = useSesion()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (cargando) return <Cargando />
  if (usuario) return <Navigate to={destinoSeguro(params.get('next'))} replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
    setEnviando(false)
    if (!err) return // onAuthStateChange actualiza la sesión y este componente redirige
    setError(err.code === 'invalid_credentials' ? 'Email o contraseña incorrectos.' : mensajeError(err).texto)
  }

  return (
    <div className="pantalla-centro">
      <form className="tarjeta-login" onSubmit={entrar}>
        <h1>
          ProdControl
          <small>Subatir · Producción</small>
        </h1>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            required
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
        </label>
        {error && (
          <p className="aviso-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="boton" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
