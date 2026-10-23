import { useMemo } from 'react'
import { dec, num, pct } from '../lib/format'
import { QUERY_INTENT, S } from '../lib/labels'
import type { RankerEval, RankerFeature, RankerQueryEval } from '../lib/types'
import { BarList } from '../components/charts'
import { Card, Legend } from '../components/ui'
import { Block, Bullets, Dataset, Para, SideTable, Spec, type Cell } from './Frame'
import { REPO } from './registry'

/** 순위 모델 설정. ranker/train.py 의 값과 같아야 한다. */
const K = 10
const FOLDS = 5
const BASE = ['2026-06-22', '2026-07-05']
const INTENTS = ['venue_name', 'region', 'genre', 'event_type'] as const

/** ranker/features.py FEATURES 와 같은 순서·이름. */
const FEATURE_LABEL: Record<string, string> = {
  query_intent: '의도 유형',
  query_term: '정식 이름',
  item_type: '후보 종류',
  item_genre: '후보 장르',
  item_venue_type: '후보 공간 유형',
  item_event_type: '후보 행사 유형',
  genre_match: '장르 일치',
  region_match: '상권 일치',
  region_dist_km: '상권 거리',
  event_type_match: '행사 유형 일치',
  host_has_event_type: '유형 행사 개최',
  name_match: '공간명 일치',
  named_area_genre: '같은 상권·장르',
  popularity_log: '인기(신청 수)',
}
const GROUP_COLOR: Record<string, string> = { match: S(1), popularity: S(4) }
const groupColor = (g: string) => GROUP_COLOR[g] ?? S(7)
const GROUP_LABEL: Record<string, string> = {
  match: '의도·속성 일치',
  item: '후보 속성',
  query: '검색어',
  distance: '거리',
  popularity: '인기',
}

type QueryScore = { q: string; intent: string; fold: number; n: number; rel: number; pop: number | null; model: number | null }

function dcg(labels: number[]): number {
  return labels.slice(0, K).reduce((a, g, i) => a + (2 ** g - 1) / Math.log2(i + 2), 0)
}

/** 검색어별 NDCG@10(방식별). 관련 후보가 없는 검색어(이상적 DCG 0)는 null. 결과가 없는 방식은 0. */
export function queryScores(rows: RankerEval[]): QueryScore[] {
  const by = new Map<string, RankerEval[]>()
  for (const r of rows) by.set(r.query_norm, [...(by.get(r.query_norm) ?? []), r])
  const one = (rs: RankerEval[], key: 'rank_popularity' | 'rank_model', ideal: number) => {
    const shown = rs.filter((r) => r[key] != null).sort((a, b) => (a[key] as number) - (b[key] as number))
    return shown.length ? dcg(shown.map((r) => r.label)) / ideal : 0
  }
  return [...by].map(([q, rs]) => {
    const ideal = dcg(rs.map((r) => r.label).sort((a, b) => b - a))
    return {
      q,
      intent: rs[0].query_intent,
      fold: rs[0].fold,
      n: rs.length,
      rel: rs.filter((r) => r.label > 0).length,
      pop: ideal ? one(rs, 'rank_popularity', ideal) : null,
      model: ideal ? one(rs, 'rank_model', ideal) : null,
    }
  })
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const nd = (v: number | null) => (v == null ? '—' : dec(v, 3))
const diff = (a: number | null, b: number | null) => (a == null || b == null ? '—' : `${b - a >= 0 ? '+' : '−'}${dec(Math.abs(b - a), 3)}`)

export default function M1({
  pairs,
  queries,
  features,
}: {
  pairs: RankerEval[]
  queries: RankerQueryEval[]
  features: RankerFeature[]
}) {
  const scores = useMemo(() => queryScores(pairs), [pairs])
  const rel = scores.filter((s) => s.pop != null && s.model != null)
  const avg = (xs: QueryScore[], k: 'pop' | 'model') => mean(xs.map((s) => s[k] as number))
  const all = { pop: avg(rel, 'pop'), model: avg(rel, 'model') }
  const better = rel.filter((s) => (s.model as number) > (s.pop as number) + 1e-9).length
  const worse = rel.filter((s) => (s.model as number) < (s.pop as number) - 1e-9).length
  const labels = pairs.reduce((a, r) => a + r.n_labels, 0)
  const nQueries = scores.length
  const foldMeans = Array.from({ length: FOLDS }, (_, f) => {
    const xs = rel.filter((s) => s.fold === f)
    return { f, n: xs.length, pop: avg(xs, 'pop'), model: avg(xs, 'model') }
  })

  const req = queries.reduce((a, r) => a + r.requests, 0)
  const zero = queries.reduce((a, r) => a + r.zero_results, 0)
  const linked = queries.filter((r) => r.query_intent !== 'other').reduce((a, r) => a + r.zero_results, 0)
  const left = queries.filter((r) => r.query_intent === 'other').reduce((a, r) => a + r.requests, 0)
  const byIntent = [...INTENTS, 'other'].map((it) => {
    const rs = queries.filter((r) => r.query_intent === it)
    const rq = rs.reduce((a, r) => a + r.requests, 0)
    const z = rs.reduce((a, r) => a + r.zero_results, 0)
    return { it, rq, z }
  })
  const examples = [...queries]
    .filter((r) => r.zero_results > 0 && r.query_intent !== 'other')
    .sort((a, b) => b.zero_results - a.zero_results || a.query_norm.localeCompare(b.query_norm))
    .slice(0, 10)
  const unresolved = [...queries]
    .filter((r) => r.query_intent === 'other')
    .sort((a, b) => b.requests - a.requests || a.query_norm.localeCompare(b.query_norm))
    .slice(0, 5)

  const feats = [...features].sort((a, b) => b.gain_share - a.gain_share)
  const groupShare = (g: string) => features.filter((f) => f.feature_group === g).reduce((a, f) => a + f.gain_share, 0)
  const groups = Object.keys(GROUP_LABEL)
    .map((g) => ({ g, v: groupShare(g) }))
    .sort((a, b) => b.v - a.v)
  const version = features[0]?.model_version ?? '—'

  const table: Cell[][] = [...scores]
    .sort((a, b) => (b.model ?? -1) - (a.model ?? -1) || a.q.localeCompare(b.q))
    .map((s) => [s.q, QUERY_INTENT[s.intent] ?? s.intent, s.fold, s.n, s.rel, s.pop == null ? null : dec(s.pop, 3), s.model == null ? null : dec(s.model, 3)])

  return (
    <>
      <Block title="배경·질문">
        <Para>
          실패 검색어는 장르·행사 유형의 줄임말·영문 표기와 상권의 한 동네 이름처럼 정식 이름과 글자가 다른 입력이었다(단계 1). 기존 랭킹(v1)은 정식 이름과 글자가
          같아야 찾고, 찾은 결과도 키워드 일치·인기 위주로 섞어 보여 준다. 4~6월 라벨(단계 2·3)이 쌓여 순서를 학습할 수 있게 됐다. 새 랭킹은 검색어 해석과 순위
          모델 두 가지를 바꾸므로, A/B 전에 둘을 나눠 오프라인으로 확인한다.
        </Para>
        <Bullets
          items={[
            '질문 1: 새 검색어 해석이 기존 랭킹의 결과 0건을 얼마나 결과로 바꾸는가.',
            '질문 2: 라벨로 학습한 순위 모델이 기존 정렬보다 관련 결과를 위로 올리는가.',
          ]}
        />
      </Block>

      <Block title="설계">
        <Spec
          items={[
            ['구조', '검색어 → ① 해석(정규화 → 동의어 사전 → 공간명 앞부분 일치) → 정식 이름·의도 유형 → 후보 → ② 순위 모델 점수순 상위 10'],
            [
              '① 해석 규칙',
              <>
                소문자로 바꾸고 공백·구분자(· /)를 지운다 → 동의어 사전으로 정식 이름에 연결한다(장르·행사 유형의 줄임말·영문 표기, 상권의 한 동네 이름, 공간 전체 상호)
                → 사전에 없고 2글자 이상이면 공간명 앞부분과 맞춘다. 예: ‘edm’ → 일렉트로닉, ‘연남’ → 홍대·합정·연남, ‘홍대 합정 연남’ → 홍대·합정·연남
              </>,
            ],
            ['② 순위 모델', 'LightGBM LambdaRank(목표 NDCG). 학습률 0.05, 잎 15개, 반복 200회, 행 표본 0.8 · 피처 표본 0.9, L2 1.0'],
            [
              '학습 데이터',
              <span className="tnum">
                7/6 전 최종 라벨 {num(labels)}건 → 검색어 × 후보 {num(pairs.length)}쌍(검색어 {num(nQueries)}개). 정답 등급 = 쌍별 등급 평균 반올림(0~3)
              </span>,
            ],
            ['피처', `${Object.keys(FEATURE_LABEL).length}개. 검색어 의도와 후보 속성이 맞는지(장르·상권·행사 유형·공간명 일치, 상권 거리), 후보 속성, 인기. 노출 순위는 넣지 않는다(기존 랭킹 순서를 배우지 않도록)`],
            [
              '평가',
              `검색어 단위 ${FOLDS}묶음 교차 검증(한 묶음을 빼고 학습한 모델이 그 묶음을 채점). NDCG@${K} = 상위 ${K}의 DCG ÷ 이상적 DCG(이득 2^등급 − 1, 할인 log2(순위 + 1)), 관련 후보가 있는 검색어만 평균`,
            ],
            ['비교 기준', '기존 정렬 = 정식 이름과 같을 때만 결과, 인기(학습 마감 전 신청 수)순. 해석 평가는 실험 설계서와 같은 기준선 2주(6/22~7/5) 검색 로그'],
          ]}
        />
      </Block>

      <Block title="결과">
        <Card title="① 검색어 해석" meta={`기준선 ${BASE[0].slice(5).replace('-', '/')}~${BASE[1].slice(5).replace('-', '/')} · 서버 검색 요청 · 전부 기존 랭킹`}>
          <SideTable
            heads={['지표', '기존 랭킹', '새 해석 적용 시']}
            rows={[
              ['검색 요청', num(req), num(req)],
              ['결과 0건 요청', `${num(zero)} (${pct(zero / req)})`, `${num(left)} (${pct(left / req)})`],
              ['기존 0건 중 정식 이름에 연결', '—', `${num(linked)} (${pct(linked / zero)})`],
            ]}
          />
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="의도 유형별" meta="새 해석 기준 의도 · 요청 수">
            <SideTable
              heads={['의도', '요청', '기존 0건']}
              rows={byIntent.map((r) => [QUERY_INTENT[r.it] ?? r.it, num(r.rq), `${num(r.z)} (${pct(r.z / r.rq)})`])}
            />
          </Card>
          <Card title="기존 0건 검색어 → 새 해석" meta="기존 0건 요청이 많은 순 10개">
            <SideTable
              heads={['검색어', '기존 0건', '연결된 정식 이름']}
              rows={examples.map((r) => [r.query_norm, num(r.zero_results), `${r.query_term} · ${QUERY_INTENT[r.query_intent] ?? r.query_intent}`])}
            />
          </Card>
        </div>
        <Card title="② 순위 모델" meta={`${FOLDS}묶음 교차 검증 · NDCG@${K} · 관련 후보가 있는 검색어`}>
          <SideTable
            heads={['의도', '검색어', '기존 정렬', '순위 모델', '차이']}
            rows={[
              ['전체', num(rel.length), nd(all.pop), nd(all.model), diff(all.pop, all.model)],
              ...INTENTS.map((it) => {
                const xs = rel.filter((s) => s.intent === it)
                const p = avg(xs, 'pop')
                const m = avg(xs, 'model')
                return [QUERY_INTENT[it] ?? it, num(xs.length), nd(p), nd(m), diff(p, m)]
              }),
            ]}
          />
        </Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="묶음별" meta={`NDCG@${K} · 묶음마다 다른 검색어`}>
            <SideTable
              heads={['묶음', '검색어', '기존 정렬', '순위 모델']}
              rows={foldMeans.map((f) => [`${f.f}`, num(f.n), nd(f.pop), nd(f.model)])}
            />
          </Card>
          <Card
            title="피처 중요도"
            meta={`최종 모델 분할 이득 비중 · ${version}`}
            right={
              <Legend
                items={[
                  { label: GROUP_LABEL.match, color: groupColor('match') },
                  { label: GROUP_LABEL.popularity, color: groupColor('popularity') },
                  { label: '그 밖', color: groupColor('item') },
                ]}
              />
            }
          >
            <BarList
              items={feats.map((f) => ({ label: FEATURE_LABEL[f.feature] ?? f.feature, value: f.gain_share, color: groupColor(f.feature_group) }))}
              format={(v) => pct(v)}
            />
          </Card>
        </div>
      </Block>

      <Block title="해석">
        <Bullets
          items={[
            `해석: 기존 랭킹이 0건을 준 ${num(zero)}건 중 ${num(linked)}건(${pct(linked / zero)})이 정식 이름에 연결된다. 남은 ${num(left)}건은 공간명 오타처럼 사전에 없는 입력이다(${unresolved.map((r) => `‘${r.query_norm}’`).join(' · ')} 등). 해석만으로 결과 0건 비율이 ${pct(zero / req)} → ${pct(left / req)}로 줄 것으로 본다.`,
            `정렬: 관련 후보가 있는 검색어 ${num(rel.length)}개에서 NDCG@${K}가 ${nd(all.pop)} → ${nd(all.model)}(${diff(all.pop, all.model)})다. ${num(better)}개 검색어가 나아지고 ${num(worse)}개가 나빠졌으며 나머지는 같다. 네 의도 유형 모두 올랐다.`,
            `피처: ${groups
              .slice(0, 2)
              .map((g) => `${GROUP_LABEL[g.g]} ${pct(g.v)}`)
              .join(', ')} 순으로 이득이 컸다. 검색 의도와 후보 속성이 맞는지가 순서를 정하고, 인기는 같은 등급 안의 순서를 정하는 데 쓰였다.`,
            `묶음별 NDCG@${K}는 ${nd(Math.min(...foldMeans.map((f) => f.model ?? 1)))} ~ ${nd(Math.max(...foldMeans.map((f) => f.model ?? 0)))}로, 어느 묶음에서도 기존 정렬(${nd(Math.min(...foldMeans.map((f) => f.pop ?? 1)))} ~ ${nd(Math.max(...foldMeans.map((f) => f.pop ?? 0)))})보다 높다.`,
          ]}
        />
      </Block>

      <Block title="결정">
        <Para>
          두 변경 모두 기존보다 낫다. 해석과 순위 모델을 함께 넣은 새 랭킹을 기기 50:50 A/B 로 검증한다(다음 단계 실험 설계서). 오프라인 NDCG 는 사람 라벨 기준이라 실제로
          결과를 누르는지는 A/B 의 검색 성공률로 본다.
        </Para>
      </Block>

      <Block title="한계">
        <Bullets
          items={[
            '7/6 전 라벨은 기존 랭킹이 결과를 낸 검색어(정식 이름)에만 있다. 줄임말·동네 이름 검색어는 정렬 평가에서 빠졌고, 해석이 맞게 연결되면 같은 정식 이름의 후보·피처로 채점되므로 정렬 품질도 같다고 본다.',
            '라벨 후보는 배치마다 검색어당 최대 12개(노출 결과 + 확장 후보)이고, 여러 배치에 나온 검색어는 후보가 쌓인다. 후보 밖에서 관련 결과를 놓치는지는 이 평가로 알 수 없다.',
            '해석 뒤 0건은 정식 이름이 나오면 결과가 있다고 본 값이다. 오타는 이번 해석으로 고치지 않는다.',
            `상권·장르·행사 유형 검색어는 정식 이름 수만큼만 있어(관련 후보가 있는 검색어 ${['region', 'genre', 'event_type'].map((it) => rel.filter((s) => s.intent === it).length).join('·')}개) 유형별 차이는 참고용이다.`,
          ]}
        />
      </Block>

      <Block title="데이터셋 구성">
        <Dataset
          path={['staging.int_label · int_search', 'staging.ml_ranker_pairs', 'ranker/train.py → raw.ml_*', 'marts.ranker_eval · ranker_query_eval · ranker_feature']}
          grain={
            <>
              <span className="font-mono text-[12.5px]">ranker_eval</span> 1행 = 검색어 × 후보(정답 등급·묶음·방식별 순위) ·{' '}
              <span className="font-mono text-[12.5px]">ranker_query_eval</span> 1행 = 기준선 2주 검색어(요청·기존 0건·새 해석) ·{' '}
              <span className="font-mono text-[12.5px]">ranker_feature</span> 1행 = 피처
            </>
          }
          measures={[
            [`NDCG@${K}`, 'Σ (2^label − 1) ÷ log2(rank + 1), rank ≤ 10', '같은 식의 이상적 순서 값'],
            ['기존 0건 비율', 'zero_results', 'requests'],
            ['해석 뒤 0건 비율', "requests (query_intent = 'other')", 'requests'],
            ['기존 0건 중 연결', "zero_results (query_intent ≠ 'other')", 'zero_results'],
          ]}
          rule="라벨은 2026-07-06 전 최종 라벨, 해석 평가는 세션 시작일 2026-06-22 ~ 07-05. 모델 점수는 그 검색어 묶음을 빼고 학습한 모델의 값"
          rows={pairs.length}
          sql="bigquery/reports/ranker_offline.sql"
          table={{ title: '검색어별 NDCG@10', head: ['검색어', '의도', '묶음', '후보', '관련 후보', '기존 정렬', '순위 모델'], rows: table }}
          csv="placewave_ranker_offline.csv"
        />
      </Block>

      <Block title="모델 코드">
        <ul className="flex flex-wrap gap-2">
          {[
            { label: '설계·실행법 (ranker/README.md)', path: 'ranker/README.md' },
            { label: '학습·평가 (ranker/train.py)', path: 'ranker/train.py' },
            { label: '모델 카드 (model_card.json)', path: 'ranker/artifacts/model_card.json' },
          ].map((l) => (
            <li key={l.path}>
              <a
                href={`${REPO}/blob/main/${l.path}`}
                target="_blank"
                rel="noreferrer"
                className="card inline-flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:shadow-[0_0_0_1px_var(--axis)]"
              >
                {l.label}
                <span aria-hidden className="text-muted">
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Block>
    </>
  )
}
