import { useMemo } from 'react'
import { md } from '../lib/date'
import { AB, EXP_METRICS, armDevices, compareArms, fmtP, inSpan, p95Diff, signedMs, srm, type ArmCompare } from '../lib/experiments'
import { num, pct } from '../lib/format'
import type { DailySearch, ExpRankerRequest } from '../lib/types'
import { Block, Bullets, Para, SideTable } from './Frame'
import { CRITERIA, guardCall, guardPass, type GuardKey } from './ExpDesign'

const ci = (c: ArmCompare | null) => (c ? `${c.metric.diff(c.ci.d)} (${c.metric.bound(c.ci.lo)} ~ ${c.metric.bound(c.ci.hi)})` : '—')

/** 첫 주 진행 점검(배정·실험 전 A/A·가드레일). 진행 점검 보고서와 결과 보고의 배경 문장이 같은 판정을 쓴다. */
export function interimCheck(rows: ExpRankerRequest[]) {
  const week = inSpan(rows, AB.firstWeek)
  const pre = inSpan(rows, AB.pre)
  const dev = armDevices(week)
  const s = srm(dev.control, dev.treatment)
  const aa = [EXP_METRICS.success, EXP_METRICS.zero, EXP_METRICS.pos, EXP_METRICS.ctr, EXP_METRICS.apply].map((m) => compareArms(pre, m))
  const gCtr = compareArms(week, EXP_METRICS.ctr)
  const gApply = compareArms(week, EXP_METRICS.apply)
  const gLat = p95Diff(week)
  const guards = [
    { key: 'ctr' as const, label: '결과 클릭률', ok: gCtr ? guardPass('ctr', gCtr.ci) : false },
    { key: 'apply' as const, label: '검색 세션 신청 전환', ok: gApply ? guardPass('apply', gApply.ci) : false },
    { key: 'p95' as const, label: '응답 시간 p95', ok: guardPass('p95', gLat.ci) },
  ]
  const guardOut = guards.filter((g) => !g.ok).map((g) => g.label)
  const aaOff = aa.filter((c) => c && c.ci.p < 0.05).map((c) => c!.metric.label)
  const stop = s.p < 0.001 || guardOut.length > 0
  const watch = aaOff.map((l) => `실험 전 ${l} 차이`)
  return { week, pre, dev, s, aa, gCtr, gApply, gLat, guards, guardOut, stop, watch }
}

export default function ExpCheck({ rows, search }: { rows: ExpRankerRequest[]; search: DailySearch[] }) {
  const ck = useMemo(() => interimCheck(rows), [rows])
  const { week, pre, dev, s, aa, gCtr, gApply, gLat, guardOut, stop, watch } = ck
  const req = { control: week.filter((r) => r.arm === 'control').length, treatment: week.filter((r) => r.arm === 'treatment').length }
  const mismatch = week.filter((r) => r.ranker_version !== (r.arm === 'treatment' ? 'v2' : 'v1')).length
  const preDev = armDevices(pre)
  const wk = search.filter((r) => r.kst_date >= AB.firstWeek[0] && r.kst_date <= AB.firstWeek[1])
  const logged = wk.reduce((a, r) => a + r.ga_logged_searches, 0)
  const total = wk.reduce((a, r) => a + r.searches, 0)
  const status = (key: GuardKey, c: { lo: number; hi: number }) => guardCall(key, guardPass(key, c))

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
          heads={['가드레일', '대조군', '실험군', '차이 (95% 구간)', '기준', '상태']}
          rows={[
            gCtr
              ? ['결과 클릭률', gCtr.metric.fmt(gCtr.c.value), gCtr.metric.fmt(gCtr.t.value), ci(gCtr), CRITERIA.ctr, status('ctr', gCtr.ci)]
              : ['결과 클릭률', '—', '—', '—', CRITERIA.ctr, '—'],
            gApply
              ? ['검색 세션 신청 전환', gApply.metric.fmt(gApply.c.value), gApply.metric.fmt(gApply.t.value), ci(gApply), CRITERIA.apply, status('apply', gApply.ci)]
              : ['검색 세션 신청 전환', '—', '—', '—', CRITERIA.apply, '—'],
            [
              '응답 시간 p95',
              `${gLat.c.toFixed(0)}ms`,
              `${gLat.t.toFixed(0)}ms`,
              `${signedMs(gLat.ci.d)} (${signedMs(gLat.ci.lo)} ~ ${signedMs(gLat.ci.hi)})`,
              CRITERIA.p95,
              status('p95', gLat.ci),
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
        <Para>
          {stop
            ? `중단한다. ${s.p < 0.001 ? '배정 비율이 50:50에서 벗어났다' : `${guardOut.join(' · ')}이 가드레일을 넘었다`}.`
            : watch.length
              ? `계속 진행하되 ${watch.join(' · ')}를 결과 보고에서 함께 본다. 설계서의 중단 조건(배정 비율 이상, 가드레일 유의한 하락·응답 예산 초과)에는 해당하지 않는다. 효과 판정은 기간이 끝난 ${md(AB.v2All)} 결과 보고에서 한 번만 한다.`
              : `계속 진행한다. 배정·실험 전 비교·가드레일 모두 설계서 기준 안이다. 효과 판정은 기간이 끝난 ${md(AB.v2All)} 결과 보고에서 한 번만 한다.`}
        </Para>
      </Block>
    </>
  )
}
