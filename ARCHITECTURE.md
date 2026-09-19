# Architecture

## 데이터 흐름

```text
index.html
  -> GET /api/estimate
      -> api/engine.js
          -> api/market.js
              -> Naver: 국내 ETF 최근 일별 가격
              -> Yahoo: 미국 ETF/선물/환율 5분봉
          -> api/core.js
              -> KRX 기준일 합의
              -> 자산별 변화율 계산
              -> 상태/신선도 판정
  <- 추정가 + 데이터 상태 JSON

/api/diagnostics
  -> 같은 엔진 + 심볼별 마지막 timestamp / 오류 / cache 상태
```

## KRX 기준일

7개 ETF의 Naver 일별 데이터에서 각각 최근 확정 거래일을 구한 뒤 다수결로 기준일을 선택합니다.

- 15:35 KST 이전: 오늘보다 이전의 최신 거래일
- 15:35 KST 이후: 오늘 포함 최신 확정 거래일
- 기준 시각: 해당 거래일 15:30 KST

특정 ETF 하나의 응답 이상이 전체 기준일을 결정하지 않도록 변경했습니다.

## 계산 모델

### future

국내 ETF 종가 이후 선물 변화 × 원/달러 변화를 적용합니다.

- ACE 미국S&P500 → `ES=F`

### equity

미국 ETF의 직전 정규장 종가 대비 움직임에서 KRX 종가 시점까지 이미 반영됐을 선물 움직임을 제거합니다. 미국 ETF 시세가 오래됐고 선물이 더 최신이면 선물 continuation을 적용합니다.

- 필라델피아반도체 → `SOXQ` + `NQ=F`

### proxy

정적 구성종목 10개를 매번 조회하지 않고 대표 ETF + 선물 조합을 사용합니다.

- 미국테크TOP10 계열 → `QQQ` + `NQ=F`
- AI전력핵심인프라 → `BE / GEV / VRT / FIX / PWR / CCJ` 가중 basket + `NQ=F` (coverage 70% 미만이면 `PAVE` fallback)
- 미국우주테크 → `ARKX` + `NQ=F` (fallback: `RTY=F`)

v1.5부터 정확도 개선을 위해 AI전력 basket 심볼을 다시 추가해 Yahoo 요청 심볼이 최대 15개입니다. 그래도 v1.3의 약 39개보다는 크게 적습니다.

### timed

거의 연속적으로 거래되는 자산의 기준시점 대비 변화를 직접 사용합니다.

- KRX금현물 → `GC=F`

## 백테스트 기반 보정

2026-08-24~2026-09-18의 최근 20거래일 중 앞 14일을 보정계수 산출 구간, 뒤 6일을 검증 구간으로 분리했습니다.

- 필라델피아반도체: 전체 예상 변동폭 × `0.75`
- AI전력핵심인프라: 상위 6종목 basket + NQ, 전체 예상 변동폭 × `0.80`
- KRX금현물: 전체 예상 변동폭 × `0.80`
- 미국우주테크: ARKX의 보정선물을 RTY에서 NQ로 변경. 별도 1.5배 보정은 검증 개선폭 대비 과적합 위험 때문에 적용하지 않음.

보정은 `1 + (rawFactor - 1) × moveScale` 형태로 환율까지 반영한 전체 예상 변동폭에 적용합니다. 응답에는 `rawExpectedMovePct`, `calibrationScale`, basket일 경우 `coverage`를 노출합니다.

## 공통 as-of 계산

v1.6부터 모든 종목을 "지금"에 억지로 맞추지 않고 **공통 기준시각(as-of)** 으로 계산합니다.

- 기본 안전지연: 10분
- 먼저 `현재시각 - 10분`을 상한으로 설정
- `KRW=X / ES=F / NQ=F / GC=F`의 해당 시각 이전 최신 5분봉 중 가장 오래된 시각을 공통 as-of로 선택
- 모든 ETF와 환율 계산은 그 공통 시각까지만 사용
- 미국 ETF/구성종목 체결이 공통 시각보다 한 봉 이상 오래됐으면 선물로 공통 시각까지 continuation
- API에 `snapshot.asOfAt / lagSec / safeLagSec`, ETF별 `asOfAt / asOfLagSec`를 노출

즉 실시간성보다 **동일 시점 데이터로 계산하는 정확성**을 우선합니다.

## 휴장·주말 처리

마지막 시세가 45분 이상 오래됐다는 이유만으로 계산을 폐기하지 않습니다.

- 시장이 닫혀 있으면 마지막 유효 시세로 계산 유지
- `sourceAgeSec`로 데이터 경과 시간 노출
- 상태: `live / delayed / stale / closed / unavailable`
- 미국 공휴일 판정은 별도 거래 캘린더가 아니라 실제 마지막 시세 timestamp를 우선 사용

## 캐시·장애 내성

### 브라우저/CDN

- 프론트의 `?ts=Date.now()` 제거
- `no-store` 제거
- `/api/estimate`: `s-maxage=45, stale-while-revalidate=120`

### 서버 메모리

- Yahoo: 45초 fresh cache, 네트워크 실패 시 최대 24시간 stale cache
- Naver: 5분 fresh cache, 네트워크 실패 시 최대 24시간 stale cache
- Naver timeout: 3.5초
- Yahoo timeout: 4.5초
- Yahoo 동시 조회: 최대 6개

### 환율

`KRW=X`가 일시적으로 없으면 전체 7개 ETF를 실패시키지 않고 환율 변화 0%를 임시 적용하며 `환율미반영` 상태를 표시합니다.

## 진단

`/api/diagnostics`에서 다음을 확인할 수 있습니다.

- 요청 심볼 목록
- 심볼별 마지막 timestamp
- Yahoo/Naver 오류
- cache hit/miss/stale 상태
- KRX 기준일 후보
- 현재 chart range

## 알려진 한계

- Naver/Yahoo 비공식·무계약 API 구조 변경 가능성
- 미국 공휴일/조기폐장을 별도 캘린더로 직접 판정하지 않음
- 프록시 ETF는 실제 국내 ETF 추적지수와 완전히 동일하지 않음
- 추정가는 실제 시초가·LP 호가·괴리율·수급을 예측하지 않음
