# 주행중GO!

차로 가는 길에, 평소 관심 둔 중고 매물이 경로 근처에 있으면 알려 주고 경유지로 들러 바로 사 오게 하는 Pleos Connect 앱.
구매자는 차 안에서(내비 화면), 판매자는 폰 웹에서 쓴다.

- 기획: `docs/01_기획서.md`, 결정과 공모전 정보: `docs/00_가이드.md`
- 기능별 구현 위치: `docs/TASKS.md`, 기획서 문장별 대조: `docs/SPEC_CHECK.md`, 현재 상태: `docs/STATUS.md`
- Pleos SDK 사용 현황: `docs/API_MATRIX.md`, 차량 앱 브리지: `docs/BRIDGE.md`

## 구성

```
packages/core      매칭·경로·적재·에너지·알림 타이밍·개인화·거래 상태 머신 (UI 없음, 테스트)
services/api       서버(Hono) — Node에서는 SQLite, 브라우저에서는 메모리 저장소로 같은 코드가 돈다
apps/seller-web    판매자 폰 웹 (웹 푸시 서비스 워커 public/sw.js)
apps/buyer-web     구매자 폰 웹 (결제 수단·거래 내역·평가·현장 사진·관심사)
apps/car-web       차량 화면(내비) + 브라우저 시뮬레이터·가상 콘솔 + Pleos SDK 포트
apps/car-android   차량 앱 셸(WebView + Pleos SDK 브리지, Kotlin)
apps/demo          체험 페이지(두 앱 + 페이지 안 서버, 한 파일)
tools              E2E·브리지 계약 시험
```

## 실행 (Node 22 이상)

```bash
npm install
npm run build:web      # 판매자 웹·구매자 웹·차량 화면 빌드
npm start              # http://localhost:8787
```

- 차량 화면: http://localhost:8787/car/ — 오른쪽 가상 콘솔로 기어·배속·좌석·방향지시등·배터리·트렁크를 바꾼다
- 판매자 폰: http://localhost:8787/seller/ — 폰으로는 같은 와이파이에서 서버가 찍어 주는 `http://<PC IP>:8787/seller/`
- 구매자 폰: http://localhost:8787/buyer/ — 차와 같은 구매자 계정(시연: 김주행)
- 에뮬레이터 안 차량 앱에서는 PC가 `http://10.0.2.2:8787`
- 시연 시계는 2026-11-06(금) 18:05에서 시작한다. 콘솔의 '시연 처음으로'가 데이터와 시계를 처음으로 돌린다.
- 서버 없이: `/car/?local`(차량만, 페이지 안 서버) 또는 체험 페이지(`npm run build -w apps/demo` → `apps/demo/dist/index.html`)

시연 순서(약 3분): 차 화면 '목적지' → 송파 집(지도 번호 핀 + 추천 목록) → 콘솔 '2열 착석'·10×·D 주행 → 영통 캠핑의자 알림 → 분당 카시트·유모차 경합 → 카시트 '들를게요' → 판매자 폰 '수락' → 경유지 도착 → 판매자 '건넸어요' → 차 '받았어요' → D 주행 → 결과 카드에서 판매자 평가. 시간이 남으면 구매자 폰(결제 수단·거래 내역)과 '판매자가 안 나올 때'(자동 수락인 캠핑의자로 들러서 다시 알리기 → 5분 뒤 끝내기).

트렁크 열림·닫힘('실으셨나요?')은 Door를 확인하지 못해 시뮬레이터에서만 된다. 실제 SDK 모드에서는 나오지 않으니 시연 순서에 넣지 않는다.

## 웹 푸시 (판매자 폰)

판매자는 페이지를 닫아 둬도 '사러 오는 차가 있어요'를 받는다. 서비스 워커는 HTTPS(또는 localhost)에서만 돌아서, 폰에서는 HTTPS 주소로 열어야 한다.

- 가장 쉬운 길: PC에서 `cloudflared tunnel --url http://localhost:8787`처럼 HTTPS 터널을 열고, 폰에서 그 주소의 `/seller/`를 연다.
- 인증서가 있으면: `JHGO_TLS_CERT=cert.pem JHGO_TLS_KEY=key.pem npm start` → `https://<PC IP>:8787/seller/` (폰이 그 인증서를 믿어야 한다).
- 폰에서 거래 탭 '알림 받기' → 권한 허용. 아이폰은 공유 → 홈 화면에 추가한 뒤 그 아이콘으로 열어야 받는다.
- 키(VAPID)는 처음 켤 때 만들어 저장소에 둔다(시연 초기화에도 남는다). `JHGO_VAPID_SUBJECT`로 연락처를, `JHGO_PUSH=0`으로 끄기.

## 사진으로 크기 추정

`ANTHROPIC_API_KEY=... npm start`로 켜면 판매자가 고른 사진(JPEG·PNG·WebP)으로 Claude가 품목과 크기를 추정한다(`JHGO_AI_MODEL`, 기본 `claude-haiku-5-5`). 키가 없거나 추정에 실패하면 품목 대표 크기로 채우고 화면에 '품목 기본 크기'라고 쓴다. 큰 물건은 어느 쪽이든 판매자 실측 확인이 있어야 올라간다.

## 확인

```bash
npm test               # 단위·API 테스트
npm run typecheck
npm run e2e            # 판매자 폰 + 차량 화면 끝까지(스크린샷: tools/out/)
npm run e2e:bridge     # 차량 화면이 실제 SDK 모드(브리지)로 끝까지 도는지
```

## 시연 영상

Playwright로 녹화하고 ffmpeg로 장면마다 자른다(ffmpeg 필요). 녹화 프레임이 밀려도 장면 경계가 맞게, 장면이 바뀔 때 화면 아래 색 띠를 바꾸고 영상에서 그 색을 찾는다(`tools/video-cut.ts`).

```bash
npm run build -w apps/demo
node node_modules/tsx/dist/cli.mjs tools/record-demo.ts <출력 폴더>      # 체험 페이지 → 01~07 MP4·대표 이미지
JHGO_RECORD=<출력 폴더> npm run e2e:bridge                               # 실제 SDK 모드(가짜 브리지) → 08~09
```

- `JHGO_FONTS=<node_modules/@fontsource 폴더>`: do-hyeon·ibm-plex-sans-kr 글꼴을 녹화 페이지에 넣는다(웹 글꼴을 못 받는 환경용).
- `JHGO_RECORD_ORIGIN=<정적 서버>`: `/car/`(차량 화면 빌드)와 `/fonts/<글꼴>/<굵기>.css`를 내주는 서버에서 차 화면을 열어 같은 글꼴로 녹화한다. 없으면 API 서버의 `/car/`를 그대로 녹화한다.

## 차량 앱(Android)

`apps/car-android/README.md`. Pleos Connect 에뮬레이터에서 PC 서버의 차량 화면을 띄우고 실제 NaviHelper·Vehicle SDK를 부른다.
