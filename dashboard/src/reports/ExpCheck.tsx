import { useMemo } from 'react'
import { md } from '../lib/date'
import { AB, EXP_METRICS, armDevices, compareArms, fmtP, inSpan, p95Diff, signedMs, srm, type ArmCompare } from '../lib/experiments'
import { num, pct } from '../lib/format'
import type { DailySearch, ExpRankerRequest } from '../lib/types'
import { Block, Bullets, Para, SideTable } from './Frame'
import { GUARD } from './ExpDesign'

const ci = (c: ArmCompare | null) => (c ? `${c.metric.diff(c.ci.d)} (${c.metric.bound(c.ci.lo)} ~ ${c.metric.bound(c.ci.hi)})` : '—')

export default function ExpCheck({ rows, search }: { rows: ExpRankerRequest[]; search: DailySearch[] }) {
  const week = useMemo(() => inSpan(rows, AB.firstWeek), [rows])
  const pre = useMemo(() => inSpan(rows, AB.pre), [rows])
  const dev = armDevices(week)
  const s = srm(dev.control, dev.treatment)
  const req = { control: week.filter((r) => r.arm === 'control').length, treatment: week.filter((r) => r.arm === 'treatment').length }
  const mismatch = week.filter((r) => r.ranker_version !== (r.arm === 'treatment' ? 'v2' : 'v1')).length
  const aa = [EXP_METRICS.success, EXP_METRICS.zero, EXP_METRICS.pos, EXP_METRICS.ctr, EXP_METRICS.apply].map((m) => compareArms(pre, m))
  const preDev = armDevices(pre)
  const gCtr = compareArms(week, EXP_METRICS.ctr)
  const gApply = compareArms(week, EXP_METRICS.apply)
  const gLat = useMemo(() => p95Diff(week), [week])
  const wk = search.filter((r) => r.kst_date >= AB.firstWeek[0] && r.kst_date <= AB.firstWeek[1])
  const logged = wk.reduce((a, r) => a + r.ga_logged_searches, 0)
  const total = wk.reduce((a, r) => a + r.searches, 0)
  const status = (worst: number, limit: number, up = false) => ((up ? worst <= limit : worst >= limit) ? '허용 폭 안' : '허용 폭 밖')

  return (
    <>
      <Block title="점검 범위">
        <Para>
          실험 첫 주({md(AB.firstWeek[0])}~{md(AB.firstWeek[1])})가 지난 시점의 점검이다. 설계서대로 배정이 제대로 됐는지, 두 집단이 실험 전부터 달랐던 건
          아닌지, 가드레일이 허용 폭 안인지만 본다. 주 지표·보조 지표의 효과는 이 시점에 열어 보지 않는다.
        </Para>
      </Block>

      <Block title="배정 점검">
        <SideTable
          heads={['항목', '대조군', '실험군', '판정']}
          rows={[
            ['검색한 기기', num(dev.control), num(dev.treatment), `${pct(s.share)} : ${pct(1 - s.share)} · 카이제곱 p ${fmtP(s.p)} → ${s.p < 0.001 ? 'SRM' : '이상 없음'}`],
            ['검색 요청', num(req.control), num(req.treatment), '요청 수는 결과 지표라 배정 점검에 쓰지 않는다'],
            ['배정과 다른 버전을 받은 요청', '—', '—', `${num(mismatch)}건`],
          ]}
        />
      </Block>

      <Block title="실험 전 기간 비교 (A/A)">
        <Para>
          같은 배정 규칙을 실험 전 2주({md(AB.pre[0])}~{md(AB.pre[1])}, 두 집단 모두 기존 랭킹)에 붙여 비교했다. 기기 {num(preDev.control)} · {num(preDev.treatment)}대.
        </Para>
        <SideTable
          heads={['지표', '대조군', '실험군', '차이 (95% 구간, 기기 단위)', 'p값']}
          rows={aa.map((c) => (c ? [c.metric.label, c.metric.fmt(c.c.value), c.metric.fmt(c.t.value), ci(c), fmtP(c.ci.p)] : ['—', '—', '—', '—', '—']))}
        />
      </Block>

      <Block title="가드레일 감시 (첫 주)">
        <SideTable
          heads={['가드레일', '대조군', '실험군', '차이 (95% 구간)', '허용 폭', '상태']}
          rows={[
            gCtr
              ? ['결과 클릭률', gCtr.metric.fmt(gCtr.c.value), gCtr.metric.fmt(gCtr.t.value), ci(gCtr), GUARD.ctr.label, status(gCtr.ci.lo, GUARD.ctr.limit)]
              : ['결과 클릭률', '—', '—', '—', GUARD.ctr.label, '—'],
            gApply
              ? ['검색 세션 신청 전환', gApply.metric.fmt(gApply.c.value), gApply.metric.fmt(gApply.t.value), ci(gApply), GUARD.apply.label, status(gApply.ci.lo, GUARD.apply.limit)]
              : ['검색 세션 신청 전환', '—', '—', '—', GUARD.apply.label, '—'],
            [
              '응답 시간 p95',
              `${gLat.c.toFixed(0)}ms`,
              `${gLat.t.toFixed(0)}ms`,
              `${signedMs(gLat.ci.d)} (${signedMs(gLat.ci.lo)} ~ ${signedMs(gLat.ci.hi)})`,
              GUARD.p95.label,
              status(gLat.ci.hi, GUARD.p95.limit, true),
            ],
          ]}
        />
      </Block>

      <Block title="로그 품질">
        <Bullets
          items={[
            '검색 요청과 결과 클릭은 서버 로그에서 요청 ID 로 묶는다. 요청 로그에 없는 클릭은 0건이다(파이프라인 검사 C21).',
            `GA search 이벤트 수집률은 ${pct(logged / Math.max(1, total))}로 평소 수준이다. 지표는 서버 로그로 계산하므로 GA 누락이 지표를 바꾸지 않는다.`,
          ]}
        />
      </Block>

      <Block title="결정">
        <Para>계속 진행한다. 배정·실험 전 비교·가드레일 모두 설계서 기준 안이다. 효과 판정은 기간이 끝난 7/27 결과 보고에서 한 번만 한다.</Para>
      </Block>
    </>
  )
}
