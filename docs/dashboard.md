# Placewave KPI 대시보드 — 탭·지표·필터·데이터 계약

가상 서비스 시나리오로 생성한 데이터 · 실제 서비스 데이터 아님. 앱 코드는 `dashboard/`.

## 1. 원칙

1. **필터는 마트에 축이 있을 때만 붙인다.** 필터가 걸린 것처럼 보이는데 값이 안 변하는 카드는 만들지 않는다. 축이 없는 대상(공간·행사·캠페인)은 탭 안 **보기 전환**으로 분리하고, 그 보기에서는 세그먼트 줄을 대상 축 컨트롤(지역·장르 / 유형·가격대 / 캠페인)로 바꾼다. 보기 전환은 메인 탭 바로 아래 서브 탭 줄에 두고, 필터 영역(기간 줄·세그먼트 줄)에는 필터만 둔다.
2. **같은 보기 안에서는 줄을 없애지 않고 바꾼다.** 필터 바는 기간 줄과 세그먼트 줄 두 줄이고, 필터 값을 바꿔도 높이가 그대로다. 주간·월간 탭은 기간 줄이 주차·월 선택기로, 월간 보기는 세그먼트 줄이 범위(6/12개월) 선택으로, 평가 운영 탭은 세그먼트 줄이 요청 부서 선택으로 바뀐다. 보기(서브 탭)를 바꾸면 그 보기의 필터 줄로 바뀌고, 걸 수 있는 필터가 없는 보기(매출 구성·구독)는 세그먼트 줄을 두지 않는다.
3. **탭 구조는 스코어보드 → 메인 추이 → (대상 탭만) 표.** 설명 문장은 화면에 쓰지 않고 라벨·단위·창·분모 한 줄로 푼다(`방문자 944명 중`, `W1 리텐션 · 9/7 코호트`).
4. **비율은 화면에서 계산한다.** 마트는 분자·분모 열만 두고, 화면은 필터 적용 후 분자·분모를 각각 합산한 뒤 나눈다. 비율의 증감은 %p, 건수·금액의 증감은 %. 작은 개수(평가자·배치)와 비율이 아닌 지수(카파)는 차이 값(`▲ 2명`, `▼ 0.01`, 같으면 `±0명`).
5. **단위를 섞지 않는다.** 일별 마트의 사람 수를 기간으로 합하면 사람이 아니라 사람 × 일이다. 사람 지표는 `person_day` 로 기간 고유를 세고(§3), 주간·월간 탭의 WAU·월 방문자·리텐션은 주간·월간 마트에서 읽는다.
6. **기간 길이에 따라 입자가 바뀐다.** 1일 = 시간별 차트, 120일 이하 = 일별, 그 이상 = 주별(월요일 시작). 개요 탭 추이 카드는 별도 규칙(§3b).
7. **대상을 고르면 기간이 따라간다.** 캠페인 보기의 기본 기간은 `캠페인 기간`(선택한 캠페인의 관측 범위, 전체 선택 시 모든 캠페인 범위). 선택기 옵션에 관측 기간을 병기한다.
8. 필터 상태는 전부 URL 쿼리에 있어 링크로 같은 화면을 공유할 수 있다.

## 2. 탭

| 탭 | 보기 | 세그먼트 줄 | 스코어보드 | 메인 차트 | 표 | 마트 |
|---|---|---|---|---|---|---|
| 개요 | — | 채널·플랫폼·회원 | 기준일 현황(누적 회원·등록 공간·파트너 공간, 필터 미적용) + `핵심 지표` 한 줄 6칸(방문자·신규 방문자·가입·결제·플랫폼 매출·활성 구독자. 뒤 둘은 세그먼트 필터 시 숨기고 4칸) | `추이` 소제목 아래 카드 5개, 스코어보드 순서와 1:1: 방문자 → 신규 방문자·가입 → 결제(보조선 신청) → 플랫폼 매출·구성(§3c 매출 구성 카드) → 활성 구독자(보조선 신규 구독) (§3b). 뒤 둘은 세그먼트 필터 시 숨김 | — | daily_metrics, hourly_metrics, person_day, daily_venue, daily_revenue, daily_subscription, daily_venue_registry |
| 퍼널 | — | 채널·플랫폼·회원 | 전체 전환율(랜딩→결제)·최대 이탈 단계·가장 크게 변한 단계·탐색 도달률 | 단계 전환율 추이(상세→신청 화면, 신청 화면→결제. 28일 이상 주별, 미만 일별, 1일은 단계 막대) + 세그먼트별 퍼널 히트맵 표 | 드릴다운 ① 오디언스별 퍼널(오디언스 칩 → 도달률 표 + 주별 전환율. 기간·세그먼트 안 랜딩 0인 오디언스는 칩 비활성, 예: 회원 필터의 `신규`) ② 경로 탐색 생키 · 보조 요일×시간대 (1일: 시간별 세션) | person_day, funnel_daily, daily_metrics, hourly_metrics, weekly_audience_funnel, weekly_path |
| 검색 | — | 채널·플랫폼·회원 | 검색 이용자·결과 0건 비율·결과 클릭률·평균 첫 클릭 순위·재검색률·검색 세션 신청 전환 | 결과 0건 비율·결과 클릭률 추이(A/B 테스트 시작일·새 랭킹 전체 적용일 표시, 표식이 기간 안에 있으면 머리에 `실험 보고서 보기` 링크) | 의도 유형별 · 검색어(검색 20건 이상, 실패 검색어 강조, 평가 편입일. 공간명 검색어는 앞 단어가 같은 가상 상호를 `○○ 외 N곳` 으로 병기 — 검색어는 사용자가 친 상호 첫 단어라 한 곳으로 바꾸지 않는다) | daily_search, daily_query, person_day, venue_registry |
| 행사·결제 | 흐름 | 채널·플랫폼·회원 | 신청·결제·결제 금액·결제자당 금액·취소율 | 신청·결제 추이 + 결제 퍼널(행사 상세 → 신청 화면 → 결제) | — | daily_metrics, hourly_metrics, person_day |
| 행사·결제 | 행사별 | 유형·가격대 | 조회된 행사·신청·결제 금액·신청분 취소율 | 결제 금액 추이 | 행사별 성과 | daily_event |
| 행사·결제 | 공간별 | 지역·장르 | 조회된 공간·신청·결제 | 공간 상세 조회 추이 | 공간 순위 | daily_venue |
| 행사·결제 | 매출 구성 | (없음 — 매출 마트에 세그먼트 축 없음) | 거래액·플랫폼 매출·실효 수수료율·객단가·환불률 | 매출 구성 카드(개요와 같은 카드, 분해 타일 없이 차트만 — 수수료·멤버십·파트너 플랜 누적 + 거래액 선) → 멤버 할인 부담액 막대(31일 이하 일별·120일 이하 주별·그 이상 월별) | 수수료 등급별 거래(비파트너·베이직·프로: 율·결제·거래액·비중·수수료·멤버 할인, 머리에 파트너 거래액 비중) | daily_revenue |
| 회원 | 회원 | 채널·플랫폼·회원 | 가입·신규 방문자 대비 가입·회원 방문자·방문자 중 회원 비중·W1·W4 | 방문자 회원/비회원 누적 + 리텐션 곡선 W1~W12 | — | daily_metrics, hourly_metrics, weekly_cohort, person_day |
| 회원 | 구독 | (없음 — 구독 마트에 세그먼트 축 없음) | 2줄 8칸: 활성 구독자·신규 구독·구독 해지·구독 월 해지율 / 구독 MRR(보조 ARR)·구독 LTV(보조 ARPU − 할인)·회원 대비 구독 비중·멤버 할인 부담률 | 구독자 / 구독 MRR 두 차트(120일 이하 일별, 그 이상 주 마지막 날) → 구독 코호트 유지율 히트맵(시작 월 × M1~, 기간 끝일까지 끝난 달) | 구독자 vs 비구독 회원 티켓 결제(방문 회원·결제자·방문 대비 결제·티켓 결제액·결제자당 금액·멤버 할인) | daily_subscription, daily_revenue, subscription_cohort, daily_metrics, person_day |
| 공간 | — | 상권 선택(세그먼트 줄 대체) | `공간` 행(등록 공간·파트너 공간·파트너 전환율·신규 계약·계약 해지·파트너 플랜 MRR) + `파트너 계약 · 월 기준` 행(계약 월 해지율·ARPA·GRR·NRR·파트너 부담률, 상권 선택 시 숨김) | 등록 공간 / 파트너 공간 / 신규 계약·해지 세 차트(31일 이하 일별, 그 이상 주별) → 플랜별 구성(월말 계약·MRR 토글, 최근 12개월) + 계약 코호트 유지율 히트맵(계약·MRR 토글) (둘 다 상권 선택 시 숨김) → 서울 분포 지도(영업 중 공간, 카드 안 무드·파트너 여부 선택) | 상권별(기준일 스냅샷, 등록 수는 폐업 포함 — 등록 공간 타일과 같은 기준) · 파트너 공간(상위 50, 정렬) | daily_venue_registry, venue_registry, monthly_contract, contract_cohort, daily_revenue |
| 유입·광고 | 채널 | 채널·플랫폼·회원 | 세션·광고 세션 비중·신규 방문자·가입·결제 금액 | 유입 유형별 세션 누적 (1일: 막대 목록) | 채널별 성과(유입 유형 · 소스 = `channel2` · `channel3`) | daily_channel |
| 유입·광고 | 캠페인 | 캠페인 선택 | 집행(지출·노출·클릭, CTR) → 유입(세션·신규 방문자) → 행동(가입 + CAC·신청·결제 금액 + ROAS) | 지출 / 광고 세션 (두 차트, 이중 축 없음) | 캠페인 비교(행 클릭 = 선택) | daily_ad |
| 평가 운영 | — | 요청 부서(세그먼트 줄 대체) · 기간 줄 → 주차 | `진척`(목표 대비 진척률·완료 과제·마감 위험 배치) / `생산성`(라벨 수·활동 평가자·평가자당 라벨 수·건당 처리 시간) / `품질`(정답셋 정확도·평가자 간 일치율·일치도 카파·재작업률·기준 미달 평가자) | 품질 추이(정확도·일치율·카파, 지침 v2 표시) + 라벨 수(내부/외부 누적), 최근 12주 | 배치 진척(완료·마감 지남·위험·진행) · 처리 속도 × 정확도 산점도 + 평가자 · 지침 버전 비교(그 주까지 누적) | weekly_eval_ops, weekly_rater, weekly_batch |
| 주간·월간 | 주간 | 채널·플랫폼·회원 · 기간 줄 → 주차 | WAU·신규·재방문·재방문 비중·주 2일+ 방문·W1(직전 주 코호트) | 주간 방문자 12주(신규/재방문) + 코호트 히트맵 W1~W12(12개 코호트 + 가중 평균) | 주간 브리핑(방문·검색·평가 운영 변화를 규칙 문장으로. 세그먼트를 걸면 평가 운영 줄은 뺀다) | weekly_activity, weekly_cohort, daily_search, weekly_eval_ops, weekly_batch |
| 주간·월간 | 월간 | 범위 6/12개월 · 기간 줄 → 월 | 방문자·신규·가입·결제 금액·신청분 취소율·W1 (전월 대비) | 월간 방문자(신규/재방문) + 월 코호트 M1~M6 | 월간 브리핑 | monthly_summary, monthly_cohort |

스코어보드마다 위에 소제목 한 줄 `<구획 이름> · <비교 기준>` 을 둔다(개요 `핵심 지표`, 퍼널 `전환`, 흐름 `신청·결제`, 매출 구성 `거래·매출`, 회원 `회원`, 구독 `구독`, 공간 `공간`·`파트너 계약 · 월 기준 <달 범위>`(비교 기준 `직전 N개월 대비`), 채널 `유입`, 검색 `검색`, 평가 운영 `진척 · <주> · 전주 대비`·`생산성`·`품질`, 주간 `주간 · 전주 대비`, 월간 `월간 · 전월 대비`). 비교 기준은 `직전 N일 대비`(1일은 `전일 대비`), 직전 기간이 데이터 범위 밖이면 `전기 없음`. 증감이 없는 스코어보드(행사별·공간별·캠페인)는 소제목을 두지 않는다. 공간 탭 상권 선택지는 `전체` → 기준일 등록 공간 수 내림차순 → `기타`.

탭 순서는 도메인 탭 → 성격이 다른 주간·월간 탭(끝). 공간 탭은 회원 옆. 공간·행사의 `genre` 값은 화면에서 `무드` 로 부른다. 공간 탭의 무드·파트너 여부 선택은 필터 줄이 아니라 지도 카드 머리에 둔다 — `daily_venue_registry` 의 축이 상권 하나라 스코어보드·추이가 그 선택을 받을 수 없기 때문이다(URL `sr`·`sg`·`sp`). 퍼널 탭은 표 열에 드릴다운 카드를 적었다. 옛 링크 `tab=explore` 는 퍼널 탭으로, `tab=explore&view=venue` 는 행사·결제 공간별로 연결된다.

## 3. 지표 산식 (화면 계산)

| 지표 | 산식 | 단위 |
|---|---|---|
| 방문자 (개요·회원 탭) | 기간·세그먼트 안 `visited` 비트를 가진 고유 `pk` 수(`person_day`). 키가 없으면 Σ persons 로 폴백 | 명 |
| 사람 지표 공통 | 방문자·회원 방문자·탐색·행사 상세·신청 화면·결제자·퍼널 단계는 전부 `person_day` 기간 고유 사람 수(마스크의 비트를 같은 날 모두 가진 고유 `pk`, `uniqueByMasks`). 세그먼트 필터·분해는 사람마다 기간 안 마지막 해당일의 세그먼트 값 하나로 귀속한다(§4 사람 단위 수의 세그먼트 귀속 — `uniqueByMasks` 도 같은 규칙, 마스크 하나라도 맞는 마지막 날). 그래서 세그먼트별 퍼널 표의 값별 랜딩 합 = 전체. 건수(세션·신청·결제·금액)는 합, 신규·가입은 합(사람당 1회). 키가 없으면 마트 합으로 폴백 | 명 |
| 기준일 현황 (개요 탭) | 누적 회원 = `meta.to_date` 까지 Σ signups(전체, 필터 미적용) · 공간 = `daily_venue` 고유 venue_id | 명 · 곳 |
| 활성 세션 비율 | Σ engaged_sessions ÷ Σ sessions | 세션 |
| 탐색 도달률 (퍼널 탭) | 고유(visited ∧ explored) ÷ 고유(visited) | 명 |
| 단계 막대 (퍼널 탭 1일) | 누적 단계별 고유 사람, 막대 = 첫 단계 대비(이탈 구간 빗금), 단계 사이 = 이전 단계 대비 전환율·이탈 인원 | 명 |
| 결제 퍼널 (행사·결제) | 누적 조건 고유 사람: event_detail → event_detail ∧ apply_view → event_detail ∧ apply_view ∧ paid(같은 날 비트 AND). 뒤 단계가 앞 단계에 포함된다. 결제자당 금액의 결제자는 누적 조건 없이 고유(paid). `person_day` 가 없으면 daily_metrics 열 합(비누적)으로 폴백 | 명 |
| 결제자당 금액 | Σ pay_amount ÷ 고유(paid) | 원 |
| 취소율 (흐름 보기) | `daily_metrics` Σ cancels ÷ Σ applies. 분자는 취소일 기준 로그라 기간 이전 신청분의 취소도 들어간다 | 건 |
| 신청분 취소율 (행사별 보기·월간) | `daily_event`·`monthly_summary` Σ cancels ÷ Σ applies. 기간(월)에 신청한 건 중 지금까지 취소된 건(신청일 코호트). 최근 신청분은 취소될 시간이 짧아 흐름 보기 취소율보다 낮게 나온다(28일: 7.4% vs 9.5%) | 건 |
| 날짜 귀속 (신청·결제 건수) | 개요·흐름·회원·퍼널은 `daily_metrics`(로그, 세션 시작일), 행사별·공간별·매출은 원장(`daily_event` 신청일, `daily_revenue` 결제일). 자정을 넘긴 세션의 신청(전체의 0.5%)은 두 쪽 날짜가 달라 기간 경계에서 1~수 건 어긋난다(28일 신청 11,347 vs 11,348). 전 기간 합은 같다(검사 C12a·C12b) | 건 |
| 신규 방문자 대비 가입 | Σ signups ÷ Σ new_persons | 사람 |
| 회원 방문자 · 방문자 중 회원 비중 | 기간 안 마지막 방문일이 member 인 고유 사람 ÷ 고유 방문자(회원 + 비회원 = 방문자). 차트 일 버킷은 마트 값, 주 버킷(120일 초과)은 주마다 따로 센 주 고유(그 주 마지막 방문일로 귀속) | 명 |
| 상세 조회 표 열 (공간별·행사별) | `daily_venue`·`daily_event` 의 detail_viewers(그날 그 대상 상세를 본 고유 사람) 기간 합. 마트가 일 × 대상 집계라 기간 고유가 아니므로 열 이름 `조회 사람(일 합)`, 타일에는 두지 않는다. 공간 추이 차트도 같은 값의 버킷 합 | 사람(일 합) |
| 광고 탭 유입 | 세션 + 신규 방문자(Σ daily_ad.new_persons, 광고 세션이 첫 방문인 사람 — 사람당 1회라 합 = 고유). 열이 없으면 신규 타일을 숨긴다. 캠페인 귀속은 세션 라스트클릭이라 `person_day` 로 기간 고유를 낼 수 없어 방문자·활성 방문자 타일은 두지 않는다 | 세션 · 명 |
| W1 · W4 (회원 탭) | 기간 안에 시작한 코호트 중 해당 경과 주가 완결된 것만, Σ retained ÷ Σ cohort_size. 라벨에 쓰인 코호트 주 범위를 적고, 완결 코호트가 없으면 기간 안 코호트 범위와 `—` | 사람 |
| 광고 세션 비중 | channel1 = paid 의 Σ sessions ÷ Σ sessions | 세션 |
| CTR · CAC · ROAS | clicks ÷ impressions · spend ÷ signups · pay_amount ÷ spend | — |
| 재방문 비중 · 주 2일+ 방문 | returning_persons ÷ wau · two_plus_days ÷ wau | 사람 |
| 증감 | 직전 동일 길이 기간 대비(1일은 전일). 직전 기간이 데이터 범위 밖이면 표시하지 않는다 | % / %p |

타일 보조 문구: 증감 줄은 `▲ 9.5%` 처럼 화살표와 값만 쓴다(비교 기준은 스코어보드 소제목, 계산 불가는 `—`, 전기 없음은 빈 줄). 그 아래 보조 줄은 분모(`세션 187,803 중`, `방문자 N명 중`)·창(`9/20 기준`, `30일 환산`, 코호트 크기)·구성비(`플랫폼 매출의 82%`)처럼 값 해석에 필요한 정보가 있는 타일에만 둔다. 분모가 다른 타일에 있으면 그 수만 보여 주는 타일은 따로 두지 않는다(개요 `세션` 타일 제거 — 활성 세션 비율의 분모로 남음).

### 3b. 개요 탭 추이 카드 (`TrendCard`)

카드 한 장 = 주 지표 1개(+ 같은 단위 보조 지표 1개, 실선만) · 왼쪽 차트 · 오른쪽 분해 타일. 탭 상태에 의존하지 않고 행·기간·세그먼트 상태만 받는다. 개요 카드 순서는 스코어보드 6칸과 같다(신규 방문자·가입은 한 카드) — 스코어보드에 없는 지표의 추이 카드는 두지 않는다.

| 항목 | 규칙 |
|---|---|
| 전기 | 직전 동일 길이 기간 `[from − n, from − 1]`(n = 기간 일수, 1일이면 전일). 버킷 i 의 전기 값은 버킷 i 의 날짜를 n 일 당긴 구간의 값이며 같은 x 위치에 점선으로 겹친다. 전기 시작이 데이터 시작(`meta.from_date`)보다 이르면 점선·전기 대비를 숨기고 머리에 `전기 없음` |
| 그레인 | 토글 `자동·일·주·월`(카드별, URL 미저장). 자동 = 1일 → 시간, 14일 이하 → 일, 120일 이하 → 주, 그 이상 → 월. 버킷이 2개 미만이 되는 선택지는 비활성 |
| 버킷 | 주 = 기간 시작일부터 7일씩(마지막은 짧을 수 있음, 툴팁에 실제 범위). 월 = 달력 월과 기간의 교집합(부분 월은 툴팁에 범위 병기) |
| 버킷 값 | 건수·금액·신규·가입 = 버킷 합. 사람 지표(방문자) = 일 버킷은 일별 고유(마트 값), 주·월 버킷은 버킷 고유 사람(`person_day`, 없으면 합). 1일 시간별은 `hourly_metrics`(시간별 열이 없는 지표는 차트 없이 분해 타일만) |
| 활성 구독자 카드 | `daily_subscription`(세그먼트 축 없음). 주 지표 활성 구독자는 잔액형이라 주·월 버킷 값 = 버킷 안 마지막 날 값(`bucketAgg: 'last'`), 보조선 신규 구독은 버킷 합. 행이 없는 버킷(멤버십 출시 2025-12-01 이전)은 0이 아니라 빈 값으로 선을 끊는다(`gaps`). 분해 선택기·분해 타일 대신 고정 타일 4개: 활성 구독자·MRR = 기간 끝일 이하 마지막 날 값, 신규 구독·구독 해지 = 기간 합, 각각 전기 대비. 세그먼트 필터가 걸리면 카드를 숨긴다 |
| 분해 타일 | `전체` + 선택 축 값(회원/비회원 · 유료/비유료 · iOS/Android/웹)의 기간 값과 전기 대비 %. 사람 지표는 기간 고유(한 사람이 두 값에 나타나면 양쪽에 센다), 그 외는 합. 필터가 고정한 축은 선택기에서 비활성, 기본 축이 막히면 다음 축 |
| 툴팁 | 버킷(`9/21 (일)` · `9/15~9/21` · `2026-09`) / 지표 값 / 전기 대비 %(전기 0이면 `—`) / `전기 <범위>: 값` / 보조 지표 값과 전기 대비. 차트 영역 밖으로 나가지 않게 위치 보정 |
| 드릴다운 | 차트 클릭 → 가리킨 버킷으로 기간 변경: 일 → 그날(1일, 시간별), 주 → 그 7일(직접 기간), 월 → 그 달 전체(데이터 범위로 자름). URL 에 push 되어 뒤로 가기로 복귀 |

### 3c. 매출·구독·공간 산식

수익 모델은 `docs/business_model.md` A안. 플랫폼 매출 = 수수료 + 멤버십 + 파트너 플랜이고, 거래액(GMV)·티켓 결제액은 규모 지표다. `daily_revenue` 티켓 행은 `gmv_amount − discount_amount = paid_amount`(환불 주문 제외), `net_amount` = 수수료, `pay_count` 는 환불 포함. 멤버십·파트너 플랜 행은 `gmv_amount` 가 null 이고 `net_amount` 가 매출이다.

| 지표 | 산식 | 단위 |
|---|---|---|
| 플랫폼 매출 · 수수료 · 멤버십 · 파트너 플랜 | 기간 Σ `net_amount` 전체 · kind = ticket · membership · partner_plan. 전기 대비는 직전 동일 길이 기간 | 원 |
| 거래액 · 티켓 결제액 | Σ `gmv_amount` · Σ `paid_amount` (kind = ticket) | 원 |
| 매출 구성 카드 (개요·매출 구성) | `TrendCard` 와 같은 버킷·그레인·전기·드릴다운 규칙(§3b). 차트 = 수수료·멤버십·파트너 플랜 누적 막대(왼쪽 축) + 거래액 선(오른쪽 축) + 전기 플랫폼 매출 점선. 분해 타일(개요만) = 플랫폼 매출·수수료·멤버십·파트너 플랜·거래액. 1일은 분해 타일만 | 원 |
| 실효 수수료율 | Σ net(ticket) ÷ Σ gmv(ticket) | % |
| 객단가 | Σ gmv ÷ (Σ pay_count − Σ refund_count) (ticket) | 원 |
| 환불률 | Σ refund_count ÷ Σ pay_count (ticket), 보조 줄에 환불 금액 | % |
| 수수료 등급별 거래 | `fee_tier` 별 결제(pay_count − refund_count)·거래액·거래액 비중·수수료·멤버 할인. 수수료율 열은 설정값(10·5·3%). 파트너 거래액 비중 = (basic + pro) gmv ÷ gmv | 건 · 원 · % |
| 멤버 할인 부담액 | 버킷별 Σ discount_amount (ticket) | 원 |
| 활성 구독자 · 구독 MRR | 기간 끝일 이하 마지막 날의 `active_subscribers` · `mrr`(합산하지 않음). ARR = MRR × 12 | 명 · 원 |
| 신규 구독 · 구독 해지 | 기간 Σ new_subscribers · churned_subscribers | 건 |
| 구독 월 해지율 | Σ churned ÷ 구독자·월. 구독자·월 = Σ 일별 active_subscribers ÷ 30(기간이 출시 전부터 시작해도 계산된다) | % |
| 구독 LTV(추정) | (ARPU − 1인·월 할인) ÷ 구독 월 해지율. ARPU = 멤버십 매출 ÷ 구독자·월, 1인·월 할인 = Σ `daily_subscription.discount_amount` ÷ 구독자·월 | 원 |
| 회원 대비 구독 비중 | 기간 끝 활성 구독자 ÷ 그날까지 Σ signups(`daily_metrics` 전체 세그먼트) | % |
| 멤버 할인 부담률 | Σ `daily_subscription.discount_amount` ÷ 멤버십 매출 | % |
| 구독 코호트 유지율 | `subscription_cohort` retained ÷ cohort_size. 행 = 시작 월 ≤ 기간 끝 월의 최근 12개, 칸 = M1~M12 중 그 달 말일 ≤ 기간 끝일 | % |
| 구독자 vs 비구독 회원 | `person_day` 에서 member 코드인 행만, 사람마다 기간 안 마지막 회원 행(방문 또는 결제)의 비트 32768(`subscribed`) 유무로 귀속해 visited·paid 고유 pk(두 행 합 = 기간 회원 방문자). 티켓 결제액은 구독자 = Σ subscriber_ticket_amount, 비구독 = 티켓 결제액 − 그 값. 멤버 할인은 전부 구독자 몫 | 명 · 원 |
| 등록 공간 · 파트너 공간 · 파트너 플랜 MRR | 기간 끝일 이하 마지막 날의 상권 합 `registered_total` · `partner_total` · `mrr_basic + mrr_pro`(`*_total` 은 기간으로 더하지 않는다) | 곳 · 원 |
| 신규 계약 · 계약 해지 | 기간 Σ new_contracts · churned_contracts | 건 |
| 계약 월 구획의 달 | `monthly_contract` 의 끝난 달(말일 ≤ `meta.to_date`) 중 기간과 겹치는 달. 없으면 기간 끝 이전 마지막 끝난 달. 전기 = 바로 앞 같은 개수의 끝난 달(모자라면 증감 없음). 전부 plan = all 행 | 달 |
| 계약 월 해지율 · 매출 해지율 | Σ churned_contracts ÷ Σ contracts_bom · Σ (mrr_churn + mrr_contraction) ÷ Σ mrr_bom | % |
| GRR · NRR | Σ (mrr_bom − mrr_churn − mrr_contraction) ÷ Σ mrr_bom · 같은 분자 + Σ mrr_expansion. NRR 보조 줄에 업·다운그레이드 건수 | % |
| ARPA | 구획 마지막 달의 `arpa`(= mrr_eom ÷ contracts_eom) | 원 |
| 파트너 부담률 | 구획 달 범위의 (Σ net(ticket, fee_tier ∈ basic, pro) + Σ net(partner_plan)) ÷ Σ gmv(ticket, fee_tier ∈ basic, pro) | % |
| 플랜별 구성 | `monthly_contract` plan = basic·pro 의 contracts_eom 또는 mrr_eom, 기간 끝 월까지 최근 12개월(진행 중인 달은 기준일 값) | 계약 · 원 |
| 계약 코호트 유지율 | `contract_cohort` retained ÷ cohort_size, MRR 토글은 mrr_retained ÷ 0개월 mrr_retained. 머리 칸은 코호트 계약 수 | % |
| 공간 추이 (주별) | `*_total` 은 주 마지막 날 값, 계약 수는 주 합 | 곳 · 건 |
| 서울 분포 지도 | `venue_registry` 중 `status ≠ closed`. 좌표는 위경도를 등장방형 근사(경도 × cos 37.55°)로 투영, 서울 외곽선·한강은 근사 다각형. 점 반지름 = 3 + 9·√(28일 조회 ÷ 최댓값), 색 = `is_partner`. hover 는 가장 가까운 점(14px 이내) | 곳 |
| 상권별 · 파트너 공간 표 | `venue_registry` 스냅샷 그대로(파트너 판정은 `is_partner` 만), 이벤트·티켓 결제액은 365일, 조회는 28일. 상권별 등록 수는 폐업 포함(합 = 등록 공간 타일 1,800), 지도·파트너 공간 표는 `status ≠ closed` | 곳 · 건 · 원 |

### 3a. 퍼널 탭 산식

`funnel_daily` 의 단계는 누적 조건이다(랜딩 ⊇ 상세 ⊇ 로그인·가입 ⊇ 신청 화면 ⊇ 결제). 화면은 같은 조건을 `person_day` 비트 AND(visited → +event_detail → +logged_in → +apply_view → +paid, 같은 날 판정)로 다시 세어 기간·세그먼트 안 **고유 사람 수**를 쓴다. 아래 n(k) 는 단계 k 의 고유 사람 수, `person_day` 가 없으면 funnel_daily 합으로 폴백.

| 지표 | 산식 | 단위 |
|---|---|---|
| 전체 전환율 | n(payment) ÷ n(landing) | 명 |
| 최대 이탈 단계 | 랜딩 대비 도달률 r(k) = n(k) ÷ n(landing) 에서 r(k−1) − r(k) 가 가장 큰 k. 값은 그 차(%p) | 명 |
| 가장 크게 변한 단계 | 직전 단계 대비 전환율 c(k) = n(k) ÷ n(k−1) 의 직전 동일 길이 기간 대비 차가 절댓값 최대인 k. 직전 기간이 데이터 범위 밖이면 비운다 | %p |
| 단계 전환율 추이 | 기간 28일 이상 주(월요일) 버킷, 미만 일 버킷마다 버킷 고유 사람으로 c(apply_view), c(payment). 분모 0인 버킷은 선을 끊는다 | 명 |
| 세그먼트별 퍼널 | 행 = 전체 + 세그먼트 값(선택한 축의 다른 값은 숨김), 칸 = r(k)(행마다 그 세그먼트의 고유 사람, 사람은 기간 안 마지막 해당일의 값 하나로 귀속 — 축마다 값별 랜딩 합 = 전체). 색은 열 안 최소~최대 명도 | 명 |
| 오디언스 도달률 | 기간과 겹치는 주(`week_start ∈ [기간 시작의 월요일, 기간 끝]`)를 합산해 오디언스별 Σ step_k ÷ Σ landing. 랜딩 합이 0인 오디언스(회원 필터의 `신규` — 첫 방문 주에는 회원일 수 없다)는 칩을 비활성으로 두고 표·차트에서 뺀다 | 사람·주 |
| 오디언스 주별 전환율 | 주마다 Σ payment ÷ Σ landing (주 2개 이상일 때만 그림) | 사람·주 |
| 경로 비중 | 링크 세션 ÷ 출발 노드 세션(그 화면 세션 중), 링크 세션 ÷ step 1 세션 합(전체 세션 대비). 노드는 기간 안 세션 상위 12개 화면만 이름을 두고 나머지는 `(기타)` | 세션 |

오디언스끼리는 겹치므로 합산하지 않는다. 드릴다운 두 카드는 주 단위라 기간 프리셋이 1일·7일이어도 그 날짜가 속한 주 전체를 쓰며, 카드 머리에 주 수와 범위를 적는다. 두 표가 추출에 없으면(`weekly_audience_funnel` 키·`files.weekly_path` 부재) 카드는 '데이터 없음'.

코호트 히트맵은 선택한 주(월)까지 완결된 칸만 칠한다. 색은 한 색상의 명도 단계(값이 클수록 진함), 칸 안 숫자는 %.

### 3d. 검색·평가 운영 산식

| 지표 | 산식 | 단위 |
|---|---|---|
| 검색 이용자 | `person_day` `searched` 비트 기간 고유 사람 | 명 |
| 결과 0건 비율 | Σ zero_result_searches ÷ Σ searches (서버 요청 전체가 분모) | 건 |
| 결과 클릭률 | Σ clicked_searches ÷ Σ matched_result_searches (GA 매칭 요청 중 결과가 있던 것) | 건 |
| 검색당 클릭 | Σ clicked_searches ÷ Σ ga_matched_searches (0건 포함). 0건이 줄면 결과 클릭률의 분모가 늘어 클릭률만 내려갈 수 있다 | 건 |
| 평균 첫 클릭 순위 · 상위 3위 클릭 비중 | Σ first_click_position_sum ÷ Σ clicked_searches · Σ top3_clicks ÷ Σ clicked_searches | 위 · 건 |
| 재검색률 · 검색 세션 신청 전환 | Σ reformulated_searches ÷ Σ ga_matched_searches · Σ search_sessions_applied ÷ Σ search_sessions | 건 · 세션 |
| 실패 검색어 | `daily_query` 검색어별 기간 합으로 검색 20건 이상이고 결과 0건 비율 30% 이상 | 검색어 |
| 평가 편입일 | `daily_query.eval_dates`(검색팀 배치 — 실패·상위·무작위 출처 — 에 편입된 날 목록. 프로모션 추천 슬롯 배치는 검색 결과가 아니라 추천 행사를 평가하므로 뺀다) 중 기간 시작 ~ 기간 끝 + 7일 안의 첫 날. 없으면 비운다 — 실패가 반복된 검색어는 그 기간의 편입을 보고, 예전 편입을 끌어오지 않는다. 상위 검색량 출처로 들어간 실패 검색어도 라벨이 붙으므로 편입으로 센다 | 날짜 |
| 실험 기간 | v1·v2가 같은 날 각각 그날 검색의 10% 이상인 날의 처음 ~ 끝(07-13 ~ 07-26). 다음 날을 v2 전체 적용일로 표시 | 일 |
| 랭킹 실험 차이 · 95% 구간 | 비율 = p2 − p1 ± 1.96·√(p1(1−p1)/n1 + p2(1−p2)/n2). 평균 첫 클릭 순위 = m2 − m1 ± 1.96·√(s1²/n1 + s2²/n2), s² = (Σx² − n·m²) ÷ (n − 1), Σx² = `first_click_position_sq_sum`. 구간이 0을 포함하면 `차이 없음`, 아니면 지표 방향에 따라 `개선`·`악화`. 결과 클릭률이 `악화`이면서 검색당 클릭이 `차이 없음`이고 0건 비율이 `개선`이면 판정 옆에 `분모 효과`(툴팁에 이유) | — |
| 목표 대비 진척률 | 그 주 배치(요청 부서 필터) Σ done_tasks ÷ Σ target_tasks, 주말 시점 누적 | 과제 |
| 마감 위험 배치 | 그 주 진행 배치를 우선순위 → 생성일 순으로 세워 앞 배치까지 남은 과제 누적 ÷ 팀 처리량(그 주와 전주 완료 과제 ÷ 14)이 마감까지 남은 일수보다 크면 위험, 마감이 지났으면 위험. 줄과 처리량은 부서 필터 전 전체로 본다(평가자는 같은 대기열을 처리) | 개 |
| 정답셋 정확도 · 일치율 · 재작업률 | Σ gold_correct ÷ Σ gold_labels · Σ agree_pairs ÷ Σ label_pairs · Σ rework_labels ÷ Σ labels | 건 · 쌍 |
| 일치도 카파 | (Po − Pe) ÷ (1 − Pe), Po = 일치율, Pe = Σ(등급별 최종 라벨 ÷ 최종 라벨)² | — |
| 기준 미달 평가자 | 그 주 정답셋 라벨 10건 이상이고 정확도 80% 미만인 평가자 수 | 명 |
| 증감 (평가 운영) | 전주 대비. 비율은 %p, 라벨·과제는 %, 평가자·배치 수와 카파는 차이 값. 전주 데이터가 없으면 `전기 없음` | — |

## 4. 데이터 계약 (`dashboard/public/data/`)

**파일 분할과 로딩.** 첫 화면에 필요한 표만 `index.json` 에 담고, 큰 표는 화면이 필요할 때 받는다.

| 파일 | 내용 | 받는 시점 |
|---|---|---|
| `index.json` (고정 이름) | `meta` + `files` + `daily_metrics, daily_ad, funnel_daily, weekly_cohort, monthly_cohort, weekly_activity, monthly_summary, weekly_audience_funnel, daily_revenue, daily_subscription, daily_venue_registry, venue_registry, monthly_contract, contract_cohort, subscription_cohort, weekly_eval_ops, weekly_rater, weekly_batch` | 첫 요청 |
| `hourly_metrics.<해시>.json` | 행 배열 | 1일 보기(개요·행사·회원), 퍼널 탭 시간대 히트맵 |
| `daily_channel.<해시>.json` | 행 배열 | 유입·광고 탭 채널 보기 |
| `daily_venue.<해시>.json` | 행 배열 | 개요 상단 공간 수, 행사·결제 탭 공간별 보기 |
| `daily_event.<해시>.json` | 행 배열 | 행사·결제 탭 행사별 보기(유형 선택 옵션도 이 표에서, 도착 전엔 `전체`만) |
| `weekly_path.<해시>.json` | 행 배열 | 퍼널 탭 경로 탐색 |
| `daily_search.<해시>.json` | 행 배열 | 검색 탭, 주간 브리핑 |
| `daily_query.<해시>.json` | 행 배열 | 검색 탭 검색어 표 |
| `person_day.<해시>.pdz`(gzip) 또는 `person_day.<해시>.bin` + `person_day.meta.<해시>.json` | 사람×일 행동 비트(아래) | 사람 단위 지표가 있는 탭(개요·퍼널·행사 흐름·회원) |

- `files` = `{표 이름: 파일 이름}`(`person_day` 는 `.bin`, `person_day_gz` 는 같은 바이너리의 gzip -9 `.pdz`, `person_day_meta` 는 메타 JSON). 로더는 `DecompressionStream('gzip')` 이 있으면 `.pdz` 를 받아 풀고, 없으면 `.bin` 을 받는다. 받은 본문이 gzip 머리(`1f 8b`)로 시작하지 않으면(서버가 `Content-Encoding` 으로 이미 풀어 보냈으면) 그대로 쓴다. 확장자를 `.gz` 로 두지 않는 이유: 정적 서버 일부(vite preview 의 sirv 등)가 `.gz` 를 `Content-Encoding: gzip` 으로 내보내 브라우저가 먼저 풀어 버린다. 이름의 8자리는 내용 SHA-256 앞자리라 내용이 바뀌면 이름이 바뀐다(캐시 무효화). `files` 에 없는 표는 추출되지 않은 것으로 본다.
- 화면은 `index.json` 도착 후 스코어보드를 그리고, 지연 표에 의존하는 타일·카드는 받는 동안 값 자리에 회색 바. 실패하면 0.5초·1.5초 뒤 두 번 더 받아 보고, 그래도 실패하면 `불러오지 못함` 과 `다시 시도` 버튼(누르면 실패한 표 전부를 다시 받는다). 같은 파일은 한 번만 받아 메모리에 둔다.
- 기준 크기(2026-09-24 추출, 사람 210,000명·52주): `index.json` 8.2MB(gzip 0.44MB), `person_day.bin` 5.1MB(`.pdz` 2.5MB — 전송은 `.pdz` 쪽), 지연 JSON 5개 합 71.0MB(gzip 4.0MB).

**표 열.** 아래 키 = 마트 이름, 값 = 행 배열(`index.json` 의 키 또는 지연 JSON 파일 전체). 열 이름은 `docs/architecture.md` §2 마트 열과 같다. 날짜는 `YYYY-MM-DD`(KST), 월은 `YYYY-MM`, 금액은 정수 원.

| 키 | 열 |
|---|---|
| `meta` | `to_date, from_date, built_at, source(sample/bigquery), tables{name: rows}` |
| `daily_metrics` | `kst_date, channel1, device_platform, member_seg, persons, new_persons, sessions, engaged_sessions, explorers, detail_viewers, signups, apply_viewers, applies, payers, pay_count, pay_amount, cancels, subscribers, sub_payers` |
| `hourly_metrics` | `kst_date, kst_hour, channel1, device_platform, member_seg, persons, sessions, applies, pay_count` |
| `daily_channel` | `kst_date, channel1, channel2, channel3, device_platform, member_seg, sessions, persons, new_persons, signups, applies, payers, pay_amount` |
| `daily_ad` | `kst_date, campaign_id, campaign_name, spend, impressions, clicks, sessions, persons, active_persons, signups, applies, payers, pay_amount` |
| `daily_event` | `kst_date, event_id, event_name, venue_name, event_type, price_tier, detail_viewers, applies, pay_count, pay_amount, cancels` |
| `daily_venue` | `kst_date, venue_id, venue_name, region, genre, detail_viewers, applies, pay_count` |
| `funnel_daily` | `kst_date, step(landing/detail/signup/apply_view/payment), channel1, device_platform, member_seg, persons` |
| `weekly_cohort` | `cohort_week, week_offset(0..12), channel1, device_platform, member_seg, cohort_size, retained` |
| `monthly_cohort` | `cohort_month, month_offset(0..6), member_seg, cohort_size, retained` |
| `weekly_activity` | `week_start, channel1, device_platform, member_seg, wau, new_persons, returning_persons, two_plus_days` |
| `weekly_audience_funnel` | `week_start, audience_id(new/returning/paid_inflow/past_payer/apply_no_pay/explorer_only), step(landing/detail/signup/apply_view/payment), channel1, device_platform, member_seg, persons` |
| `weekly_path` | `week_start, channel1, device_platform, member_seg, step(1..4, 정수), from_screen, to_screen, sessions` |
| `monthly_summary` | `month, persons, new_persons, signups, applies, pay_count, pay_amount, cancels, w1_retention, top_channel, gmv_amount, fee_amount, membership_amount, partner_plan_amount, platform_revenue, ad_spend, active_subscribers_eom, partner_total_eom, registered_total_eom` — `platform_revenue` = 수수료 + 멤버십 + 파트너 플랜(`daily_revenue.net_amount` 월 합), `gmv_amount` 은 매출이 아니다, `ad_spend` 는 집행일 기준 |
| `daily_revenue` | `kst_date, kind(ticket/membership/partner_plan), fee_tier(none/basic/pro, ticket 만·나머지 null), pay_count, gmv_amount(ticket 만·나머지 null), paid_amount, discount_amount, refund_count, refund_amount, net_amount, payers` — `net_amount` = 플랫폼 매출(ticket 수수료 = 정가 × 등급 율·환불 주문 0, membership 실결제, partner_plan 그날 요금 ÷ 그 달 일수), 전 kind 합 = 플랫폼 매출. ticket 의 `gmv_amount`(정가)·`paid_amount`(실결제)·`discount_amount` 는 환불 주문 제외라 `gmv − discount = paid`, `pay_count` 는 환불 포함(환불 제외 건수 = `pay_count − refund_count`). 결제일 기준. `payers` 는 회원 수(partner_plan 은 공간 수, `pay_count` 는 활성 계약 수) |
| `daily_subscription` | `kst_date, active_subscribers, new_subscribers, churned_subscribers, mrr, subscriber_ticket_payers, subscriber_ticket_amount, discount_amount` — 첫 구독일 ~ 기준일 모든 날, 이탈률 = 기간 churned ÷ 기간 시작일 active, `discount_amount` = 그날 멤버 할인 합(환불 주문 제외, `daily_revenue` ticket 할인 일 합과 같다) |
| `daily_venue_registry` | `kst_date, region, registered_total, partner_total, new_registered, new_contracts, churned_contracts, mrr_basic, mrr_pro` — 모든 날 × 모든 상권, 전체 = 상권 합, `*_total` 은 그날 값(기간 합산 금지), `mrr_*` 는 그날 요금제·요금(변경 반영) |
| `monthly_contract` | `month, plan(basic/pro/all), contracts_bom, new_contracts, churned_contracts, upgrades, downgrades, contracts_eom, mrr_bom, mrr_new, mrr_expansion, mrr_contraction, mrr_churn, mrr_eom, arpa` — 첫 계약 월 ~ 기준월, 월초 = 전월 마지막 날, 월말 = 그 달 마지막 날(기준월은 기준일). 다리: `mrr_eom = mrr_bom + mrr_new + mrr_expansion − mrr_contraction − mrr_churn`, all 행은 `contracts_eom = contracts_bom + new − churned` 도 성립. GRR·NRR·매출 해지율·계약 월 해지율은 all 행으로 계산. 요금제 행의 expansion·contraction 은 그 요금제로 옮겨 온·빠져나간 요금, upgrades·downgrades 는 그 요금제가 한쪽인 변경 건수. `arpa` = `mrr_eom ÷ contracts_eom`(원, 계약 0 이면 null) |
| `contract_cohort` | `cohort_month, month_offset(0..12), cohort_size, retained, mrr_retained` — 계약 시작 월 코호트, n개월 = 시작일 + n개월에 활성. 0개월 `retained = cohort_size`, `mrr_retained` 는 그날 요금 합(업그레이드로 0개월 값을 넘을 수 있다). 코호트 전원이 관측된 칸만 행이 있다 |
| `subscription_cohort` | `cohort_month, month_offset(0..9), cohort_size, retained` — 구독 시작 월 코호트(구독 건), n개월 = 시작일 + n개월에 활성. 0개월 `retained = cohort_size`, 전원 관측된 칸만 행이 있다 |
| `venue_registry` | `venue_id, name, region, district, lat, lng, genre, venue_type, capacity_band, registered_at, is_partner(bool), plan, contract_started_at, contract_ended_at, events_365d, ticket_amount_365d, detail_viewers_28d, status, as_of_date` — 기준일 고정(기간·세그먼트 필터 없음), 날짜 열은 `YYYY-MM-DD` |
| `daily_search` | `kst_date, query_intent(genre/region/event_type/venue_name), ranker_version(v1/v2), channel1, device_platform, member_seg, searches, zero_result_searches, ga_matched_searches, matched_result_searches, clicked_searches, first_click_position_sum, first_click_position_sq_sum, top3_clicks, reformulated_searches, search_sessions, search_sessions_applied` |
| `daily_query` | `kst_date, query_norm, channel1, device_platform, member_seg, query_intent, searches, zero_result_searches, ga_matched_searches, clicked_searches, reformulated_searches, eval_dates` — 검색어 속성(모든 행에 같은 값, `YYYY-MM-DD` 쉼표 구분 오름차순). 마트의 `first_eval_date`·`first_failed_eval_date`·`failed_eval_dates`(실패 출처만) 는 추출하지 않는다 |
| `weekly_eval_ops` | `week_start, requester(search/promotion), rater_group(internal/vendor), guideline_version(v1/v2), labels, rework_labels, handle_seconds, gold_labels, gold_correct, final_labels, label_pairs, agree_pairs, labels_g0..labels_g3, tasks_completed` |
| `weekly_rater` | `week_start, rater_id, requester, rater_group, labels, rework_labels, handle_seconds, gold_labels, gold_correct, label_pairs, agree_pairs` |
| `weekly_batch` | `week_start, batch_id, requester, purpose(train/eval/adhoc), guideline_version, priority, created_date, due_date, as_of_date, target_tasks, done_tasks, done_in_week, remaining_tasks, recent_done_14d, days_to_due` — 주말 시점 누적 |
| `person_day` | 바이너리 `person_day.<해시>.bin`(전송용 gzip 사본 `.pdz`): 행당 8바이트, 리틀엔디언 Uint32 2개. word0 = `pk`(비트 0–19) \| `d`(20–28) \| `c`(29) \| `p`(30–31), word1 = `m`(0) \| `f`(1–16), 나머지 비트 0. 행은 날짜·사람 키 순. 메타 `person_day.meta.<해시>.json` = `{base_date, codes, rows, row_bytes, layout}`. 날짜 = `base_date` + `d`일, `pk` 는 익명 사람 키(적재마다 재부여), `c`·`p`·`m` 은 `codes` 인덱스 — `codes = {c: [non_paid, paid], p: [android, ios, web], m: [guest, member]}`(적재 데이터의 고유값 정렬, 값이 늘면 인덱스가 바뀐다). `f` 는 비트 플래그(`src/lib/persons.ts` 의 `F`, 비트 정의는 `bigquery/sql/marts/person_day.sql` 머리 주석). 플래그가 없는 날은 행이 없다. 폭을 넘는 값이 나오면 `extract.py` 가 중단한다(`PD_BITS` 를 늘리고 `persons.ts` 를 같이 고친다). `meta.tables.person_day` 는 행 수 |

**사람 단위 수의 세그먼트 귀속.** `person_day` 로 세는 고유 사람 수(`persons.ts` `uniquePersons`)는 사람마다 기간 안에서 해당 행동이 있었던 마지막 날의 세그먼트 값 하나로 귀속한다. 세그먼트 필터와 분해(회원/비회원·채널·플랫폼)가 모두 이 값을 쓰므로 값별 수의 합이 전체와 같다. 기간 중 가입한 사람은 회원으로 센다. 채널1·플랫폼은 사람 속성이라 날마다 같다. 전기는 전기 안의 마지막 날로 따로 귀속하고, 추이 차트의 주·월 버킷은 기간 전체의 마지막 날 기준으로 귀속한다(버킷별로 다시 귀속하지 않는다). 날마다의 값으로 세려면 마지막 인자에 `'day'` 를 넘기는데, 이 경우 한 사람이 양쪽에 모두 세어질 수 있다. 일 마트 `persons` 열의 합은 행 단위라 이 규칙과 다르다.

세그먼트 값: `channel1` ∈ {paid, non_paid}, `device_platform` ∈ {ios, android, web}, `member_seg` ∈ {member, guest}. 세그먼트 속성은 행마다 1개라 조합의 합이 전체다. `channel2` 는 `staging.map_channel` 의 2단계 값(direct·organic_search·organic_social·influencer·paid_social·referral·ai_referral·other), `top_channel` 도 같은 값을 쓴다. `price_tier` ∈ {free, standard, premium, package}.

**`docs/architecture.md` 와 다른 점**: `hourly_metrics` 에 세그먼트 축 3개가 있다. 시간대 히트맵과 1일 시간별 차트가 세그먼트 필터를 받아야 하므로 마트에 축을 추가한다.

`weekly_audience_funnel` 의 오디언스는 서로 겹치므로 오디언스끼리 더하지 않는다(`new` + `returning` 만 그 주 방문 사람 전체). `weekly_path` 의 `step = n` 은 n번째 화면 → n+1번째 화면 전이이고, `to_screen` 은 화면 이름 12개와 `(이탈)`·`(기타)` 중 하나다. 같은 주·세그먼트에서 `step = 1` 의 세션 합이 방문 세션 수다.

두 주간 마트의 원본 SQL(`bigquery/sql/marts/weekly_audience_funnel.sql`·`weekly_path.sql`)에 있는 보조 열 `step_order`(1~5)는 추출하지 않는다 — 화면은 `step` 이름으로 순서를 정한다. `weekly_path.step` 만 정수이고 나머지 표의 `step` 은 문자열이다.

`weekly_cohort.cohort_size` 는 경과 주와 무관하게 같은 값이 반복되며, 화면은 `week_offset = 0` 행의 값을 코호트 크기로 쓴다(월 코호트도 같다).

## 5. 헤더와 페이지

화면은 대시보드·보고서(`?page=reports`, 상세 `&r=<id>`)·프로젝트 개요(`?page=about`)·지표 가이드(`?page=metrics`)·데이터(`?page=data`) 다섯 페이지다. 대시보드는 '지금 어떤가'를 보는 모니터링, 보고서는 '무엇을 바꿨고 결과가 어땠나'를 한 건씩 읽는 곳이다. 페이지 키는 대시보드 상태와 같은 URL 쿼리에 있어, 오가도 탭·기간·필터·선택한 표가 유지되고 브라우저 뒤로 가기가 동작한다. 링크는 실제 `href` 를 가져 새 탭으로도 열린다.

**헤더** — 왼쪽: 로고(대시보드로) + 페이지 이동 다섯 항목(`대시보드`·`보고서`·`프로젝트 개요`·`지표 가이드`·`데이터`), 현재 페이지를 강조한다. 폭 640px 미만에서는 `개요`·`지표` 로 줄여 쓴다. 오른쪽: 기준일(`meta.to_date`) · 저톤 밑줄 문장 `가상 서비스 시나리오로 생성한 데이터`(개요 페이지 데이터 설명 절 `#data-note` 로 이동) · 테마 토글. 폭 640px 미만은 두 줄(1줄 로고·페이지 이동, 2줄 기준일·문장·테마)로 접고 로고의 `KPI` 를 숨긴다.

**프로젝트 개요** — 대시보드 안에 설명 문장을 넣지 않기 위한 자리.

1. 한 문장 요약(도심 공간·이벤트 플랫폼) + 데이터 설명 절(`#data-note`, 저톤 문단): 시나리오·분포 규칙으로 생성한 합성 데이터, 방문자 210,000명·회원 약 22,000명·52주·이벤트 약 960만 건 규모. 그 아래 세 묶음 카드 — 비즈니스 시나리오(→ 02절) · 모니터링 대시보드(→ 대시보드) · 보고서(건마다 한 줄 결론 → 보고서 목록)
2. 프로덕트: 도심 공간(카페·바·라운지·라이브홀·루프탑·팝업)과 이벤트 탐색 → 신청 → 결제, 회원·비회원, 앱·웹, 광고 유입. 두 번째 단락은 공간 두 층(등록 1,800곳, 파트너 플랜 베이직 4.9만·프로 14.9만 원 약 10%)과 멤버십(월 9,900원, 파트너 공간 이벤트 15% 할인)
3. 비즈니스 모델: 한 줄(플랫폼 매출 세 갈래, 거래액은 규모 지표) → 인라인 SVG 돈의 흐름(소비자 → 티켓 결제·멤버십 → Placewave → 정산 → 공간 사업자, 공간 사업자 → 파트너 플랜, 멤버 할인은 점선. 색 = 수익 축, 개요 매출 구성 카드와 같은 색). 폭 768px 미만은 세로 도식 → 축 카드 3장(거래 수수료·멤버십·파트너 플랜: 산식 한 줄 + 핵심 지표 3개)
4. 핵심 퍼널 5화면 와이어프레임(홈·지도 → 행사 상세 → 로그인·가입 → 신청 화면 → 결제 완료)과 화면별 이벤트 이름
5. 보고서: 보고서 카드 3장(묶음·코드·제목·한 줄 결론·기간) → 상세
6. 데이터 흐름 도식(행동 로그·서비스 DB·광고 리포트 → raw → staging → marts, ops → JSON 추출 → 정적 웹). 폭 768px 미만은 세로 도식. 서비스 DB 상자는 `공간·계약·구독·결제` 원장
7. 문서 카드 6개: 데이터 페이지 · 지표 가이드(둘 다 내부 이동) · SQL 카탈로그(`bigquery/README.md`) · 데이터 아키텍처 · 대시보드 설계 · 저장소

**보고서** — 실험·개선·이슈를 한 건씩 같은 틀로 읽는 페이지. 목록 정보는 `src/reports/registry.ts`(id·코드·묶음·제목·기간·원천·대조군 유무·한 줄 결론)이고, 한 줄 결론과 서술 문장의 숫자는 수치 근거 값이다. 표·차트는 대시보드와 같은 마트 파일을 받아 같은 함수(`src/lib/experiments.ts`, 평가 운영 지표는 `tabs/EvalOps.tsx` 의 함수)로 화면이 계산한다.

| id | 코드 · 묶음 | 원천 | 비고 |
|---|---|---|---|
| `ab-ranker-v2` | E1 · 실험 | `daily_search` | 대조군(기존 랭킹 v1) · 실험군(새 랭킹 v2), 기기 단위 무작위 50:50. 기간 = 두 버전이 각각 그날 검색의 10% 이상인 날. 결과 클릭률은 0건 개선 · 검색당 클릭 차이 없음과 함께 나타나면 `분모 효과`, 검색 세션 신청 전환은 `판정 제외` |
| `guide-v2` | X1 · 개선 | `weekly_eval_ops` | 평가 지침 개정 전(v1) · 후(v2), 마지막 완료 주까지 누적 + 주별 품질·처리 시간. 대조군이 없어 `전후 비교(인과 아님)` |
| `issue-reindex-0901` | I1 · 이슈 | `daily_search` · `daily_query` · `weekly_batch` | 회귀 전(8/29~8/31) · 중(9/1~9/4) · 핫픽스 후(9/5~9/8) 결과 0건 비율(전체·상권·상권 외), 회귀 주 실패 검색어, 9/7 주 배치 진척·마감 위험. `전후 비교(인과 아님)` |

- 한 건의 칸 순서: 한 줄 결론 → 배경·질문 → 무엇을 바꿨나(이슈는 무엇이 바뀌었나) → 설계(주·보조·가드레일 구분은 2026-10-19 사후 정리라고 표기) → 결과 → 해석 → 한계 → 예상 질문(접이식) → 데이터셋 구성(경로·그레인·지표별 분자·분모 열·기간 규칙·기간 내 마트 행 수·재현 SQL `bigquery/reports/*.sql` 링크·기간 내 집계 표 + CSV 내려받기) → 대시보드에서 보기(딥링크)
- 옛 주소 `?tab=search&view=ranker`(검색 탭 랭킹 실험 보기)는 `?page=reports&r=ab-ranker-v2` 로 넘긴다
- 대조: `npm run check:reports` 가 보고서 표를 마트 파일에서 따로 계산한 값과 비교해 어긋나면 exit 1(빌드 결과를 preview 로 띄운 뒤). BigQuery 재집계 대조는 `docs/reconciliation_dashboard.md` §9

**지표 가이드** — 원본 `public/metrics.json`(`rules`·`groups`·`axes[]{id, name}`·`notes`·`tabs[]{id, name, question, users[], key_metrics[]}`·`metrics[]{id, name, tab, group, axis, definition, formula, unit, denominator, mart_columns[], why}`). 축은 `platform`(공통 — 플랫폼 매출 전체)·`marketplace`·`subscription`·`b2b`. `docs/metrics.md` 는 이 JSON 에서 `dashboard/scripts/build_metrics_doc.py` 로 생성한다(직접 수정 금지, `--check` 로 불일치 확인).

- 탭별 질문 표: 탭 · 답하는 질문 · 주 사용자 · 핵심 지표 3개(누르면 아래 지표 표가 그 코드로 검색된다).
- 지표 표: 수익 축 선택(전체 축·공통·마켓플레이스·구독·B2B, 개수 병기) → 탭 칩(전체 + 탭별 개수, 선택한 축 안의 개수) · 검색(이름·코드·정의·산식·마트 열) → 행 = 이름·코드·탭 / 정의·의의 / 산식·분모 / 단위 / 마트 열. 폭 1024px 미만은 행 안에서 세로로 쌓는다.
- 타일·카드 이름 옆 `?`(`metricId` prop): 같은 JSON 의 이름·정의·산식·분모·단위를 팝오버로 띄운다. 바깥 클릭·Esc·스크롤로 닫힌다. JSON 이 없거나 id 가 없으면 `?` 를 그리지 않는다.

**데이터** — `public/catalog.json`(계약은 `docs/backlog.md` §6, 생성기 `bigquery/build_catalog.py --export`) + `public/data/`.

- 왼쪽: 층별 접이식 표 목록(표 이름 + 1행 그레인). 폭 1024px 미만은 상단 선택기(층별 그룹)로 바뀐다.
- 오른쪽: 선택 표 헤더(`층.표`, SQL 파일 GitHub 링크, 1행·키·파티션·클러스터·행 수·크기·원천·소비·검사) → 컬럼 표(이름·타입·설명, 폰 폭에서는 타입이 이름 아래로) → 미리보기(marts 만, 같은 이름 표의 첫 20행. 지연 표는 그 표를 고를 때 받는다. `person_day` 는 바이너리라 미리보기 없음). 미리보기 열 순서는 카탈로그 컬럼 순서이며, 추출되지 않은 컬럼(`step_order` 등)은 빠지고 카탈로그에 없는 추출 열은 뒤에 붙는다. 숫자는 오른쪽 정렬·고정폭, 가로 스크롤.
- 선택은 `table=<층.표>`. 없거나 모르는 값이면 `marts.daily_metrics`(없으면 첫 표).
- `catalog.json` 이 없거나 표가 0개면 `카탈로그 없음` 한 줄.

## 6. 캡처

`npm run build && npm run capture -- --all` 이 `dashboard/captures/` 에 탭별 라이트 화면과 보기 전환·1일·1년·세그먼트 조합·드릴다운 카드·데이터 없음·개요 추이 카드(90일·1년·7일+필터·툴팁 hover 좌/우/일/시간/다크/폰·주 버킷 클릭 드릴다운)·다크·폰 폭(390px)·개요 페이지·데이터 페이지(라이트·다크·폰·카탈로그 없음)·헤더(폰·태블릿 폭)를 저장한다. `catalog.json` 이 아직 없으면 `NP_CATALOG=<파일>` 로 다른 파일을 대신 물려 찍는다. README 대표 이미지는 `docs/img/` 에 최적화해 복사한다.
