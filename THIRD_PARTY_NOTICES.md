# 제3자 소프트웨어·글꼴 고지

주행중GO!의 코드·화면·물건 그림(`packages/core/src/art.ts`)·아이콘 표식은 직접 만들었다. 아래는 함께 배포되는(앱·웹 번들에 들어가는) 제3자 구성 요소다.

| 구성 요소 | 쓰는 곳 | 라이선스 |
|---|---|---|
| Asta Sans (42dot, The Asta Sans Project Authors) | 차 화면·폰 화면 글꼴. 앱 글자 + KS X 1001 한글만 남긴 부분집합(`apps/seller-web/src/assets/AstaSans-subset.woff2`) | SIL Open Font License 1.1 — `apps/seller-web/src/assets/AstaSans-OFL.txt` |
| Do Hyeon (우아한형제들) | 상표 글자 '주행중GO!' (Google Fonts에서 불러옴) | SIL Open Font License 1.1 |
| lucide-react 0.469.0 | 화면 아이콘 | ISC |
| React · React DOM 18.3.1 | 차 화면·폰 웹 | MIT |
| Hono 4.13.13, @hono/node-server 1.19.17 | 서버, 페이지 안 서버 | MIT |
| web-push 3.6.7 | 판매자 웹 푸시(서버) | MPL-2.0 |
| AndroidX core-ktx·activity-ktx·webkit, kotlinx-coroutines | 차량 앱 셸 | Apache-2.0 |
| Pleos Connect SDK (Vehicle 2.3.2, NaviHelper 3.0.5, TextToSpeech 3.3.1, SpeechToText 3.3.1) | 차량 앱(pleos 플레이버) | Pleos Playground 이용 조건 |

개발 도구(TypeScript, Vite, Vitest, tsx, Playwright, marked, ffmpeg)는 배포물에 들어가지 않는다.
다른 중고 플랫폼의 매물·이름·로고는 쓰지 않는다. 시연 매물·인물은 모두 가상이다.
