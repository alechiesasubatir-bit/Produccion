import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sesion } from './useSesion'
import { RequireRol } from './RequireRol'

let sesion: Sesion
vi.mock('./useSesion', () => ({
  useSesion: () => sesion,
  salir: vi.fn(),
}))

function LoginFalso() {
  const loc = useLocation()
  return <p>login{loc.search}</p>
}

function montar() {
  return render(
    <MemoryRouter initialEntries={['/panel']}>
      <Routes>
        <Route path="/login" element={<LoginFalso />} />
        <Route
          path="/panel"
          element={
            <RequireRol rol="panel">
              <p>contenido del panel</p>
            </RequireRol>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

const usuario = { id: 'u1', email: 'x@y.z' } as Sesion['usuario']

describe('RequireRol', () => {
  beforeEach(() => {
    sesion = { cargando: false, usuario: null, rol: null, errorPerfil: false }
  })

  it('sin usuario redirige a login con next', () => {
    montar()
    expect(screen.getByText('login?next=%2Fpanel')).toBeInTheDocument()
  })

  it('usuario de planta en ruta de panel ve "Sin acceso"', () => {
    sesion = { cargando: false, usuario, rol: 'planta', errorPerfil: false }
    montar()
    expect(screen.getByText('Sin acceso')).toBeInTheDocument()
  })

  it('usuario de panel ve el contenido', () => {
    sesion = { cargando: false, usuario, rol: 'panel', errorPerfil: false }
    montar()
    expect(screen.getByText('contenido del panel')).toBeInTheDocument()
  })

  it('si no se pudo leer el perfil no dice "Sin acceso"', () => {
    sesion = { cargando: false, usuario, rol: null, errorPerfil: true }
    montar()
    expect(screen.queryByText('Sin acceso')).not.toBeInTheDocument()
    expect(screen.getByText('No pudimos verificar tu acceso')).toBeInTheDocument()
  })

  it('mientras carga muestra un status', () => {
    sesion = { cargando: true, usuario: null, rol: null, errorPerfil: false }
    montar()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
