# ETF Night Watch

개인 보유 ETF의 한국장 종가를 기준으로, 이후 미국 기초자산·선물·원/달러 움직임을 반영해 참고용 예상가를 계산하는 개인용 웹 앱입니다.

## 현재 기준 버전

- Baseline: `v1.3.0-live`
- 복구 기준일: 2026-09-17 운영 배포본
- 배포 대상: Vercel
- 데이터 저장소: 없음 (서버리스 요청 시 외부 시세 조회)

## 구조

```text
.
├─ index.html          # 단일 페이지 UI
├─ api/
│  ├─ core.js          # 계산/세션/기준가 로직 및 ETF 설정
│  └─ estimate.js      # 외부 시세 조회 + API 응답
├─ test.js             # 핵심 계산 단위 테스트
├─ vercel.json         # Vercel 함수/보안 헤더 설정
├─ ARCHITECTURE.md
├─ OPERATIONS.md
└─ package.json
```

## 로컬 검증

```bash
npm test
npm run check
```

현재 런타임 코드에는 별도 npm 패키지 의존성이 없습니다. `fetch`, `Intl`을 지원하는 최신 Node.js 런타임을 사용합니다.

## 배포 원칙

1. GitHub `main`을 유일한 원본으로 사용합니다.
2. Vercel Production은 GitHub `main`에 연결합니다.
3. 운영 수정은 직접 업로드하지 않고 Git 커밋으로 남깁니다.
4. 큰 계산 로직 변경 전에는 태그를 남깁니다. 예: `v1.3.0-baseline`.
5. 배포 후 `/api/estimate` 응답과 화면을 함께 확인합니다.

## 주의

이 앱의 값은 투자 판단용 공식 가격이 아니라 개인 참고용 추정치입니다. 실제 ETF 가격은 괴리율, LP 호가, 수급, 거래정지/휴장, 시차와 데이터 지연 등의 영향을 받을 수 있습니다.
