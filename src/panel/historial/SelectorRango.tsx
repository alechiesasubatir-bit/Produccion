import { hoyMontevideo, rangoDe, type Atajo, type Rango } from '../../domain/historial'

const ATAJOS: { id: Atajo; texto: string }[] = [
  { id: 'hoy', texto: 'Hoy' },
  { id: 'semana', texto: 'Esta semana' },
  { id: 'mes', texto: 'Este mes' },
  { id: 'mesAnterior', texto: 'Mes anterior' },
]

export function SelectorRango({ rango, onCambiar }: { rango: Rango; onCambiar: (r: Rango) => void }) {
  return (
    <div className="selector-rango">
      <div className="campo campo-fecha">
        <label htmlFor="r-desde">Desde</label>
        <input
          id="r-desde"
          type="date"
          value={rango.desde}
          max={rango.hasta}
          onChange={(e) => e.target.value && onCambiar({ ...rango, desde: e.target.value })}
        />
      </div>
      <div className="campo campo-fecha">
        <label htmlFor="r-hasta">Hasta</label>
        <input
          id="r-hasta"
          type="date"
          value={rango.hasta}
          min={rango.desde}
          onChange={(e) => e.target.value && onCambiar({ ...rango, hasta: e.target.value })}
        />
      </div>
      <div className="atajos" role="group" aria-label="Atajos de fecha">
        {ATAJOS.map((a) => (
          <button key={a.id} type="button" className="boton-mini" onClick={() => onCambiar(rangoDe(a.id, hoyMontevideo()))}>
            {a.texto}
          </button>
        ))}
      </div>
    </div>
  )
}
