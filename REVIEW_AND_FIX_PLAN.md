# ETF Night Watch — 동작 점검 및 수정 결과

완료일: 2026-09-19  
운영 버전: `v1.4.0-stable`

## 수정 전 핵심 문제

1. 프론트가 `?ts=Date.now()`와 `no-store`로 CDN cache를 무력화함
2. 한 번 계산할 때 Yahoo 심볼을 약 39개 조회해 rate limit·timeout·부분 실패에 취약함
3. 마지막 시세가 45분 이상 오래되면 주말/휴장도 데이터 실패로 처리함
4. `KRW=X` 하나가 실패하면 7개 ETF 전체 계산이 실패함
5. KRX 기준 거래일을 특정 ETF 하나에 의존함
6. 테스트가 일부 순수 계산만 확인하고 실제 Production API는 검증하지 않음

## 적용 완료

- [x] cache-busting query 제거
- [x] 브라우저 `no-store` 제거
- [x] Yahoo 심볼 약 39개 → 9개
- [x] Naver/Yahoo TTL + stale cache
- [x] Naver 3.5초 / Yahoo 4.5초 timeout
- [x] Yahoo 동시성 6으로 제한
- [x] 주말·휴장 마지막 유효 시세 유지
- [x] `sourceAgeSec`와 품질 상태 노출
- [x] KRX 기준일 7개 ETF 다수결
- [x] 환율 실패 시 neutral fallback
- [x] 정적 구성종목 basket 대신 QQQ/PAVE/ARKX 프록시 모델
- [x] `/api/diagnostics` 추가
- [x] 주말/stale/consensus/future-continuation 테스트 추가
- [x] PR CI + Vercel Preview 검증
- [x] Production API smoke test 추가

## 2026-09-19 Production 검증 결과

Production `/api/estimate`를 GitHub Actions runner에서 실제 호출했습니다.

```json
{
  "version": "1.4.0-stable",
  "krxCloseDate": "2026-09-18",
  "usableEtfCount": 7,
  "requestedSymbols": 9,
  "chartFailures": 0,
  "dailyFailures": 0,
  "session": "CLOSED"
}
```

결과: **production smoke success**

## 현재 완료 기준

- [x] GitHub `main`과 Vercel Production 자동연결
- [x] 단위 테스트 통과
- [x] syntax check 통과
- [x] Vercel Preview 성공
- [x] Production deploy 성공
- [x] 운영 API HTTP 200
- [x] 운영 버전 확인
- [x] ETF 7개 모두 계산 가능 확인
- [x] Yahoo 호출량 축소 확인
- [x] Yahoo/Naver 오류 0 확인
- [x] 주말 `CLOSED` 상태에서도 계산 유지 확인

## 남은 비차단 한계

다음은 장애가 아니라 모델 정확도 개선 영역입니다.

- 미국 공휴일/조기폐장 거래 캘린더
- 국내 ETF 실제 지수 구성과 프록시 ETF 사이의 추적 오차
- LP 호가·괴리율·국내 수급 반영
- 장중 실측값과 추정값의 장기 오차 통계

현재 단계에서는 **사이트가 안정적으로 값을 제공하는 문제는 해결**, 이후 작업은 추정 정확도를 개선하는 단계로 구분합니다.
