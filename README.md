# ETF Night Watch

한국장에 상장된 해외자산 ETF의 최근 확정 종가를 기준으로, 이후 미국 기초자산·선물·원/달러 움직임을 반영해 참고용 추정가를 계산하는 개인용 웹 앱입니다.

## 현재 운영 버전

- Production: `v1.4.0-stable`
- 운영 주소: `https://etf-night-watch.vercel.app`
- Git 원본: GitHub `main`
- 복구 기준점: `baseline-v1.3.0`
- 별도 DB/필수 환경변수 없음

## 구조

```text
.
├─ index.html
├─ api/
│  ├─ core.js          # 순수 계산·시간·상태 판정
│  ├─ market.js        # Naver/Yahoo 조회 + TTL/stale cache
│  ├─ engine.js        # 전체 추정 엔진
│  ├─ estimate.js      # 운영 API
│  └─ diagnostics.js   # 진단 API
├─ test.js
├─ vercel.json
├─ ARCHITECTURE.md
├─ OPERATIONS.md
└─ REVIEW_AND_FIX_PLAN.md
```

## 데이터 소스

- Naver Mobile Stock API: 국내 ETF 일별 가격
- Yahoo Finance Chart API: 미국 ETF·선물·환율 5분봉

현재 Yahoo 요청 심볼은 최대 9개입니다.

`KRW=X`, `ES=F`, `SOXQ`, `NQ=F`, `QQQ`, `PAVE`, `ARKX`, `RTY=F`, `GC=F`

## 로컬 검증

```bash
npm test
npm run check
```

GitHub Actions는 PR/메인에서 위 검사를 자동 실행하며, `main` 배포 뒤에는 Production `/api/estimate`를 직접 호출하는 smoke test도 실행합니다.

## 배포 원칙

1. GitHub `main`을 유일한 원본으로 사용합니다.
2. 수정은 브랜치 → PR → CI → 병합 순서로 진행합니다.
3. Vercel Preview 성공 후 `main`을 Production에 자동배포합니다.
4. ZIP 직접 업로드나 운영 서버 직접 수정은 하지 않습니다.
5. 장애 시 `baseline-v1.3.0` 또는 마지막 정상 커밋으로 롤백합니다.

## 주의

이 앱의 값은 투자 판단용 공식 가격이 아니라 개인 참고용 추정치입니다. 일부 ETF는 QQQ, PAVE, ARKX 같은 대표 프록시와 선물 보정을 사용하므로 실제 ETF의 추적지수·구성종목 변화, 괴리율, LP 호가, 수급 등에 따라 차이가 날 수 있습니다.
