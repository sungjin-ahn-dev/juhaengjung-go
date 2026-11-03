/**
 * 주행중GO! 체험 페이지 — 판매자 폰과 구매자 차량 화면을 한 페이지에 띄운다.
 * 서버 코드(services/api)를 페이지 안에서 메모리 저장소로 돌리고, 두 앱이 같은 서버에 붙는다.
 * 차량 쪽은 브라우저 시뮬레이터 + 가상 콘솔(실제 차에서는 Android 셸의 Pleos SDK 브리지).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createDirectClock, createLocalBackend, type ApiClient, type AppClock } from "@jhgo/api/browser";
import { CarApp, bootCar, type CarBoot } from "../../car-web/src/CarApp.tsx";
import { SellerApp } from "../../seller-web/src/SellerApp.tsx";
import "./demo.css";

function Bench({ boot, seller, clock }: { boot: CarBoot; seller: ApiClient; clock: AppClock }) {
  const reset = () => location.reload();
  return (
    <div className="bench">
      <header className="bench-head">
        <h1>주행중GO! 체험</h1>
        <p>
          왼쪽은 구매자 차의 내비 화면과 가상 콘솔, 오른쪽은 카시트를 올린 판매자의 폰이에요. 둘 다 이 페이지 안에서 도는 같은 서버에 붙어 있어요.
        </p>
        <button className="bench-reset" onClick={reset}>
          처음부터 다시
        </button>
      </header>
      <ol className="bench-steps" aria-label="시연 순서">
        <li>
          <span>차 화면 왼쪽 <b>목적지</b>에서 송파 집</span>
        </li>
        <li>
          <span>가상 콘솔에서 <b>2열 착석</b>을 켜고 <b>10×</b>, <b>D 주행</b></span>
        </li>
        <li>
          <span>영통 캠핑의자 알림에 답하기</span>
        </li>
        <li>
          <span>분당에서 <b>카시트</b>를 고르고 들를게요</span>
        </li>
        <li>
          <span>판매자 폰에서 <b>수락</b></span>
        </li>
        <li>
          <span>도착하면 폰 <b>건넸어요</b>, 차 <b>받았어요</b>, 다시 <b>D 주행</b></span>
        </li>
      </ol>
      <main className="bench-main">
        <section className="demo-car" aria-label="구매자 차량 화면">
          <CarApp boot={boot} onReset={reset} />
        </section>
        <aside className="phone-wrap" aria-label="판매자 폰">
          <div className="phone">
            <div className="phone-screen">
              <SellerApp client={seller} clock={clock} embedded storageKey="jhgo.demo.seller" />
            </div>
          </div>
          <p className="phone-note">판매자 박서연(판교 백현동)의 폰</p>
        </aside>
      </main>
    </div>
  );
}

async function start() {
  // ?compose: 카시트가 아직 안 올라간 상태로 시작(판매자 폰에서 같이 올리기부터)
  const compose = new URLSearchParams(location.search).has("compose");
  const b = createLocalBackend({ includeCarSeat: !compose });
  const clock = createDirectClock(b.clock as never);
  // 판매자 폰은 카시트를 올려 둔 박서연으로 미리 들어가 있게 한다(로그인 화면에서 다른 판매자로 바꿀 수 있다)
  const seller = b.client();
  const { users } = await seller.call<{ users: { id: string; role: string; name: string }[] }>("GET", "/v1/demo/users");
  const park = users.find((u) => u.role === "seller" && u.name === "박서연");
  if (park) {
    const s = await seller.call<{ token: string }>("POST", "/v1/session", { userId: park.id });
    seller.setToken(s.token);
  }
  const boot = bootCar(b.client(), clock, { storageKey: "jhgo.demo.car" });
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Bench boot={boot} seller={seller} clock={clock} />
    </StrictMode>,
  );
}

void start();
