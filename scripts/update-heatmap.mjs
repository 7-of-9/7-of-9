import { mkdir, writeFile } from 'node:fs/promises'

// Only public daily totals go into the card. Failed refreshes retain the last image.
const response = await fetch('https://www.d0m1.com/api/usage?days=all', {
  signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' },
})
if (!response.ok) throw new Error(`Usage API returned ${response.status}`)
const data = await response.json()
if (!Array.isArray(data.days) || !data.days.length) throw new Error('No usage days returned')
const daily = new Map()
for (const day of data.days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error('Invalid usage date')
  let tokens = 0, prompts = 0
  for (const p of Object.values(day.providers)) {
    for (const b of [p.exact, p.estimated]) {
      // cacheW1h and reasoning are subsets of cacheW and out, respectively.
      for (const field of ['in', 'cacheW', 'cacheR', 'out', 'unattributed']) {
        const n = b?.[field] ?? 0
        if (!Number.isFinite(n) || n < 0) throw new Error('Invalid token count')
        tokens += n
      }
    }
    prompts += p.prompts ?? 0
  }
  daily.set(day.date, { tokens, prompts })
}
const date = d => d.toISOString().slice(0, 10)
const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T00:00:00Z')
const start = new Date(today)
start.setUTCFullYear(start.getUTCFullYear() - 1)
start.setUTCDate(start.getUTCDate() + 1)
const gridStart = new Date(start)
gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay())
const days = []
for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) days.push({ date: date(d), ...(daily.get(date(d)) ?? { tokens: 0, prompts: 0 }) })
const positive = days.map(d => d.tokens).filter(n => n > 0).sort((a, b) => a - b)
const thresholds = [.25, .5, .75].map(q => positive[Math.floor((positive.length - 1) * q)] ?? 0)
const colors = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']
const level = n => n <= 0 ? 0 : 1 + thresholds.filter(t => n > t).length
const compact = n => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
const sum = key => days.reduce((n, d) => n + d[key], 0)
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const parts = []
const text = (x, y, s, size = 12, fill = '#9198a1', extra = '') => parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escape(s)}</text>`)
// The desktop app's 3 x 3 heatmap mark.
;[.45,.7,1,.7,1,.85,1,.85,.55].forEach((opacity, i) => parts.push(`<rect x="${24 + i % 3 * 10}" y="${25 + Math.floor(i / 3) * 10}" width="7.3" height="7.3" rx="1.5" fill="#2ea043" opacity="${opacity}"/>`))
text(67, 45, 'tokenmaxr', 24, '#f0f6fc', 'font-weight="650"')
text(67, 66, 'My AI coding activity', 13)
text(876, 43, `${compact(sum('tokens'))} tokens · ${compact(sum('prompts'))} prompts`, 17, '#f0f6fc', 'text-anchor="end" font-weight="600"')
text(876, 65, 'Last 12 months · All machines', 12, '#9198a1', 'text-anchor="end"')
const x0 = 64, y0 = 105, step = 15, cell = 11
let previousMonth = ''
for (let d = new Date(gridStart); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
  const week = Math.floor((d - gridStart) / 86400000 / 7)
  const x = x0 + week * step, y = y0 + d.getUTCDay() * step
  if (d < start) continue
  const month = d.toISOString().slice(0, 7)
  if (month !== previousMonth) {
    const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    const nextMonthWeek = Math.floor((nextMonth - gridStart) / 86400000 / 7)
    // A short opening month may share a column with the next month. Leave
    // two columns (30px) for its label, or omit that partial-month label.
    if (previousMonth || nextMonthWeek - week >= 2) {
      text(x, 94, d.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }), 11)
    }
    previousMonth = month
  }
  const { tokens, prompts } = daily.get(date(d)) ?? { tokens: 0, prompts: 0 }
  // Outlines distinguish prompt-only days from days with no activity.
  parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${colors[level(tokens)]}"${!tokens && prompts ? ' stroke="#9198a1"' : ''}><title>${date(d)}: ${tokens.toLocaleString('en')} tokens, ${prompts.toLocaleString('en')} prompts</title></rect>`)
}
for (const [label, row] of [['Mon', 1], ['Wed', 3], ['Fri', 5]]) text(24, y0 + row * step + 9, label, 10)
text(24, 235, `${days.filter(d => d.tokens || d.prompts).length} active days · Updated ${date(today)} (Bangkok)`, 11)
text(876, 235, 'Open live dashboard →', 12, '#58a6ff', 'text-anchor="end"')
text(24, 259, 'Daily tokens · Includes reported estimates · Outlined cells: prompts without token records', 10)
text(730, 259, 'Less', 10)
colors.forEach((fill, i) => parts.push(`<rect x="${758 + i * 15}" y="249" width="11" height="11" rx="2" fill="${fill}"/>`))
text(838, 259, 'More', 10)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="282" viewBox="0 0 900 282" role="img" aria-labelledby="title desc"><title id="title">tokenmaxr — My AI coding activity</title><desc id="desc">${compact(sum('tokens'))} tokens and ${compact(sum('prompts'))} prompts in the last twelve months. Daily usage heatmap; click to open the live dashboard.</desc><rect x=".5" y=".5" width="899" height="281" rx="12" fill="#0d1117" stroke="#30363d"/><g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">${parts.join('')}</g></svg>\n`
await mkdir(new URL('../assets/', import.meta.url), { recursive: true })
await writeFile(new URL('../assets/tokenmaxr-heatmap.svg', import.meta.url), svg)
console.log(`Updated public heatmap: ${days.length} days, ${compact(sum('tokens'))} tokens`)
