const CLAVE = 'prodcontrol_sonido'

// Preferencia por PC (no por usuario): si el storage no está disponible, sin sonido.
export function sonidoActivado(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '1'
  } catch {
    return false
  }
}

export function guardarSonido(activo: boolean): void {
  try {
    localStorage.setItem(CLAVE, activo ? '1' : '0')
  } catch {
    /* sin storage: la preferencia dura lo que la pestaña */
  }
}

// Dos notas cortas con Web Audio (sin archivos de sonido).
export function sonarAlerta(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    ;[880, 660].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator()
      const vol = ctx.createGain()
      const t = ctx.currentTime + i * 0.18
      osc.frequency.value = frecuencia
      vol.gain.setValueAtTime(0.0001, t)
      vol.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(vol).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.17)
    })
    setTimeout(() => void ctx.close(), 600)
  } catch {
    /* el navegador bloqueó el audio (sin interacción previa): no es crítico */
  }
}
