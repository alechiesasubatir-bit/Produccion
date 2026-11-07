// Genera un PDF mínimo (Helvetica, WinAnsiEncoding) a partir de fragmentos de texto
// { str, x, y, pagina } como los que produce scripts/fragmentos-pdf.mjs: cada fragmento se dibuja
// en su posición exacta, una página por `pagina`. Sirve para armar PDFs de prueba sin datos reales.
// Uso: node scripts/pdf-desde-fragmentos.mjs <fragmentos.json> <salida.pdf> [tamañoFuente]
import { readFile, writeFile } from 'node:fs/promises'

const ANCHO = 595.32
const ALTO = 841.92

// Texto → literal de string PDF en latin1 (WinAnsi coincide con latin1 para º, ó, é, etc.).
function literal(str) {
  let out = ''
  for (const ch of str) {
    const code = ch.codePointAt(0)
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (code >= 32 && code < 127) out += ch
    else if (code >= 160 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0')
    else throw new Error(`Carácter no soportado en WinAnsi: ${JSON.stringify(ch)} en ${JSON.stringify(str)}`)
  }
  return `(${out})`
}

async function main() {
  const [entrada, salida, tam = '8'] = process.argv.slice(2)
  if (!entrada || !salida) {
    console.error('Uso: node scripts/pdf-desde-fragmentos.mjs <fragmentos.json> <salida.pdf> [tamañoFuente]')
    process.exit(1)
  }
  const fragmentos = JSON.parse(await readFile(entrada, 'utf8'))
  const paginas = Math.max(1, ...fragmentos.map((f) => f.pagina))

  // Objetos: 1 catálogo, 2 páginas, 3 fuente, luego (página, contenido) por cada página.
  const objetos = []
  const kids = []
  for (let p = 1; p <= paginas; p++) {
    const idPagina = 4 + (p - 1) * 2
    const idContenido = idPagina + 1
    kids.push(`${idPagina} 0 R`)
    const ops = fragmentos
      .filter((f) => f.pagina === p)
      .map((f) => `BT /F1 ${tam} Tf 1 0 0 1 ${f.x} ${f.y} Tm ${literal(f.str)} Tj ET`)
      .join('\n')
    objetos[idPagina] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${idContenido} 0 R >>`
    objetos[idContenido] = `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`
  }
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objetos[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${paginas} >>`
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets = []
  for (let i = 1; i < objetos.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n`
  }
  const inicioXref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objetos.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`

  await writeFile(salida, Buffer.from(pdf, 'latin1'))
  console.log(`${fragmentos.length} fragmentos, ${paginas} página(s) → ${salida}`)
}

main()
