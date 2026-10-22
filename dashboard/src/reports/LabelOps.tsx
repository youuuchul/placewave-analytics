import type { State } from '../lib/state'
import type { Data } from '../lib/types'
import { REQUESTER } from '../lib/labels'
import { WeekLine } from '../components/FilterBar'
import { Segmented } from '../components/ui'
import EvalOps, { evalWeeks } from '../tabs/EvalOps'
import { Block, Bullets, Para } from './Frame'

/** 라벨링 운영 단계: 평가 운영 기간(4/1~) 동안 라벨러·분석가가 매주 본 운영 대시보드. 주차·요청 부서를 고를 수 있다. */
export default function LabelOps({ data, s, set }: { data: Data; s: State; set: (p: Partial<State>) => void }) {
  const weeks = evalWeeks(data)
  const wk = weeks.includes(s.wk) ? s.wk : weeks[weeks.length - 1]
  return (
    <>
      <Block title="배경·운영 방식">
        <Para>
          실패 검색어를 고친 랭킹을 만들려면 검색어 × 결과마다 관련도 라벨이 필요했다. 4월 1일 평가자 6명으로 시작해 5월 4일 12명으로 늘렸고, 매주
          월요일 검색팀 배치(직전 7일 실패 → 상위 검색량 → 무작위 순 검색어)와 5월부터 추천 슬롯 배치를 받아 처리했다. 아래는 그 기간 매주 열어 본
          운영 화면이다.
        </Para>
        <Bullets
          items={[
            '진척: 진행 중 배치의 목표 대비 완료, 지금 속도로 마감 전에 못 끝낼 배치(마감 위험)',
            '생산성: 라벨 수·활동 평가자·평가자당 라벨·건당 처리 시간',
            '품질: 몰래 섞은 정답셋 정확도, 평가자 간 일치율과 카파, 검수 반려 재작업률, 정확도 80% 미만 평가자',
          ]}
        />
      </Block>
      <Block title="운영 대시보드">
        <div className="flex flex-col gap-2 rounded-xl border border-line px-3 py-2">
          <WeekLine weeks={weeks} value={wk} onChange={(w) => set({ wk: w })} />
          <Segmented
            label="요청 부서"
            value={s.rq}
            onChange={(rq) => set({ rq })}
            options={[
              { value: 'all', label: '전체' },
              ...Object.entries(REQUESTER).map(([value, label]) => ({ value: value as 'search' | 'promotion', label })),
            ]}
          />
        </div>
        <EvalOps data={data} s={{ wk, rq: s.rq }} />
      </Block>
    </>
  )
}
