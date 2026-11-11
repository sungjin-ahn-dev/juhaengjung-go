# 주행중GO! — 작업 원칙

스펙은 `docs/01_기획서.md`, 결정은 `docs/00_가이드.md`, 상태는 `docs/STATUS.md`, 기능 위치는 `docs/TASKS.md`, SDK는 `docs/API_MATRIX.md`, 브리지는 `docs/BRIDGE.md`, 전체 정리는 `docs/03_개발_정리.md`(큰 변경 뒤 갱신).
TripRoom(`../triproom`)·멀미예보(`../motioncast`)와 별개 저장소다. 코드는 복사해 쓰되 서로 import하지 않는다.

## 반드시 지킬 것
- Pleos SDK 시그니처·권한·enum은 확인한 것만 쓴다 — 실제 SDK 바이너리에서 뽑은 `tools/sdk-dump/pleos-sdk-signatures.txt`(매개변수 이름·순서·null·기본값)가 1순위, 공식 문서(document.pleos.ai)가 2순위. 미확인은 `TODO(G0)`와 API_MATRIX ❌/📄로 남기고, 대신 확인된 API로 대체(↪)하거나 거절한다.
- 시그니처 확인 ≠ 에뮬레이터 동작 ≠ 실차 검증. 단위·값의 뜻·콜백 조건은 에뮬레이터에서 확인(🧪)하기 전까지 가정이라고 쓴다. 스텁 컴파일은 실제 SDK 컴파일이 아니다(실제 컴파일은 PC `build.bat`). 실행하지 못한 검증은 "미실행"으로 쓴다.
- 구매자 위치·경로는 주행 세션 메모리에만 둔다(DB·로그·판매자 화면 금지). 판매자에게는 도착 예정과 차종·적재 판단만, 정확한 거래 지점은 수락 뒤 구매자에게만.
- 차 쪽 실패(내비 오류·경유지 실패)로 앱이 거래를 끝내면 구매자 신뢰도에 넣지 않는다(`system` 취소).
- 사용자 문구는 한국어, 짧고 구체적으로. 억지 감성·귀여움은 넣지 않는다. 조사는 `josa()`로.
- 주행 중에는 알림 카드와 큰 버튼만. 상세 화면은 정차(CarUxRestrictions 해제) 뒤에만.
- 기능 완료 = 서버 테스트 + 그 기능을 쓰는 사람(구매자·판매자)의 화면 경로. 화면이 없으면 완료로 치지 않는다. 기획서 문장과 대조는 `docs/SPEC_CHECK.md`에 같이 고친다.
- 화면 문구는 실제 동작과 맞춘다(예: AI가 안 돌면 'AI 추정'이라 쓰지 않는다, 대체 API로 잰 값을 원래 API 이름으로 부르지 않는다).
- 차 화면은 `apps/car-web/src/styles.css`의 토큰(어두운 지도, 유리 카드 `.c-card`, 크라프트는 알림·경합·현장 확인에만)과 lucide 아이콘으로 만든다. 글꼴은 폰과 같은 앱 글꼴(CSS 이름 JHGO Sans = Asta Sans 부분집합, `apps/seller-web/src/font.css`를 가져다 쓴다). 주행 중 알림 카드의 사실 칩은 둘까지. 화면을 바꾸면 1280×720과 1920×720, 분할 화면(`/car/?split`) 캡처를 직접 본다.
- 폰 화면은 `apps/seller-web/src/styles.css`(디자인 시스템)와 `kit.tsx` 조각으로 만든다. 크라프트는 차가 오는 순간(요청·만남)에만, 나머지는 흰 바탕·회색 단계. 버튼 글자에 화살표(→)를 붙이지 않고, '·'로 잇는 메타 줄을 남발하지 않는다. 화면을 바꾸면 390px 캡처를 직접 본다.

## 작업 루틴
- `npm test` · `npm run typecheck` 통과.
- 화면을 바꾸면 `npm run build:web` 뒤 `npm run e2e`와 `npm run e2e:split`(스크린샷 `tools/out/`을 직접 본다).
- 차량 앱·브리지를 바꾸면 `npm run e2e:bridge`. Kotlin을 바꾸면 스텁 컴파일(`tools/sdk-dump` 시그니처와 같은 스텁)로 최소 확인하고, 실제 빌드는 PC에서 `apps\car-android\build.bat`(결과 `build_log.txt`).
- 체험 페이지: `npm run build -w apps/demo` → `npm run e2e:auto`(자동 시연이 끝까지 가는지) → `apps/demo/dist/jhgo-demo.html`을 같은 경로로 다시 게시하고, `apps/demo/dist/index.html`을 `demo/index.html`(저장소에 둔 한 파일 체험 페이지)로 복사.
- 화면이 크게 바뀌면 시연 영상도 다시 만든다(README '시연 영상'). 영상 설명에는 시뮬레이터 녹화인지 SDK 모드(가짜 브리지)인지 적는다.
- 문서 그림: E2E 둘을 돌린 뒤 `node tools/doc-figs.cjs`(→ `docs/img/`, README·접수 양식 별지가 같이 쓴다). 숫자·SDK 표를 고치면 기획서 16·19장, `docs/API_MATRIX.md`, `docs/02_접수양식.md`를 같이 고친다.
- 접수 양식: `python3 tools/submission-form.py --form <받은 양식> --out <저장소 밖 경로>`. 02장에는 성명·소속을 쓰지 않고, 저장소·영상·그림·링크에도 개발자 실명을 넣지 않는다(양식의 주의 문구). 신청자 정보·양식 파일은 커밋하지 않는다.
- 저장소를 올리기 전: 깨끗하게 받은 폴더(`git clone`)에서 `.github/workflows/ci.yml`과 같은 순서로 `npm ci`부터 E2E 넷까지 돌린다. 무시 규칙(`.gitignore`)이 소스를 빼고 있는지는 이렇게만 보인다. 올린 뒤에는 접수 메일에 적을 최종 커밋 번호를 다시 확인한다.
- README·접수 양식에는 확인한 것만, 확인한 범위와 함께 쓴다(에뮬레이터에서 실행해 보지 않았으면 대상 환경이라고 쓰고 "실행은 아직"을 붙인다).
- 판단은 가이드, 진행은 STATUS에 한 줄씩.
