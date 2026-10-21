import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Login } from './auth/Login'
import { Cargando, RequireRol, SinAcceso, SinVerificar } from './auth/RequireRol'
import { SesionProvider, useSesion } from './auth/useSesion'
import { PanelApp } from './panel/PanelApp'
import { PlantaApp } from './planta/PlantaApp'
import './ui/app.css'

function Inicio() {
  const { cargando, usuario, rol, errorPerfil } = useSesion()
  if (cargando) return <Cargando />
  if (!usuario) return <Navigate to="/login" replace />
  if (errorPerfil) return <SinVerificar />
  if (rol === 'panel') return <Navigate to="/panel" replace />
  if (rol === 'planta') return <Navigate to="/planta" replace />
  return <SinAcceso />
}

function App() {
  return (
    <SesionProvider>
      <BrowserRouter basename="/Produccion">
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* DEMO pública: datos simulados en el navegador, sin usuario (ver src/demo). */}
          <Route path="/demo/*" element={<PanelApp base="/demo" demo />} />
          <Route
            path="/panel/*"
            element={
              <RequireRol rol="panel">
                <PanelApp />
              </RequireRol>
            }
          />
          <Route
            path="/planta"
            element={
              <RequireRol rol="planta">
                <PlantaApp />
              </RequireRol>
            }
          />
          <Route path="*" element={<Inicio />} />
        </Routes>
      </BrowserRouter>
    </SesionProvider>
  )
}

export default App
