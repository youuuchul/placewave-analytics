import type { MouseEvent, ReactNode } from 'react'
import { DATA_NOTE_ID } from './components/Header'
import { useCatalog } from './DataPage'
import { GroupChip } from './reports/Frame'
import { REPORTS } from './reports/registry'

const REPO = 'https://github.com/youuuchul/placewave-analytics'

const B = { fill: 'var(--wash)' }
const LINE = 'var(--axis)'

function Phone({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 140 272" className="w-full max-w-[150px]" role="img" aria-hidden>
      <rect x="1" y="1" width="138" height="270" rx="20" fill="var(--surface)" stroke={LINE} strokeWidth="1.5" />
      <rect x="52" y="9" width="36" height="6" rx="3" fill={LINE} />
      <g transform="translate(12,24)">{children}</g>
    </svg>
  )
}

function Lines({ y, ws }: { y: number; ws: number[] }) {
  return (
    <>
      {ws.map((w, i) => (
        <rect key={i} x="0" y={y + i * 10} width={w} height="5" rx="2.5" {...B} />
      ))}
    </>
  )
}

function Cta({ y, label }: { y: number; label: string }) {
  return (
    <>
      <rect x="0" y={y} width="116" height="22" rx="7" fill="var(--accent)" />
      <text x="58" y={y + 14.5} textAnchor="middle" fontSize="9" fontWeight="600" fill="#fff">
        {label}
      </text>
    </>
  )
}

const SCREENS: { title: string; step: string; events: string[]; art: ReactNode }[] = [
  {
    title: '홈·지도',
    step: '랜딩',
    events: ['screen_view', 'view_promotion', 'select_promotion', 'search'],
    art: (
      <>
        <rect x="0" y="0" width="116" height="16" rx="8" {...B} />
        <rect x="0" y="24" width="116" height="56" rx="8" fill="var(--accent)" fillOpacity="0.18" />
        <rect x="8" y="58" width="50" height="6" rx="3" fill="var(--accent)" fillOpacity="0.6" />
        {[0, 1, 2].map((i) => (
          <rect key={i} x={i * 40} y="88" width="34" height="12" rx="6" {...B} />
        ))}
        <rect x="0" y="108" width="116" height="60" rx="8" {...B} />
        {[
          [30, 125],
          [70, 140],
          [92, 118],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="4" fill="var(--accent)" />
        ))}
        {[0, 1].map((i) => (
          <g key={i} transform={`translate(0,${176 + i * 22})`}>
            <rect x="0" y="0" width="18" height="18" rx="4" {...B} />
            <Lines y={2} ws={[70, 44]} />
          </g>
        ))}
      </>
    ),
  },
  {
    title: '행사 상세',
    step: '행사 상세',
    events: ['screen_view', 'share'],
    art: (
      <>
        <rect x="0" y="0" width="116" height="84" rx="8" {...B} />
        <Lines y={94} ws={[96, 64]} />
        <rect x="0" y="120" width="116" height="1" fill={LINE} />
        <Lines y={130} ws={[80, 72, 88, 50]} />
        <rect x="0" y="176" width="116" height="28" rx="6" {...B} />
        <Cta y={214} label="신청하기" />
      </>
    ),
  },
  {
    title: '로그인·가입',
    step: '로그인·가입',
    events: ['login', 'sign_up'],
    art: (
      <>
        <circle cx="58" cy="30" r="16" fill="var(--accent)" fillOpacity="0.18" />
        <rect x="28" y="58" width="60" height="6" rx="3" {...B} />
        <rect x="0" y="84" width="116" height="20" rx="6" fill="none" stroke={LINE} />
        <rect x="0" y="110" width="116" height="20" rx="6" fill="none" stroke={LINE} />
        <Cta y={140} label="로그인" />
        <rect x="0" y="176" width="116" height="1" fill={LINE} />
        <rect x="0" y="188" width="116" height="20" rx="6" {...B} />
        <rect x="0" y="214" width="116" height="20" rx="6" {...B} />
      </>
    ),
  },
  {
    title: '신청 화면',
    step: '신청 화면',
    events: ['screen_view', 'apply_event'],
    art: (
      <>
        <Lines y={0} ws={[84, 52]} />
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0,${28 + i * 30})`}>
            <rect x="0" y="0" width="116" height="24" rx="6" fill="none" stroke={i === 1 ? 'var(--accent)' : LINE} />
            <circle cx="12" cy="12" r="4" fill={i === 1 ? 'var(--accent)' : 'none'} stroke={i === 1 ? 'var(--accent)' : LINE} />
            <rect x="24" y="9" width="50" height="6" rx="3" {...B} />
          </g>
        ))}
        <rect x="0" y="128" width="116" height="1" fill={LINE} />
        <rect x="0" y="138" width="40" height="6" rx="3" {...B} />
        <rect x="76" y="136" width="40" height="10" rx="3" fill="var(--ink)" fillOpacity="0.7" />
        <Cta y={214} label="결제하기" />
      </>
    ),
  },
  {
    title: '결제 완료',
    step: '결제',
    events: ['purchase', 'screen_view'],
    art: (
      <>
        <circle cx="58" cy="40" r="20" fill="var(--good)" fillOpacity="0.16" />
        <path d="M48 40l7 7 13-14" fill="none" stroke="var(--good)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="23" y="72" width="70" height="7" rx="3.5" {...B} />
        <rect x="0" y="96" width="116" height="84" rx="8" fill="none" stroke={LINE} strokeDasharray="3 3" />
        <rect x="10" y="108" width="70" height="6" rx="3" {...B} />
        <rect x="10" y="120" width="50" height="6" rx="3" {...B} />
        <rect x="10" y="146" width="96" height="22" rx="4" {...B} />
        <rect x="0" y="214" width="116" height="22" rx="7" {...B} />
      </>
    ),
  },
]

interface FlowNode {
  id: string
  label: string
  sub: string
  tone?: 'accent' | 'derived'
}

const SOURCES: FlowNode[] = [
  { id: 'log', label: '행동 로그', sub: 'GA4형 이벤트' },
  { id: 'db', label: '서비스 DB', sub: '공간·계약·구독·결제' },
  { id: 'ad', label: '광고 리포트', sub: '일별 집행' },
  { id: 'search', label: '검색 서버 로그', sub: '결과 수·노출 순위', tone: 'derived' },
  { id: 'eval', label: '평가 도구', sub: '평가자·배치·라벨', tone: 'derived' },
]
const LAYERS: FlowNode[] = [
  { id: 'raw', label: 'raw', sub: '원천 그대로' },
  { id: 'staging', label: 'staging', sub: '정제·세션·사람×일' },
  { id: 'marts', label: 'marts', sub: '화면용 집계' },
]
const OUT: FlowNode[] = [
  { id: 'json', label: 'JSON 추출', sub: '마트 → 분할 파일' },
  { id: 'web', label: '정적 웹', sub: '이 대시보드', tone: 'accent' },
]
const OPS: FlowNode = { id: 'ops', label: 'ops', sub: '실행 기록·대조' }

function Box({ x, y, w, h, n }: { x: number; y: number; w: number; h: number; n: FlowNode }) {
  const accent = n.tone === 'accent'
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="8"
        fill={accent ? 'var(--accent)' : 'var(--surface)'}
        fillOpacity={accent ? 0.14 : 1}
        stroke={accent ? 'var(--accent)' : LINE}
        strokeDasharray={n.tone === 'derived' ? '4 3' : undefined}
      />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--ink)">
        {n.label}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize="11" fill="var(--muted)">
        {n.sub}
      </text>
    </g>
  )
}

function Arrow({ d, dashed, m }: { d: string; dashed?: boolean; m: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke="var(--muted)"
      strokeWidth="1.25"
      strokeDasharray={dashed ? '4 4' : undefined}
      markerEnd={`url(#${m})`}
    />
  )
}

function Marker({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
      </marker>
    </defs>
  )
}

function FlowWide() {
  const W = 118
  const H = 50
  const xs = [0, 170, 318, 466, 640, 788]
  const mid = 95
  return (
    <svg viewBox="-2 -2 910 250" className="hidden w-full md:block" role="img" aria-label="데이터 흐름">
      <Marker id="np-arrow-w" />
      <rect x={xs[1] - 16} y="-1" width={xs[3] + W - xs[1] + 32} height="246" rx="12" fill="var(--wash)" />
      <text x={xs[1] - 4} y="18" fontSize="11" fill="var(--muted)">
        BigQuery
      </text>
      {SOURCES.map((n, i) => {
        const y = 2 + i * 50
        return (
          <g key={n.id}>
            <Box x={xs[0]} y={y} w={W} h={42} n={n} />
            <Arrow m="np-arrow-w" d={`M${xs[0] + W},${y + 21} C${xs[0] + W + 26},${y + 21} ${xs[1] - 26},${mid + 25} ${xs[1] - 2},${mid + 25}`} />
          </g>
        )
      })}
      {LAYERS.map((n, i) => (
        <g key={n.id}>
          <Box x={xs[1 + i]} y={mid} w={W} h={H} n={n} />
          {i < LAYERS.length - 1 && <Arrow m="np-arrow-w" d={`M${xs[1 + i] + W},${mid + 25} L${xs[2 + i] - 2},${mid + 25}`} />}
        </g>
      ))}
      <Box x={(xs[2] + xs[3]) / 2} y={184} w={W} h={H} n={OPS} />
      <Arrow m="np-arrow-w" d={`M${xs[2] + W / 2},${mid + H} L${xs[2] + W / 2},${184 + H / 2} L${(xs[2] + xs[3]) / 2 - 2},${184 + H / 2}`} dashed />
      <Arrow m="np-arrow-w" d={`M${xs[3] + W / 2},${mid + H} L${xs[3] + W / 2},${184 + H / 2} L${(xs[2] + xs[3]) / 2 + W + 2},${184 + H / 2}`} dashed />
      {OUT.map((n, i) => (
        <Box key={n.id} x={xs[4 + i]} y={mid} w={W} h={H} n={n} />
      ))}
      <Arrow m="np-arrow-w" d={`M${xs[3] + W},${mid + 25} L${xs[4] - 2},${mid + 25}`} />
      <Arrow m="np-arrow-w" d={`M${xs[4] + W},${mid + 25} L${xs[5] - 2},${mid + 25}`} />
    </svg>
  )
}

function FlowTall() {
  const W = 150
  const H = 46
  const cx = 120
  const x = cx - W / 2
  const chain = [...LAYERS, ...OUT]
  const top = 200
  return (
    <svg viewBox="-8 0 356 540" className="mx-auto w-full max-w-[360px] md:hidden" role="img" aria-label="데이터 흐름">
      <Marker id="np-arrow-t" />
      <rect x={-6} y={0} width={344} height={136} rx="12" fill="var(--wash)" />
      <text x={2} y={15} fontSize="11" fill="var(--muted)">
        원천
      </text>
      {SOURCES.map((n, i) => (
        <Box key={n.id} x={i < 3 ? i * 114 : 57 + (i - 3) * 114} y={i < 3 ? 24 : 80} w={104} h={H} n={n} />
      ))}
      <Arrow m="np-arrow-t" d={`M${cx},136 L${cx},${top - 16}`} />
      <rect x={x - 14} y={top - 14} width={W + 150} height={3 * 70 + 6} rx="12" fill="var(--wash)" />
      <text x={x + W + 118} y={top + 2} textAnchor="end" fontSize="11" fill="var(--muted)">
        BigQuery
      </text>
      {chain.map((n, i) => (
        <g key={n.id}>
          <Box x={x} y={top + i * 70} w={W} h={H} n={n} />
          {i < chain.length - 1 && <Arrow m="np-arrow-t" d={`M${cx},${top + i * 70 + H} L${cx},${top + (i + 1) * 70 - 2}`} />}
        </g>
      ))}
      <Box x={x + W + 22} y={top + 105} w={100} h={H} n={OPS} />
      <Arrow m="np-arrow-t" d={`M${x + W},${top + 70 + H / 2} L${x + W + 72},${top + 70 + H / 2} L${x + W + 72},${top + 103}`} dashed />
      <Arrow m="np-arrow-t" d={`M${x + W},${top + 140 + H / 2} L${x + W + 20},${top + 140 + H / 2}`} dashed />
    </svg>
  )
}

type Party = 'c' | 'p' | 's'

const PARTIES: Record<Party, { label: string; sub: string; accent?: boolean }> = {
  c: { label: '소비자', sub: '탐색 · 신청 · 결제' },
  p: { label: 'Placewave', sub: '연결 · 결제 · 정산', accent: true },
  s: { label: '공간 사업자', sub: '공간 등록 · 이벤트 개설' },
}

const MONEY: { from: Party; to: Party; label: string; sub: string; color: string; dashed?: boolean }[] = [
  { from: 'c', to: 'p', label: '티켓 결제', sub: '정가 − 멤버 할인', color: 'var(--s1)' },
  { from: 'c', to: 'p', label: '멤버십', sub: '월 9,900원', color: 'var(--s2)' },
  { from: 'p', to: 'c', label: '멤버 할인 15%', sub: '플랫폼 부담', color: 'var(--s2)', dashed: true },
  { from: 'p', to: 's', label: '정산', sub: '정가 − 수수료', color: 'var(--s1)' },
  { from: 's', to: 'p', label: '파트너 플랜', sub: '월 4.9만 · 14.9만원', color: 'var(--s3)' },
]

const AXES: { title: string; color: string; formula: string; metrics: [string, string][] }[] = [
  {
    title: '거래 수수료',
    color: 'var(--s1)',
    formula: '티켓 정가 × 공간 등급별 수수료율(비파트너 10% · 베이직 5% · 프로 3%)',
    metrics: [
      ['M09', '거래액'],
      ['M11', '실효 수수료율'],
      ['M12', '환불률'],
    ],
  },
  {
    title: '멤버십',
    color: 'var(--s2)',
    formula: '활성 구독자 × 월 9,900원. 파트너 공간 이벤트 15% 할인은 플랫폼이 부담',
    metrics: [
      ['S01', '활성 구독자'],
      ['S05', '구독 월 해지율'],
      ['S11', '멤버 할인 부담률'],
    ],
  },
  {
    title: '파트너 플랜',
    color: 'var(--s3)',
    formula: '활성 계약 × 월 요금(베이직 4.9만 · 프로 14.9만원). 혜택은 수수료 우대 · 상단 노출',
    metrics: [
      ['P05', '파트너 플랜 MRR'],
      ['P11', '계약 월 해지율'],
      ['P13', 'GRR'],
    ],
  },
]

function MoneyMarkers({ prefix }: { prefix: string }) {
  return (
    <defs>
      {['s1', 's2', 's3'].map((c) => (
        <marker
          key={c}
          id={`${prefix}-${c}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={`var(--${c})`} />
        </marker>
      ))}
    </defs>
  )
}

const markerOf = (prefix: string, color: string) => `url(#${prefix}-${color.slice(6, 8)})`

function PartyBox({ x, y, w, h, id }: { x: number; y: number; w: number; h: number; id: Party }) {
  const n = PARTIES[id]
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="10"
        fill={n.accent ? 'var(--accent)' : 'var(--surface)'}
        fillOpacity={n.accent ? 0.14 : 1}
        stroke={n.accent ? 'var(--accent)' : LINE}
      />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--ink)">
        {n.label}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">
        {n.sub}
      </text>
    </g>
  )
}

function MoneyWide() {
  const W = 170
  const box = { c: 0, p: 365, s: 730 }
  const lanes: Record<string, number[]> = { cp: [102, 132, 162], ps: [112, 152] }
  const used = { cp: 0, ps: 0 }
  return (
    <svg viewBox="-4 64 912 136" className="hidden w-full md:block" role="img" aria-label="수익 흐름">
      <MoneyMarkers prefix="bm-w" />
      <PartyBox x={box.c} y={92} w={W} h={76} id="c" />
      <PartyBox x={box.p} y={82} w={W} h={96} id="p" />
      <PartyBox x={box.s} y={92} w={W} h={76} id="s" />
      {MONEY.map((m) => {
        const pair = m.from === 's' || m.to === 's' ? 'ps' : 'cp'
        const y = lanes[pair][used[pair]++]
        const [l, r] = pair === 'cp' ? [box.c + W + 6, box.p - 6] : [box.p + W + 6, box.s - 6]
        const forward = (pair === 'cp' && m.from === 'c') || (pair === 'ps' && m.from === 'p')
        const below = m.dashed || m.from === 's'
        return (
          <g key={m.label}>
            <path
              d={forward ? `M${l},${y} L${r},${y}` : `M${r},${y} L${l},${y}`}
              stroke={m.color}
              strokeWidth="1.75"
              strokeDasharray={m.dashed ? '4 4' : undefined}
              fill="none"
              markerEnd={markerOf('bm-w', m.color)}
            />
            <text x={(l + r) / 2} y={below ? y + 16 : y - 7} textAnchor="middle" fontSize="11.5">
              <tspan fontWeight="600" fill="var(--ink)">
                {m.label}
              </tspan>
              <tspan fill="var(--muted)"> · {m.sub}</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function MoneyTall() {
  const W = 300
  const H = 58
  const row = 34
  const order: (Party | number)[] = ['c', 0, 1, 2, 'p', 3, 4, 's']
  let y = 0
  const items = order.map((it) => {
    const top = y
    y += typeof it === 'number' ? row : H + 10
    return { it, top }
  })
  return (
    <svg viewBox={`-2 -2 ${W + 4} ${y}`} className="mx-auto w-full max-w-[360px] md:hidden" role="img" aria-label="수익 흐름">
      <MoneyMarkers prefix="bm-t" />
      {items.map(({ it, top }) => {
        if (typeof it !== 'number') return <PartyBox key={it} x={0} y={top} w={W} h={H} id={it} />
        const m = MONEY[it]
        const down = m.from === 'c' || (m.from === 'p' && m.to === 's')
        const x = 34
        const [a, b] = down ? [top - 4, top + row - 12] : [top + row - 12, top - 4]
        return (
          <g key={m.label}>
            <path
              d={`M${x},${a} L${x},${b}`}
              stroke={m.color}
              strokeWidth="1.75"
              strokeDasharray={m.dashed ? '4 4' : undefined}
              fill="none"
              markerEnd={markerOf('bm-t', m.color)}
            />
            <text x={x + 16} y={top + row / 2 - 1} fontSize="12" dominantBaseline="middle">
              <tspan fontWeight="600" fill="var(--ink)">
                {m.label}
              </tspan>
              <tspan fill="var(--muted)"> · {m.sub}</tspan>
            </text>
          </g>
        )
      })}
    </svg>
  )
}

const DOCS: { label: string; sub: string; href: string; internal?: 'data' | 'metrics' }[] = [
  { label: '데이터 카탈로그', sub: '층별 표·컬럼·마트 미리보기', href: '', internal: 'data' },
  { label: '지표 가이드', sub: '탭별 질문·지표 정의·산식', href: '', internal: 'metrics' },
  { label: 'SQL 카탈로그', sub: '표 목록·계보·실행 순서', href: `${REPO}/blob/main/bigquery/README.md` },
  { label: '데이터 아키텍처', sub: '층·표·그레인·파이프라인', href: `${REPO}/blob/main/docs/architecture.md` },
  { label: '대시보드 설계', sub: '탭·필터·데이터 계약', href: `${REPO}/blob/main/docs/dashboard.md` },
  { label: '저장소', sub: '생성기·SQL·대시보드 코드', href: REPO },
]

/** 수수료·파트너 플랜·멤버십 구조를 비교한 공개 서비스(2026-10-19 확인). */
const REFS: { group: string; kr: string; global: string }[] = [
  { group: '공연 예매', kr: 'NOL 티켓 · 예스24 티켓 · 멜론티켓 · 티켓링크', global: 'Ticketmaster · DICE · Resident Advisor' },
  { group: '이벤트·모임 호스팅', kr: '프립 · 문토 · 소모임', global: 'Eventbrite · Luma · Meetup · Partiful' },
  { group: '공간·식당 예약', kr: '캐치테이블 · 네이버 예약 · 스페이스클라우드', global: 'OpenTable · Resy' },
  { group: '정률 중개', kr: '배달의민족 · 쿠팡이츠 · 야놀자 · 여기어때', global: 'Airbnb' },
  { group: '소비자 멤버십', kr: '쿠팡 와우 · 네이버플러스 멤버십 · 배민클럽', global: 'ClassPass · Fever' },
]

function References() {
  return (
    <section aria-labelledby="refs-title" className="card mt-1 flex max-w-[760px] flex-col gap-3 px-4 py-3.5 sm:px-5">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 id="refs-title" className="text-[13px] font-semibold text-ink">
            참고한 서비스
          </h3>
          <span className="tnum text-xs text-muted">공식 요금 페이지·기사 기준, 2026-10-19 확인</span>
        </div>
        <p className="text-[13px] leading-relaxed text-ink2">
          수수료·파트너 플랜·멤버십 구조는 공개된 요금 체계를 참고해 정하고, 아래 서비스와 비교해 검증했습니다.
        </p>
      </div>
      <div className="grid gap-x-4 gap-y-2.5 text-[13px] leading-snug sm:grid-cols-[136px_minmax(0,1fr)_minmax(0,0.85fr)] sm:gap-y-2">
        <div className="hidden text-[11px] font-medium text-muted sm:contents">
          <span>분류</span>
          <span>국내</span>
          <span>해외</span>
        </div>
        {REFS.map((r) => (
          <div key={r.group} className="flex flex-col gap-0.5 sm:contents">
            <span className="font-medium text-ink">{r.group}</span>
            <span className="text-ink2">
              <span className="mr-1.5 text-[11px] text-muted sm:hidden">국내</span>
              {r.kr}
            </span>
            <span className="text-ink2">
              <span className="mr-1.5 text-[11px] text-muted sm:hidden">해외</span>
              {r.global}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function Section({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4">
      <h3 className="flex items-baseline gap-2 text-[15px] font-semibold text-ink">
        <span className="tnum text-xs font-medium text-muted">{String(n).padStart(2, '0')}</span>
        {title}
      </h3>
      {children}
    </section>
  )
}

/** 생성기 --persons 값. 사람 수는 표 행 수로 나오지 않아 여기 둔다. */
const VISITORS = 210000

/** 규모 수치는 약 단위로 쓴다: 1만 미만은 백 단위, 10만 미만은 만 단위 소수 한 자리, 그 이상은 만 단위. */
function approx(n: number): string {
  if (n < 10000) return `약 ${(Math.round(n / 100) * 100).toLocaleString('ko-KR')}`
  const man = n / 10000
  return `약 ${man < 10 ? man.toFixed(1) : Math.round(man).toLocaleString('ko-KR')}만`
}

/** 소개 문단의 규모 수치. 카탈로그(표 행 수)에서 읽어 데이터를 다시 만들면 따라 바뀐다. */
function useScale() {
  const cat = useCatalog()
  if (!cat || cat === 'missing') return null
  const rows = (id: string) => cat.tables.find((t) => `${t.layer}.${t.name}` === id)?.rows
  const v = ['raw.db_members', 'raw.db_venues', 'raw.ga4_events', 'raw.search_log', 'raw.eval_labels'].map(rows)
  if (v.some((x) => x == null)) return null
  const [members, venues, events, searches, labels] = (v as number[]).map(approx)
  return { members, venues, events, searches, labels }
}

type Target = 'data' | 'metrics' | 'reports' | ''

const BIZ_ID = 'business-model'
const REPORTS_ID = 'reports'

export default function About({
  hrefs,
  onPage,
  onReport,
  reportHref,
}: {
  hrefs: Record<Target, string>
  onPage: (page: Target) => void
  onReport: (id: string) => void
  reportHref: (id: string) => string
}) {
  const scale = useScale()
  const open = (page: Target) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onPage(page)
  }
  const jump = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const report = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onReport(id)
  }
  const tile = 'card flex h-full flex-col gap-2 p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--axis)] sm:p-5'
  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-12 px-4 pb-20 pt-8 sm:px-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-[32px]">
          도심 공간·이벤트 플랫폼의 로그를
          <br className="hidden sm:block" /> 퍼널·코호트·매출 지표로
        </h2>
        <p className="max-w-[640px] text-[15px] leading-relaxed text-ink2">
          가상 서비스 Placewave의 행동 로그·서비스 DB·광고 리포트와 검색 서버 로그·평가 도구 기록을 BigQuery 네 층으로
          정리하고, 마트에서 뽑은 집계로 이 대시보드를 만든 데이터 분석 포트폴리오입니다.
        </p>
        <p
          id={DATA_NOTE_ID}
          className="max-w-[640px] scroll-mt-6 border-l-2 border-line pl-3 text-[13px] leading-relaxed text-muted"
        >
          이 대시보드의 수치는 가상 서비스 Placewave의 시나리오와 분포 규칙(이벤트 비중·화면 전이·요일×시간·채널
          구성·리텐션 곡선)으로 생성한 합성 데이터입니다. 런칭일 2025-09-22부터 1년(52주)치
          {scale
            ? `, 방문자 ${approx(VISITORS)} 명·회원 ${scale.members} 명·등록 공간 ${scale.venues}곳·이벤트 로그 ${scale.events} 건 규모이고 검색 요청 ${scale.searches} 건·평가 라벨 ${scale.labels} 건이 붙어 있습니다`
            : ''}
          . 상권 이름과 위치는 공개 지리 정보이고 상호는 모두 가상입니다.
        </p>
        <References />
      </div>

      <nav aria-label="세 묶음" className="grid gap-3 md:grid-cols-3">
        <a href={`#${BIZ_ID}`} onClick={jump(BIZ_ID)} className={tile}>
          <span className="text-xs font-medium text-muted">1 · 비즈니스 시나리오</span>
          <span className="text-[15px] font-semibold text-ink">수수료 · 멤버십 · 파트너 플랜 세 축의 가상 플랫폼</span>
          <span className="text-[13px] leading-relaxed text-ink2">서비스와 돈의 흐름. 1년차 거래액 13.3억, 플랫폼 매출 2.65억</span>
          <span className="mt-auto text-xs font-medium text-accent">비즈니스 모델 ↓</span>
        </a>
        <a href={hrefs['']} onClick={open('')} className={tile}>
          <span className="text-xs font-medium text-muted">2 · 모니터링 대시보드</span>
          <span className="text-[15px] font-semibold text-ink">질문에서 출발한 탭 9개</span>
          <span className="text-[13px] leading-relaxed text-ink2">어느 단계에서 빠지나 · 파트너·멤버십이 거래를 늘리나 · 검색은 어디서 실패하나</span>
          <span className="mt-auto text-xs font-medium text-accent">대시보드 →</span>
        </a>
        <a href={hrefs.reports} onClick={open('reports')} className={tile}>
          <span className="text-xs font-medium text-muted">3 · 보고서</span>
          <span className="text-[15px] font-semibold text-ink">실험 1 · 개선 1 · 이슈 1</span>
          <ul className="flex flex-col gap-1 text-[13px] leading-snug text-ink2">
            {REPORTS.map((r) => (
              <li key={r.id}>
                <span className="text-muted">{r.code}</span> {r.conclusion}
              </li>
            ))}
          </ul>
          <span className="mt-auto text-xs font-medium text-accent">보고서 목록 →</span>
        </a>
      </nav>

      <Section n={1} title="프로덕트">
        <p className="max-w-[720px] text-[14px] leading-relaxed text-ink2">
          Placewave는 카페·바·라운지·라이브홀·루프탑·팝업 같은 도심 공간과 그곳에서 열리는 이벤트를 찾아보고, 신청하고,
          결제하는 서비스입니다. 탐색은 누구나 할 수 있고 신청부터 로그인합니다. iOS·Android 앱과 웹으로 들어오고, 일부 방문은 SNS 광고
          캠페인에서 옵니다. 분석할 질문은 어느 단계에서 사람이 빠지는지, 어떤 유입이 결제까지 이어지는지 두 가지입니다.
        </p>
        <p className="max-w-[720px] text-[14px] leading-relaxed text-ink2">
          공간은 두 층입니다. 서울 주요 상권의 공간 1,800곳이 목록에 등록돼 있고, 그중 약 10%는 파트너 플랜(베이직 월 4.9만·프로
          14.9만 원)에 가입해 수수료 우대와 상단 노출을 받습니다. 2025년 12월부터 회원은 월 9,900원 멤버십으로 파트너 공간
          이벤트를 15% 할인받습니다. 여기서 파트너 플랜과 멤버십이 거래를 늘리고 오래 유지되는지가 세 번째 질문입니다.
        </p>
        <p className="max-w-[720px] text-[14px] leading-relaxed text-ink2">
          검색은 장르·상권·행사 유형·공간명으로 들어오는 또 하나의 입구입니다. 2026년 4월부터 검색 결과의 관련성을 사람이 평가하는
          프로그램을 운영했고, 그 라벨로 만든 새 랭킹을 7월에 기존 랭킹과 기기 단위 무작위 50:50으로 비교한 뒤 전체에 적용했습니다. 마지막 질문은 검색이
          어디서 실패하고, 평가와 랭킹 개선이 그 실패를 줄였는지입니다.
        </p>
      </Section>

      <Section n={2} title="비즈니스 모델" id={BIZ_ID}>
        <p className="max-w-[720px] text-[14px] leading-relaxed text-ink2">
          플랫폼 매출은 수수료 · 멤버십 · 파트너 플랜 세 갈래이고, 티켓 거래액은 그 규모를 재는 지표입니다.
        </p>
        <div className="card p-4 sm:p-6">
          <MoneyWide />
          <MoneyTall />
        </div>
        <ul className="grid gap-3 md:grid-cols-3">
          {AXES.map((a) => (
            <li key={a.title} className="card flex flex-col gap-3 border-t-2 px-4 py-3" style={{ borderTopColor: a.color }}>
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold text-ink">{a.title}</span>
                <span className="text-xs leading-snug text-ink2">{a.formula}</span>
              </div>
              <ul className="flex flex-col gap-1">
                {a.metrics.map(([id, name]) => (
                  <li key={id} className="flex items-center gap-2 text-[13px] text-ink">
                    <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: a.color }} />
                    {name}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={3} title="핵심 퍼널 5화면">
        <ol className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {SCREENS.map((sc, i) => (
            <li key={sc.title} className="flex min-w-0 flex-col items-center gap-3">
              <div className="flex w-full items-baseline justify-center gap-1.5 text-[13px]">
                <span className="tnum text-xs text-muted">{i + 1}</span>
                <span className="font-medium text-ink">{sc.title}</span>
              </div>
              <Phone>{sc.art}</Phone>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-[11px] text-muted">퍼널 단계 · {sc.step}</span>
                <div className="flex flex-wrap justify-center gap-1">
                  {sc.events.map((e) => (
                    <code key={e} className="rounded bg-wash px-1.5 py-0.5 font-mono text-[11px] text-ink2">
                      {e}
                    </code>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section n={4} title="보고서" id={REPORTS_ID}>
        <ul className="grid gap-3 md:grid-cols-3">
          {REPORTS.map((r) => (
            <li key={r.id}>
              <a href={reportHref(r.id)} onClick={report(r.id)} className={tile}>
                <GroupChip meta={r} />
                <span className="text-[14px] font-semibold leading-snug text-ink">{r.title}</span>
                <span className="text-[13px] leading-relaxed text-ink2">{r.conclusion}</span>
                <span className="tnum mt-auto text-xs text-muted">{r.period}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>

      <Section n={5} title="데이터 흐름">
        <div className="card p-4 sm:p-6">
          <FlowWide />
          <FlowTall />
        </div>
      </Section>

      <Section n={6} title="문서">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOCS.map((d) => (
            <li key={d.label}>
              <a
                href={d.internal ? hrefs[d.internal] : d.href}
                {...(d.internal ? { onClick: open(d.internal) } : { target: '_blank', rel: 'noreferrer' })}
                className="card flex h-full flex-col gap-1 px-4 py-3 transition-shadow hover:shadow-[0_0_0_1px_var(--axis)]"
              >
                <span className="flex items-center justify-between text-[14px] font-medium text-ink">
                  {d.label}
                  <span aria-hidden className="text-muted">
                    {d.internal ? '→' : '↗'}
                  </span>
                </span>
                <span className="text-xs text-muted">{d.sub}</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}
