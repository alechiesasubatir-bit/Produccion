// La DEMO vive en /demo: se decide una sola vez al cargar la página (el link de la pestaña DEMO
// abre una página nueva). En la demo el cliente de Supabase no sale a la red: usa el simulador.
export function esRutaDemo(pathname: string, base = import.meta.env.BASE_URL): boolean {
  const raiz = base.endsWith('/') ? base : `${base}/`
  return pathname === `${raiz}demo` || pathname.startsWith(`${raiz}demo/`)
}

export const modoDemo = typeof window !== 'undefined' && esRutaDemo(window.location.pathname)
