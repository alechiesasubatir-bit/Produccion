import { useState } from 'react'
import { parsearCantidad } from '../domain/tareas'
import type { Cantidad, OperariaEnOrden, Unidad } from '../domain/participaciones'

const UNIDADES: Unidad[] = ['L', 'kg']

// Teclado numérico grande para declarar cuánto envasó/fraccionó cada persona (una sola al salir).
export function DeclararCantidad({
  personas,
  unidadInicial,
  titulo,
  onConfirmar,
  onCancelar,
}: {
  personas: OperariaEnOrden[]
  unidadInicial: Unidad
  titulo: string
  onConfirmar: (c: Cantidad[]) => void
  onCancelar: () => void
}) {
  const [unidad, setUnidad] = useState<Unidad>(unidadInicial)
  const [textos, setTextos] = useState<Record<string, string>>({})

  const valores = personas.map((p) => parsearCantidad(textos[p.empleado_id] ?? ''))
  const completo = valores.every((v) => v !== null)

  function confirmar() {
    if (!completo) return
    onConfirmar(personas.map((p, i) => ({ empleadoId: p.empleado_id, cantidad: valores[i] as number, unidad })))
  }

  return (
    <div className="declarar" role="dialog" aria-label={titulo}>
      <h2 className="declarar-titulo">{titulo}</h2>
      <div className="declarar-unidad" role="group" aria-label="Unidad">
        {UNIDADES.map((u) => (
          <button
            key={u}
            type="button"
            className="declarar-unidad-boton"
            aria-pressed={unidad === u}
            onClick={() => setUnidad(u)}
          >
            {u}
          </button>
        ))}
      </div>
      {personas.map((p) => (
        <label key={p.empleado_id} className="declarar-campo">
          <span className="declarar-nombre">{p.nombre}</span>
          <input
            className="declarar-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={textos[p.empleado_id] ?? ''}
            onChange={(e) => setTextos((t) => ({ ...t, [p.empleado_id]: e.target.value }))}
          />
        </label>
      ))}
      <div className="declarar-acciones">
        <button type="button" className="boton" disabled={!completo} onClick={confirmar}>
          Confirmar
        </button>
        <button type="button" className="boton boton-sec" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
