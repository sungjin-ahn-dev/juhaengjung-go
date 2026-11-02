/**
 * T8 알림 타이밍 — 지금 말을 걸어도 되는가.
 * 회전 직전(NaviHelper TBT), 방향지시등(Vehicle TurnSignal), 큰 조향(SteeringWheel 전륜 조향각),
 * 제동(Brake 페달) 중에는 음성 알림을 미루고, 끝나고 잠깐 안정된 뒤에 말한다.
 */
export interface DriverSignals {
  /** 다음 회전까지 거리(m) — onTBTInfo */
  tbtDistanceM?: number | null;
  /** 다음 회전이 직진·도착이면 막지 않는다 */
  tbtIsTurn?: boolean | null;
  /** TurnSignalValue {OFF, RIGHT, LEFT} */
  turnSignal?: "OFF" | "LEFT" | "RIGHT" | null;
  /** 전륜 조향각(°), 좌측 음수 — 핸들 회전각이 아님 */
  steeringAngleDeg?: number | null;
  brakePressed?: boolean | null;
}

export type GateReason = "turn_ahead" | "turn_signal" | "steering" | "braking";

export const GATE_REASON_KO: Record<GateReason, string> = {
  turn_ahead: "회전 직전",
  turn_signal: "방향지시등 켜짐",
  steering: "크게 조향 중",
  braking: "제동 중",
};

export interface GateConfig {
  tbtHoldM: number;
  steeringHoldDeg: number;
  /** 바쁜 상태가 끝나고 이만큼 조용해야 말한다 */
  settleMs: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = { tbtHoldM: 300, steeringHoldDeg: 3.5, settleMs: 2500 };

export function busyReasons(s: DriverSignals, cfg: GateConfig = DEFAULT_GATE_CONFIG): GateReason[] {
  const r: GateReason[] = [];
  if (s.tbtDistanceM != null && s.tbtIsTurn !== false && s.tbtDistanceM <= cfg.tbtHoldM) r.push("turn_ahead");
  if (s.turnSignal === "LEFT" || s.turnSignal === "RIGHT") r.push("turn_signal");
  if (s.steeringAngleDeg != null && Math.abs(s.steeringAngleDeg) >= cfg.steeringHoldDeg) r.push("steering");
  if (s.brakePressed === true) r.push("braking");
  return r;
}

export class AlertGate {
  private quietSince: number;
  private reasons: GateReason[] = [];
  private lastBusyReasons: GateReason[] = [];

  constructor(private cfg: GateConfig = DEFAULT_GATE_CONFIG, now = 0) {
    this.quietSince = now - cfg.settleMs;
  }

  update(sig: DriverSignals, now: number): void {
    const r = busyReasons(sig, this.cfg);
    if (r.length > 0) {
      this.lastBusyReasons = r;
      this.quietSince = Infinity;
    } else if (this.reasons.length > 0) {
      this.quietSince = now;
    }
    this.reasons = r;
  }

  check(now: number): { ok: boolean; reasons: GateReason[]; waitMs: number } {
    if (this.reasons.length > 0) return { ok: false, reasons: this.reasons, waitMs: this.cfg.settleMs };
    const quietFor = now - this.quietSince;
    if (quietFor < this.cfg.settleMs) return { ok: false, reasons: this.lastBusyReasons, waitMs: this.cfg.settleMs - quietFor };
    return { ok: true, reasons: [], waitMs: 0 };
  }
}
