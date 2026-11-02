# 주행중GO!

차로 가는 길에, 평소 관심 둔 중고 매물이 경로 근처에 있으면 알려 주고 경유지로 들러 바로 사 오게 하는 Pleos Connect 앱.
구매자는 차 안에서(내비 화면), 판매자는 폰 웹에서 쓴다.

- 기획: `docs/01_기획서.md`, 결정과 공모전 정보: `docs/00_가이드.md`
- 기능별 구현 위치: `docs/TASKS.md`, 현재 상태: `docs/STATUS.md`
- Pleos SDK 사용 현황: `docs/API_MATRIX.md`, 차량 앱 브리지: `docs/BRIDGE.md`

## 구성

```
packages/core      매칭·경로·적재·에너지·알림 타이밍·개인화·거래 상태 머신 (UI 없음, 테스트)
services/api       서버(Hono) — Node에서는 SQLite, 브라우저에서는 메모리 저장소로 같은 코드가 돈다
apps/seller-web    판매자 폰 웹
apps/car-web       차량 화면(내비) + 브라우저 시뮬레이터·가상 콘솔 + Pleos SDK 포트
apps/car-android   차량 앱 셸(WebView + Pleos SDK 브리지, Kotlin)
apps/demo          체험 페이지(두 앱 + 페이지 안 서버, 한 파일)
tools              E2E·브리지 계약 시험
```

## 실행 (Node 22 이상)

```bash
npm install
npm run build:web      # 판매자 웹·차량 화면 빌드
npm start              # http://localhost:8787
```

- 차량 화면: http://localhost:8787/car/ — 오른쪽 가상 콘솔로 기어·배속·좌석·방향지시등·배터리·트렁크를 바꾼다
- 판매자 폰: http://localhost:8787/seller/ — 폰으로는 같은 와이파이에서 서버가 찍어 주는 `http://<PC IP>:8787/seller/`
- 에뮬레이터 안 차량 앱에서는 PC가 `http://10.0.2.2:8787`
- 시연 시계는 2026-11-06(금) 18:05에서 시작한다. 콘솔의 '시연 처음으로'가 데이터와 시계를 처음으로 돌린다.
- 서버 없이: `/car/?local`(차량만, 페이지 안 서버) 또는 체험 페이지(`npm run build -w apps/demo` → `apps/demo/dist/index.html`)

시연 순서(약 3분): 차 화면 '목적지' → 송파 집(브리핑) → 콘솔 '2열 착석'·10×·D 주행 → 영통 캠핑의자 알림 → 분당 카시트·유모차 경합 → 카시트 '들를게요' → 판매자 폰 '수락' → 경유지 도착 → 트렁크 열고 닫기 → 판매자 '건넸어요' → 차 '받았어요' → D 주행 → 결과 카드.

## 확인

```bash
npm test               # 단위·API 테스트
npm run typecheck
npm run e2e            # 판매자 폰 + 차량 화면 끝까지(스크린샷: tools/out/)
npm run e2e:bridge     # 차량 화면이 실제 SDK 모드(브리지)로 끝까지 도는지
```

## 차량 앱(Android)

`apps/car-android/README.md`. Pleos Connect 에뮬레이터에서 PC 서버의 차량 화면을 띄우고 실제 NaviHelper·Vehicle SDK를 부른다.
