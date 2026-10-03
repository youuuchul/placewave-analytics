// 헤드리스 캡처: 빌드 결과(dist)를 vite preview 로 띄우고 탭별 화면을 captures/ 에 저장한다.
//   npm run build && npm run capture            탭 6개 × 라이트
//   npm run capture -- --all                    + 보기 전환·1일·다크·폰 폭·데이터 페이지
//   NP_CATALOG=/tmp/catalog.json npm run capture -- --all   catalog.json 을 이 파일로 대체해 찍는다
//   NP_DATA=/tmp/np_v2/data npm run capture -- --all        dist/data/ 요청을 이 폴더 파일로 대체해 찍는다(샘플 데이터)
//   NP_PORT=4190 NP_ONLY='search|eval|periodic' npm run capture -- --all   포트 지정 · 이름이 정규식에 맞는 화면만
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = Number(process.env.NP_PORT ?? 4173)
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('../captures/', import.meta.url).pathname
const all = process.argv.includes('--all')
const only = process.env.NP_ONLY ? new RegExp(process.env.NP_ONLY) : null
const catalogFile = process.env.NP_CATALOG
if (catalogFile && !existsSync(catalogFile)) throw new Error(`NP_CATALOG 파일 없음: ${catalogFile}`)
const dataDir = process.env.NP_DATA
if (dataDir && !existsSync(`${dataDir}/index.json`)) throw new Error(`NP_DATA 에 index.json 없음: ${dataDir}`)

const tabs = [
  ['01_overview', 'tab=overview'],
  ['02_funnel', 'tab=funnel'],
  ['90_search', 'tab=search'],
  ['03_events', 'tab=events'],
  ['04_members', 'tab=members'],
  ['05_acquisition', 'tab=acquisition'],
  ['91_evalops', 'tab=evalops'],
  ['06_periodic', 'tab=periodic'],
  ['61_venues', 'tab=venues'],
]
const extras = [
  ['07_events_venue', 'tab=events&view=venue'],
  ['08_events_event', 'tab=events&view=event'],
  ['09_acquisition_campaign', 'tab=acquisition&view=campaign'],
  ['10_periodic_month', 'tab=periodic&view=month'],
  ['11_overview_1day', 'tab=overview&p=1'],
  ['12_funnel_1year_paid_ios', 'tab=funnel&p=365&ch=paid&pf=ios'],
  ['14_funnel_1day', 'tab=funnel&p=1'],
  ['15_funnel_7_member', 'tab=funnel&p=7&ms=member&aud=new,returning,past_payer,apply_no_pay'],
  ['30_about', 'page=about'],
  ['13_members_90', 'tab=members&p=90'],
  ['50_overview_90', 'tab=overview&p=90'],
  ['51_overview_1year', 'tab=overview&p=365'],
  ['52_overview_7_member_ios', 'tab=overview&p=7&ms=member&pf=ios'],
  ['62_members_subscription', 'tab=members&view=subscription&p=90'],
  ['63_events_revenue_1year', 'tab=events&view=revenue&p=365'],
  ['64_events_revenue_28', 'tab=events&view=revenue'],
  ['65_metrics', 'page=metrics'],
  ['66_venues_region_1year', `tab=venues&p=365&sr=${encodeURIComponent('홍대·합정·연남')}`],
  ['67_venues_partner_genre', `tab=venues&sp=partner&sg=${encodeURIComponent('힙합')}`],
  ['68_overview_1year', 'tab=overview&p=365'],
  ['86_overview_28_member', 'tab=overview&ms=member'],
  ['79_venues_1year', 'tab=venues&p=365'],
  ['80_members_subscription_1year', 'tab=members&view=subscription&p=365'],
  ['92_search_1year', 'tab=search&p=365'],
  ['93_search_ranker', 'tab=search&view=ranker'],
  ['94_search_90_ios_member', 'tab=search&p=90&pf=ios&ms=member'],
  ['95_search_1day', 'tab=search&p=1'],
  ['96_evalops_0615_promotion', 'tab=evalops&wk=2026-06-15&rq=promotion'],
  ['97_evalops_0706', 'tab=evalops&wk=2026-07-06'],
  ['98_evalops_0907', 'tab=evalops&wk=2026-09-07'],
  ['99_periodic_paid', 'tab=periodic&ch=paid'],
]

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const wait = async () => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview 서버가 뜨지 않음')
}

mkdirSync(OUT, { recursive: true })
try {
  await wait()
  const browser = await chromium.launch()
  const shoot = async (name, q, opts = {}) => {
    if (only && !only.test(name)) return
    const ctx = await browser.newContext({
      viewport: opts.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: opts.scale ?? 1,
      colorScheme: opts.scheme ?? 'light',
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    if (opts.noCatalog) await page.route('**/catalog.json', (route) => route.fulfill({ status: 404, body: '' }))
    else if (catalogFile)
      await page.route('**/catalog.json', (route) => route.fulfill({ json: JSON.parse(readFileSync(catalogFile, 'utf8')) }))
    if (dataDir)
      await page.route('**/data/*', (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop()
        const file = `${dataDir}/${name}`
        if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ body: readFileSync(file), contentType: name.endsWith('.bin') ? 'application/octet-stream' : 'application/json' })
      })
    if (opts.strip)
      await page.route('**/data/index.json', async (route) => {
        const body = dataDir ? JSON.parse(readFileSync(`${dataDir}/index.json`, 'utf8')) : await (await route.fetch()).json()
        for (const k of opts.strip) {
          delete body[k]
          delete body.files[k]
        }
        await route.fulfill({ json: body })
      })
    await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' })
    await page.waitForSelector(opts.wait ?? 'main section, main .card', { timeout: 10000 })
    await page.waitForFunction(() => !document.querySelector('[data-pending]'), null, { timeout: 20000 })
    await page.waitForTimeout(400)
    if (opts.drill) {
      const card = page.locator('main section.card', { has: page.locator(`h2:text-is("${opts.drill}")`) })
      const box = await card.locator('.recharts-wrapper').boundingBox()
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
      await page.waitForTimeout(150)
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
      await page.waitForTimeout(400)
      console.log(`  드릴다운 → ${new URL(page.url()).search}`)
    }
    if (opts.help) {
      await page.locator(`button[aria-label="${opts.help} 정의"]`).first().click()
      await page.waitForTimeout(200)
    }
    if (opts.expand) {
      const opts2 = await page.locator(opts.expand).evaluate((el) => {
        el.size = el.options.length
        el.parentElement.style.position = 'relative'
        el.parentElement.style.minWidth = `${el.parentElement.offsetWidth}px`
        el.style.cssText += ';position:absolute;right:0;top:0;z-index:60;height:auto;overflow:visible;background:var(--surface);box-shadow:0 4px 16px rgba(0,0,0,.15);padding:4px'
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) p.style.overflow = 'visible'
        return [...el.options].map((o) => o.text)
      })
      console.log(`  선택지 → ${opts2.join(' / ')}`)
      await page.waitForTimeout(150)
    }
    const file = `${OUT}${name}.png`
    if (opts.section) {
      const card = page.locator('main section.card', { has: page.locator(`h2:text-is("${opts.section}")`) })
      if (opts.click != null) {
        await card.locator('svg path').nth(opts.click).dispatchEvent('click')
        await page.waitForTimeout(200)
      }
      if (opts.hover != null) {
        await card.scrollIntoViewIfNeeded()
        const box = await card.locator(opts.hoverSel ?? '.recharts-wrapper').first().boundingBox()
        const [hx, hy] = Array.isArray(opts.hover) ? opts.hover : [opts.hover, 0.5]
        await page.mouse.move(box.x + box.width * hx, box.y + box.height * hy)
        await page.waitForTimeout(200)
      }
      await card.screenshot({ path: file })
    } else await page.screenshot({ path: file, fullPage: !opts.clip })
    console.log(`${file}${errors.length ? `  오류 ${errors.length}: ${errors[0]}` : ''}`)
    await ctx.close()
  }
  for (const [n, q] of tabs) await shoot(`${n}_light`, q)
  if (all) {
    for (const [n, q] of extras) await shoot(`${n}_light`, q)
    await shoot('20_overview_dark', 'tab=overview', { scheme: 'dark' })
    await shoot('21_periodic_dark', 'tab=periodic', { scheme: 'dark' })
    await shoot('22_overview_phone', 'tab=overview', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('23_periodic_phone', 'tab=periodic', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('17_funnel_audience', 'tab=funnel&p=90', { section: '오디언스별 퍼널' })
    await shoot('18_funnel_path_click', 'tab=funnel&p=90', { section: '경로 탐색', click: 0 })
    await shoot('19_funnel_nodata', 'tab=funnel', { strip: ['weekly_audience_funnel', 'weekly_path'] })
    await shoot('24_funnel_dark', 'tab=funnel', { scheme: 'dark' })
    await shoot('25_funnel_phone', 'tab=funnel', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('31_about_dark', 'page=about', { scheme: 'dark' })
    await shoot('32_about_phone', 'page=about', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('33_about_phone_dark', 'page=about', { viewport: { width: 390, height: 844 }, scale: 2, scheme: 'dark', wait: 'main section' })
    await shoot('40_data_light', 'page=data')
    await shoot('41_data_raw_light', 'page=data&table=raw.ga4_events')
    await shoot('42_data_dark', 'page=data&table=marts.weekly_path', { scheme: 'dark' })
    await shoot('43_data_phone', 'page=data', { viewport: { width: 390, height: 844 }, scale: 2, wait: 'main section' })
    await shoot('44_data_phone_dark', 'page=data&table=staging.int_session', { viewport: { width: 390, height: 844 }, scale: 2, scheme: 'dark', wait: 'main section' })
    await shoot('45_data_nocatalog', 'page=data', { noCatalog: true, wait: 'main' })
    await shoot('46_header_phone_about', 'page=about', { viewport: { width: 390, height: 300 }, scale: 2, wait: 'header', clip: true })
    await shoot('53_overview_hover_left', 'tab=overview&p=90', { section: '방문자', hover: 0.08 })
    await shoot('54_overview_hover_right', 'tab=overview&p=90', { section: '결제', hover: 0.97 })
    await shoot('55_overview_hover_day', 'tab=overview&p=7', { section: '결제', hover: 0.5 })
    await shoot('56_overview_hover_hour', 'tab=overview&p=1', { section: '결제', hover: 0.6 })
    await shoot('57_overview_hover_dark', 'tab=overview&p=365', { section: '방문자', hover: 0.9, scheme: 'dark' })
    await shoot('58_overview_hover_phone', 'tab=overview', { section: '방문자', hover: 0.9, viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('59_overview_drill_week', 'tab=overview&p=90', { drill: '방문자' })
    await shoot('60_overview_1day_dark', 'tab=overview&p=1', { scheme: 'dark' })
    await shoot('47_header_tablet', 'tab=funnel', { viewport: { width: 768, height: 400 }, clip: true })
    await shoot('69_venues_map_hover', 'tab=venues', { section: '서울 분포', hover: [0.39, 0.52], hoverSel: 'svg[role=img]' })
    await shoot('70_venues_dark', 'tab=venues', { scheme: 'dark' })
    await shoot('71_venues_phone', 'tab=venues', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('72_metrics_phone', 'page=metrics', { viewport: { width: 390, height: 844 }, scale: 2, wait: 'main section' })
    await shoot('73_metrics_dark', 'page=metrics', { scheme: 'dark', wait: 'main section' })
    await shoot('74_overview_help', 'tab=overview', { help: '플랫폼 매출', clip: true })
    await shoot('75_overview_revenue_hover', 'tab=overview&p=365', { section: '플랫폼 매출 · 구성', hover: 0.8 })
    await shoot('84_overview_subs_hover_1year', 'tab=overview&p=365', { section: '활성 구독자', hover: 0.9 })
    await shoot('85_overview_subs_hover_90', 'tab=overview&p=90', { section: '활성 구독자', hover: 0.5 })
    await shoot('76_members_subscription_dark', 'tab=members&view=subscription&p=365', { scheme: 'dark' })
    await shoot('78_venues_region_open', 'tab=venues', { expand: 'select >> nth=0', clip: true })
    await shoot('81_metrics_top', 'page=metrics', { wait: 'main section', clip: true })
    await shoot('100_search_dark', 'tab=search', { scheme: 'dark' })
    await shoot('101_search_phone', 'tab=search', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('102_evalops_dark', 'tab=evalops', { scheme: 'dark' })
    await shoot('103_evalops_phone', 'tab=evalops', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('104_evalops_scatter_hover', 'tab=evalops&wk=2026-07-06', { section: '처리 속도 × 정확도', hover: [0.85, 0.6] })
    await shoot('77_header_phone_metrics', 'page=metrics', { viewport: { width: 390, height: 300 }, scale: 2, wait: 'header', clip: true })
  }
  await browser.close()
} finally {
  server.kill()
}
