import { useCallback, useEffect, useState } from 'react'
import { useSesion } from '../../auth/useSesion'
import { mensajeError } from '../../lib/errores'
import { useEnLinea } from '../../lib/useEnLinea'
import { listarUsuarios, setRol, type UsuarioFila } from './datosPersonas'

const ROLES: { valor: '' | 'planta' | 'panel'; texto: string }[] = [
  { valor: '', texto: 'Sin acceso' },
  { valor: 'planta', texto: 'Planta (tablet)' },
  { valor: 'panel', texto: 'Panel (encargada)' },
]

export function Usuarios() {
  const { usuario } = useSesion()
  const enLinea = useEnLinea()
  const [usuarios, setUsuarios] = useState<UsuarioFila[]>([])
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(() => {
    listarUsuarios().then(setUsuarios, (e: unknown) => setAviso(mensajeError(e).texto))
  }, [])
  useEffect(cargar, [cargar])

  const cambiar = async (u: UsuarioFila, valor: string) => {
    const r = await setRol(u.id, valor === '' ? null : (valor as 'panel' | 'planta'))
    setAviso(r.error ? mensajeError(r.error).texto : null)
    cargar()
  }

  return (
    <div className="usuarios-config">
      <p className="ayuda">
        Los usuarios se crean en la plataforma. Acá se decide quién usa la tablet de planta y quién el panel. Los administradores de
        la plataforma siempre tienen el panel.
      </p>
      {aviso && (
        <p className="aviso-panel" role="alert">
          {aviso}
        </p>
      )}
      <table className="tabla">
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Nombre</th>
            <th scope="col">Rol en Control de Producción</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => {
            const propio = u.id === usuario?.id
            return (
              <tr key={u.id} className={u.activo ? '' : 'inactiva'}>
                <td className="mono">{u.email}</td>
                <td>{u.nombre ?? '—'}</td>
                <td>
                  {u.rol === 'admin' ? (
                    <span>Panel (admin)</span>
                  ) : (
                    <span className="rol-usuario">
                      <select
                        aria-label={`Rol de ${u.email}`}
                        value={u.rol_produccion ?? ''}
                        disabled={propio || !enLinea}
                        onChange={(e) => void cambiar(u, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r.valor} value={r.valor}>
                            {r.texto}
                          </option>
                        ))}
                      </select>
                      {propio && <span className="apagado">(vos)</span>}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
