# Operations

## 수정·배포 절차

1. 새 브랜치 생성
2. 코드 수정
3. `npm test`
4. `npm run check`
5. PR 생성
6. GitHub Actions `verify` 통과
7. Vercel Preview 성공 확인
8. `main` 병합
9. Vercel Production 자동배포
10. GitHub Actions `production-smoke` 통과

ZIP 직접 배포는 사용하지 않습니다.

## 자동 검증

### verify

- 단위 테스트
- 전체 서버 JS syntax check

### production-smoke

`https://etf-night-watch.vercel.app/api/estimate`를 실제 호출해 다음을 검사합니다.

- HTTP 200
- `version === "1.5.0-stable"`
- ETF 7개 응답
- 최소 5개 이상 `dataOk`
- `krxCloseDate` 존재
- `requestedSymbols <= 16`

## 수동 점검 엔드포인트

- 운영 화면: `/`
- 추정 API: `/api/estimate`
- 진단 API: `/api/diagnostics`

## 응답에서 먼저 볼 값

- `version`
- `krxCloseDate`
- `krxConsensus`
- `sourceSummary`
- `fx.fallback`
- ETF별 `dataOk`
- ETF별 `quality / qualityLabel`
- ETF별 `sourceAt / sourceAgeSec / mode`
- ETF별 `calibrationScale / rawExpectedMovePct`
- basket ETF의 `coverage`

## 장애 대응

### 전체 API 503

1. `/api/diagnostics` 확인
2. Naver `dailyErrors` 확인
3. Yahoo `chartErrors` 확인
4. 최근 GitHub Production smoke 로그 확인

### 일부 ETF만 미수신

해당 ETF의 `primary`, `future`, `backupFuture` 심볼과 `latestBySymbol`을 확인합니다.

### 값이 오래됨

`sourceAgeSec`와 `session.code`를 함께 봅니다.

- 주말/장외 + 오래된 값: 정상적인 마지막 마감값일 수 있음
- PRE/REG/POST + 과도하게 오래된 값: 데이터 지연 가능성

### 환율미반영

`fx.fallback === true`면 `KRW=X` 조회 실패 상태입니다. 추정가는 기초자산 변화만 반영하고 환율 변화는 0%로 가정합니다.

## 정확도 점검

모델 또는 구성종목을 바꿀 때는 최소 최근 20거래일을 대상으로 08:50 KST 예상가와 실제 KRX 시초가를 비교합니다.

- 앞 14거래일: 후보 선택·보정계수 산출
- 뒤 6거래일: 미사용 검증 구간
- 전일 종가 그대로를 기준선으로 함께 비교
- 검증구간 MAE가 악화되면 보정계수나 프록시를 Production에 반영하지 않음
- 분석용 임시 workflow/스크립트는 운영 `main`에 병합하지 않음

## 롤백

- 복구 기준 브랜치: `baseline-v1.3.0`
- 운영 장애 시 마지막 정상 Production 커밋 또는 baseline으로 롤백
- 운영 파일을 Vercel에서 직접 수정하지 않음
