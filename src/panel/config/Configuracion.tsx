import { useState } from 'react'
import { Tanque } from '../../ui/Tanque'
import { EditorCatalogo, type Campo } from './EditorCatalogo'
import { Operarias } from './Operarias'
import { Usuarios } from './Usuarios'

type Seccion = 'productos' | 'presentaciones' | 'tanques' | 'operarias' | 'usuarios'

const SECCIONES: { id: Seccion; texto: string }[] = [
  { id: 'productos', texto: 'Productos' },
  { id: 'presentaciones', texto: 'Presentaciones' },
  { id: 'tanques', texto: 'Tanques' },
  { id: 'operarias', texto: 'Operarias' },
  { id: 'usuarios', texto: 'Usuarios' },
]

const CAMPOS_PRODUCTO: Campo[] = [
  { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
  { clave: 'color', etiqueta: 'Color', tipo: 'color', requerido: true },
  { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', opciones: ['liquido', 'denso', 'polvo'], requerido: true },
  { clave: 'litros_hora_std', etiqueta: 'Litros/hora estándar', tipo: 'numero', min: 0 },
]
const CAMPOS_PRESENTACION: Campo[] = [
  { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true },
  { clave: 'litros_equiv', etiqueta: 'Litros equivalentes', tipo: 'numero', requerido: true, min: 0 },
]
const CAMPOS_TANQUE: Campo[] = [
  { clave: 'codigo', etiqueta: 'Código', tipo: 'texto', requerido: true },
  { clave: 'capacidad_l', etiqueta: 'Capacidad (L)', tipo: 'numero', requerido: true, min: 0 },
  { clave: 'orden', etiqueta: 'Orden', tipo: 'numero', requerido: true },
]

const HEX = /^#[0-9a-fA-F]{6}$/

export function Configuracion() {
  const [seccion, setSeccion] = useState<Seccion>('productos')

  return (
    <div className="configuracion">
      <h1 className="titulo-panel">Configuración</h1>
      <nav className="segmentos" aria-label="Secciones de configuración">
        {SECCIONES.map((s) => (
          <button key={s.id} type="button" className="segmento" aria-pressed={seccion === s.id} onClick={() => setSeccion(s.id)}>
            {s.texto}
          </button>
        ))}
      </nav>

      {seccion === 'productos' && (
        <EditorCatalogo
          tabla="productos"
          campos={CAMPOS_PRODUCTO}
          orden="nombre"
          nuevo={{ nombre: '', color: '#0284c7', tipo: 'liquido', litros_hora_std: null }}
          vistaPrevia={(b) => (
            <Tanque estado="fabricando" nivel={0.6} ancho={28} color={HEX.test(b.color ?? '') ? b.color : undefined} />
          )}
        />
      )}
      {seccion === 'presentaciones' && (
        <EditorCatalogo tabla="presentaciones" campos={CAMPOS_PRESENTACION} orden="nombre" nuevo={{ nombre: '', litros_equiv: null }} />
      )}
      {seccion === 'tanques' && (
        <EditorCatalogo tabla="tanques" campos={CAMPOS_TANQUE} orden="orden" nuevo={{ codigo: '', capacidad_l: null, orden: 0 }} />
      )}
      {seccion === 'operarias' && <Operarias />}
      {seccion === 'usuarios' && <Usuarios />}
    </div>
  )
}
