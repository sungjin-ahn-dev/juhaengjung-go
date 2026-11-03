/** 가상 콘솔 — Pleos Virtual Console처럼 차량 신호를 바꿔 보는 개발 도구(차량 화면과 분리) */
import { useEffect, useState } from "react";
import { DEMO_NET, VEHICLE_TABLE } from "@jhgo/core";
import type { AppClock } from "../clock.ts";
import type { SdkLogEntry } from "../pleos/ports.ts";
import type { SimCar } from "../pleos/sim.ts";
import type { CarController } from "../controller.ts";
import { fmtClock } from "./format.ts";

const node = (id: string) => DEMO_NET.nodes.find((n) => n.id === id)!;

export function VirtualConsole({
  sim,
  clock,
  controller,
  hear,
  onReset,
}: {
  sim: SimCar;
  clock: AppClock;
  /** 듣는 중인지와 기대하는 말을 보여 주기 위해 */
  controller?: CarController;
  /** 마이크 대신 말을 넣는다(시뮬레이터 음성 포트) */
  hear?: (word: string) => boolean;
  onReset?: () => void;
}) {
  const [, setT] = useState(0);
  const [logs, setLogs] = useState<SdkLogEntry[]>([]);
  const [rate, setRate] = useState(clock.rate());
  useEffect(() => {
    const id = setInterval(() => {
      setT((x) => x + 1);
      setRate(clock.rate());
    }, 300);
    const off = sim.onLog((e) => setLogs((l) => [...l.slice(-400), e]));
    return () => {
      clearInterval(id);
      off();
    };
  }, [sim, clock]);
  const st = sim.st;
  const setSpeed = async (r: number) => {
    await clock.setRate?.(r);
    setRate(clock.rate());
  };
  const btn = (on: boolean) => (on ? "on" : "");
  return (
    <aside className="vc" aria-label="가상 콘솔" data-testid="console">
      <h3>가상 콘솔</h3>
      <p>Pleos Virtual Console처럼 기어·좌석·방향지시등·배터리·트렁크를 바꿔요. 차량 앱은 SDK 포트로만 이 값을 읽어요.</p>

      <section>
        <h4>주행</h4>
        <div className="vc-row">
          <button className={btn(st.gear === "P")} onClick={() => sim.setGear("P")} data-testid="gear-p">
            P 정차
          </button>
          <button className={btn(st.gear === "D")} onClick={() => sim.setGear("D")} data-testid="gear-d">
            D 주행
          </button>
          <span>{Math.round(st.speedKph)} km/h</span>
        </div>
        <div className="vc-row">
          배속
          {[1, 10, 30, 60].map((r) => (
            <button key={r} className={btn(Math.round(rate) === r)} onClick={() => void setSpeed(r)} data-testid={`rate-${r}`}>
              {r}×
            </button>
          ))}
        </div>
        <div className="vc-kv">
          <span>가상 시각</span>
          <b>{fmtClock(clock.now())}</b>
          <span>내비 상태</span>
          <b>{st.navStatus}</b>
          <span>주행거리</span>
          <b>{st.odometerKm.toFixed(1)} km</b>
        </div>
      </section>

      <section>
        <h4>내비</h4>
        <div className="vc-row">
          <button onClick={() => void sim.requestRoute({ latitude: node("songpa_home").lat, longitude: node("songpa_home").lng, name: "송파 집" })}>목적지: 송파 집</button>
          <button onClick={() => void sim.cancelRoute()}>경로 취소</button>
        </div>
        <div className="vc-row">
          <button onClick={() => sim.startFreeDrive([node("pangyo"), node("jeongja"), node("sunae"), node("seohyeon")])}>목적지 없이 달리기(분당)</button>
          <button onClick={() => sim.teleport({ lat: node("suwon_cityhall").lat, lng: node("suwon_cityhall").lng })}>출발 위치로</button>
        </div>
      </section>

      <section>
        <h4>차량 신호</h4>
        <div className="vc-row">
          <label>
            <input type="checkbox" checked={st.row2Occupied} onChange={(e) => sim.setRow2Occupied(e.target.checked)} data-testid="row2" />
            2열 착석
          </label>
          <label title="3열이 있는 차(아이오닉 9·EV9·팰리세이드·카니발)에서만 적재 판단에 써요">
            <input type="checkbox" checked={st.row3Occupied} onChange={(e) => sim.setRow3Occupied(e.target.checked)} data-testid="row3" />
            3열 착석
          </label>
          <label>
            <input type="checkbox" checked={st.autoDriver} onChange={(e) => sim.setAutoDriver(e.target.checked)} />
            자동 운전 행동
          </label>
        </div>
        <div className="vc-row">
          방향지시등
          <button onClick={() => sim.pulseTurnSignal("LEFT")} data-testid="signal-left">
            왼쪽 4초
          </button>
          <button onClick={() => sim.pulseTurnSignal("RIGHT")} data-testid="signal-right">
            오른쪽 4초
          </button>
          <b>{st.turnSignal}</b>
        </div>
        <div className="vc-row">
          <button onClick={() => sim.pulseSteering(-12)}>크게 꺾기</button>
          <button onClick={() => sim.pulseBrake()}>브레이크</button>
          <span>
            조향 {st.steeringDeg}°, 제동 {st.brake ? "켜짐" : "꺼짐"}
          </span>
        </div>
        <div className="vc-row">
          <label style={{ flex: 1 }}>
            배터리
            <input type="range" min={5} max={100} value={Math.round(st.socPct)} onChange={(e) => sim.setSoc(Number(e.target.value))} data-testid="soc" />
            <b>{Math.round(st.socPct)}%</b>
          </label>
        </div>
        <div className="vc-row">
          트렁크
          <button className={btn(st.trunkOpen)} onClick={() => sim.setTrunk(true)} data-testid="trunk-open">
            열기
          </button>
          <button className={btn(!st.trunkOpen)} onClick={() => sim.setTrunk(false)} data-testid="trunk-close">
            닫기
          </button>
        </div>
        <div className="vc-row">
          차종
          <select value={st.model} onChange={(e) => sim.setModel(e.target.value)}>
            {VEHICLE_TABLE.map((v) => (
              <option key={v.model}>{v.model}</option>
            ))}
          </select>
          <label>
            <input type="checkbox" checked={!st.carInfoHasModel} onChange={(e) => sim.setModel(st.model, !e.target.checked)} />
            CarInfo에 모델명 없음
          </label>
        </div>
      </section>

      {hear && (
        <section>
          <h4>음성 대답</h4>
          <div className="vc-row">
            {(() => {
              const listening = !!controller?.state.alert?.listening;
              const words = listening ? controller!.listenWords() : ["응", "아니"];
              return (
                <>
                  {words.map((w) => (
                    <button key={w} disabled={!listening} onClick={() => hear(w)} data-testid={`voice-say-${w}`}>
                      "{w}"
                    </button>
                  ))}
                  <span data-testid="voice-state">{listening ? "듣는 중 — 마이크 대신 눌러요" : "알림이 뜨고 2초 뒤 6초 동안 들어요"}</span>
                </>
              );
            })()}
          </div>
        </section>
      )}

      <section>
        <h4>SDK 호출·이벤트</h4>
        <div className="vc-log" data-testid="sdk-log">
          {logs
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={i} className={l.dir}>
                {fmtClock(l.at)} {l.dir === "call" ? "→" : "←"} {l.api}: {l.text}
              </div>
            ))}
        </div>
      </section>

      {onReset && (
        <section>
          <button onClick={onReset} data-testid="reset">
            시연 처음으로 (데이터 초기화)
          </button>
        </section>
      )}
    </aside>
  );
}
