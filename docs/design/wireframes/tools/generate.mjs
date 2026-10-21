// Turns a captured layout JSON (docs/design/wireframes/tools/dump.txt) into a
// grayscale wireframe SVG. Node 24 built-ins only, no dependencies.
// usage: node generate.mjs <capture-dump.txt> <out.svg> "<title>"
import { readFileSync, writeFileSync } from 'node:fs'

const [, , dumpPath, outPath, title = 'WIRE 自动生成'] = process.argv
const dump = readFileSync(dumpPath, 'utf8')
const match = dump.match(/<pre id="out">([\s\S]*?)<\/pre>/)
if (!match) throw new Error('no capture payload in ' + dumpPath)
if (!match[1].trim().startsWith('{')) throw new Error('capture did not finish: ' + match[1].slice(0, 120))
const snap = JSON.parse(match[1])

const ink = '#2f3a44', mid = '#6b7683', light = '#8e99a4', hair = '#c9cfd6', fill = '#eef1f4', fill2 = '#e3e7eb'
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const px = (v) => Math.round(v * 10) / 10
const isWhite = (c) => c === 'rgb(255, 255, 255)'
const isClear = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
const CONTROL = new Set(['INPUT', 'BUTTON', 'SELECT'])
const SURFACE = new Set(['HEADER', 'ASIDE', 'TABLE', 'FORM'])
const PANEL = 'SECTION'

// A node becomes a drawn box only when it actually paints a surface or is a control.
// Large transparent wrappers are guides, not boxes — that is the judging step.
function decoration(r) {
  if (CONTROL.has(r.tag)) return { fill: r.tag === 'BUTTON' ? fill2 : fill, stroke: r.tag === 'BUTTON' ? '#7e8994' : hair }
  if (r.tag === 'HEADER' || (r.tag === PANEL && isWhite(r.bg))) return { fill: '#fff', stroke: hair }
  if (!isClear(r.bg) && !isWhite(r.bg)) return { fill: r.bg, stroke: hair }
  if (isWhite(r.bg)) return { fill: '#fff', stroke: hair }
  return null
}

const W = Math.max(snap.view.width, 1200)
const H = Math.max(snap.view.height, 900)
const out = []
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="autoTitle">`)
out.push(`<title id="autoTitle">${esc(title)}</title>`)
out.push(`<defs><style>text{font-family:"Microsoft YaHei","Segoe UI",sans-serif}
.t{fill:${ink}}.tm{fill:${mid}}.tl{fill:${light}}.cap{font-size:10.5px;fill:${light}}.lbl{font-size:12px;fill:${mid}}</style></defs>`)
out.push(`<rect width="${W}" height="${H}" fill="#f5f7f9"/>`)
out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${hair}"/>`)

// guide lines for large transparent containers
for (const r of snap.rows) {
  if (r.w >= 300 && isClear(r.bg) && !CONTROL.has(r.tag) && !SURFACE.has(r.tag))
    out.push(`<rect x="${px(r.x)}" y="${px(r.y)}" width="${px(r.w)}" height="${px(r.h)}" fill="none" stroke="${hair}" stroke-dasharray="4 4"/>`)
}
// surfaces and controls
for (const r of snap.rows) {
  const d = decoration(r)
  if (!d) continue
  const radius = parseFloat(r.radius) || 0
  out.push(`<rect x="${px(r.x)}" y="${px(r.y)}" width="${px(r.w)}" height="${px(r.h)}" rx="${radius}" fill="${d.fill}" stroke="${d.stroke}"/>`)
}
// text on top, no nested backgrounds
for (const r of snap.rows) {
  const text = r.placeholder ? `（占位）${r.placeholder}` : r.text || ''
  if (!text) continue
  const control = CONTROL.has(r.tag)
  if (control && !r.placeholder) continue // button label drawn from own text below
  const size = Math.min(Math.max(parseFloat(r.fs) || 14, 11), 26)
  const weight = (parseInt(r.fw, 10) || 400) >= 600 ? 600 : 400
  const cls = control ? 'tl' : r.tag === 'H1' || r.tag === 'H2' || r.tag === 'H3' ? 't' : 'tm'
  const x = px(r.x + (control ? 14 : 0))
  const y = px(r.y + Math.min(r.h / 2 + size * 0.36, r.h - 5))
  out.push(`<text x="${x}" y="${y}" class="${cls}" font-size="${control ? 13 : px(size)}" font-weight="${control ? 400 : weight}">${esc(text)}</text>`)
}
// button labels last so they sit above their own fill
for (const r of snap.rows) {
  if (r.tag !== 'BUTTON' || !r.text) continue
  out.push(`<text x="${px(r.x + r.w / 2)}" y="${px(r.y + r.h / 2 + 5)}" class="t" font-size="14" font-weight="600" text-anchor="middle">${esc(r.text)}</text>`)
}
// measured geometry labels
for (const r of snap.rows) {
  const isPanel = r.tag === 'HEADER' || (r.tag === PANEL && decoration(r))
  if (!isPanel) continue
  const name = r.tag === 'HEADER' ? '顶栏' : '面板'
  out.push(`<text x="${px(r.x + 6)}" y="${px(r.y - 5)}" class="cap">${name} ${Math.round(r.w)}×${Math.round(r.h)} @ ${Math.round(r.x)},${Math.round(r.y)}</text>`)
}
out.push(`<text x="8" y="${H - 8}" class="cap">自动量取自 ${esc(snap.url)} · 视口 ${snap.view.width}×${snap.view.height} · 元素 ${snap.count} 个 · 未做语义编号</text>`)
out.push('</svg>')

writeFileSync(outPath, out.join('\n'), 'utf8')
console.log(`wrote ${outPath}: ${snap.count} measured rows`)
