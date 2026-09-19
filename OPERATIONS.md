# Operations

## 수정 절차

1. 새 브랜치에서 수정
2. `npm test`
3. `npm run check`
4. Preview Deployment에서 `/api/estimate`와 UI 확인
5. `main` 병합
6. Production 자동 배포 확인

## 배포 후 확인

- `/api/estimate` HTTP 200 여부
- `version` 값 확인
- `krxCloseDate`가 의도한 최근 확정 거래일인지 확인
- `session.code`가 현재 미국 세션과 맞는지 확인
- 7개 ETF 중 `dataOk` 성공 개수 확인
- `marketClose`가 실제 국내 종가와 일치하는지 표본 2개 이상 확인
- 미국 프리/정규/애프터마켓 시 각각 값이 갱신되는지 확인

## 장애 대응

### 가격이 오래됨
`krxCloseDate`, Yahoo chart 마지막 timestamp, `chartErrors`를 먼저 확인합니다.

### 일부 ETF만 실패
해당 ETF의 `CFG` 종목 심볼과 Yahoo Finance 제공 여부를 확인합니다.

### 전체 API 실패
Naver/Yahoo 응답 상태와 Vercel Function 로그를 확인합니다.

## 롤백

운영 장애 시 마지막 정상 태그/커밋으로 Vercel Production을 재배포합니다. 운영 서버에서 직접 파일을 고쳐 복구하지 않습니다.
