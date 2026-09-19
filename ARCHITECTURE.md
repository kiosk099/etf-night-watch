# Architecture

## 데이터 흐름

```text
브라우저(index.html)
  -> GET /api/estimate
      -> 네이버 모바일 국내주식 API: KRX ETF 최근 종가
      -> Yahoo Finance Chart API: 미국 종목/ETF/선물/환율 5분봉
      -> api/core.js 계산
  <- ETF별 추정가/등락률/품질 상태 JSON
```

## 기준가 선택

`selectKrxReference()`가 한국 시간 기준 최근 확정 종가일을 선택합니다.

- 15:35 KST 이후: 당일 종가 사용 가능
- 15:35 KST 이전: 직전 거래일 종가 사용
- 기준 시각: 해당 거래일 15:30 KST

## 계산 유형

### future
국내 ETF 종가 × 해외 선물 변화 × 원/달러 변화

예: ACE 미국S&P500 → `ES=F`

### equity
미국 ETF/주식의 정규장 종가 이후 변화에 선물을 이용한 앵커 보정을 적용합니다.

예: 필라델피아반도체 → `SOXQ` + `NQ=F`

### basket
ETF 상위 구성종목의 가중 평균 변화를 계산하며 데이터가 비는 경우 대표 프록시를 사용합니다.

### timed
시간대별 거래가 이어지는 자산의 변화를 직접 반영합니다.

예: 금 → `GC=F`

## 외부 의존성

- Naver Mobile Stock API
- Yahoo Finance Chart API
- Vercel Serverless Functions

공식 계약형 데이터 API가 아니므로 응답 구조/접근 제한 변경에 의해 고장날 수 있습니다. 따라서 데이터 공급자별 오류를 화면 값과 분리해서 감시해야 합니다.

## 현재 비밀값

현재 소스 기준 환경변수나 API 키는 없습니다. 향후 유료/공식 시세 API로 교체할 경우 키는 Vercel Environment Variables에만 보관하고 저장소에는 `.env.example`의 변수명만 남깁니다.
