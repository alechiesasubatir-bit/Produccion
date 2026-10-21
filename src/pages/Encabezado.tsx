import { salir, useSesion } from '../auth/useSesion'

export function Encabezado({ titulo }: { titulo: string }) {
  const { usuario } = useSesion()
  return (
    <header className="encabezado">
      <div className="marca">
        <span className="marca-nombre">ProdControl</span>
        <span className="marca-seccion">{titulo}</span>
      </div>
      <div className="encabezado-usuario">
        <span>{usuario?.email}</span>
        <button type="button" className="boton boton-sec" onClick={() => void salir()}>
          Salir
        </button>
      </div>
    </header>
  )
}
