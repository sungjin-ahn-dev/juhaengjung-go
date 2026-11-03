/**
 * Gleo AI(Pleos 음성 비서) 음성 기능 — Android 셸의 assets/schema.json(actionCalls 3개)과 같은 이름.
 *   셸: GleoBridge.kt가 window.__jhgoGleo(json)으로 부르고, 결과는 window.GleoBridge.respond(json) → APP_ACTION_RESPONSE 브로드캐스트.
 *   시뮬레이터: 가상 콘솔이 같은 함수를 불러 응답을 보여 준다(마이크·Gleo 없이).
 * 응답 형식은 Callback Schema(functionName, status: success|asking|fail, message 영어 문장, data JSON 배열 문자열, mode).
 * Gleo는 7초 뒤 취소하므로 각 기능은 바로 답한다. 주행 중에는 화면을 열지 않고 말로만 답한다(SHOW_BRIEFING).
 */
import { GO_LABEL, type GoLevel } from "@jhgo/core";
import type { CarController } from "./controller.ts";

export const GLEO_FUNCTIONS = ["ADD_INTEREST", "ANSWER_ALERT", "SHOW_BRIEFING"] as const;
export type GleoFunction = (typeof GLEO_FUNCTIONS)[number];

export interface GleoRequest {
  requestId?: string;
  name: GleoFunction;
  params: Record<string, unknown>;
}
export interface GleoResponse {
  functionName: GleoFunction;
  status: "success" | "asking" | "fail";
  message: string;
  data?: string;
  mode?: "voice" | "beep" | "silent";
}

const LEVELS: GoLevel[] = ["must", "likely", "near"];
const data = (rows: unknown[]) => JSON.stringify(rows);

export async function handleGleo(c: CarController, req: GleoRequest): Promise<GleoResponse> {
  const name = req.name;
  const p = req.params ?? {};
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string).trim() : "");
  try {
    if (name === "ADD_INTEREST") {
      const keyword = str("keyword");
      if (!keyword) return { functionName: name, status: "asking", message: "Which item do you want to add?", data: data([{ missingField: "keyword" }]) };
      const level = (LEVELS as string[]).includes(str("goLevel")) ? (str("goLevel") as GoLevel) : "likely";
      const dup = c.state.interests.find((i) => i.type === "keyword" && i.keyword === keyword);
      if (dup) return { functionName: name, status: "success", message: `${keyword} is already in the interest list (${GO_LABEL[dup.goLevel]}).`, data: data([{ keyword, goLevel: dup.goLevel }]) };
      await c.addInterest(keyword, level);
      c.toast(`관심 물건에 ${keyword} 추가 (${GO_LABEL[level]})`, "good");
      return { functionName: name, status: "success", message: `Added ${keyword} to the interest list as ${GO_LABEL[level]}.`, data: data([{ keyword, goLevel: level }]) };
    }
    if (name === "ANSWER_ALERT") {
      const a = c.state.alert;
      if (!a) return { functionName: name, status: "fail", message: "There is no stop-by question right now." };
      if (a.kind === "contention") {
        const item = str("item");
        const pick = a.pair.find((x) => item && (x.categoryLabel === item || x.title.includes(item) || item.includes(x.categoryLabel)));
        if (!pick) {
          const names = a.pair.map((x) => x.categoryLabel);
          return { functionName: name, status: "asking", message: `Which one: ${names.join(" or ")}?`, data: data(names.map((n) => ({ item: n }))) };
        }
        c.choose(pick.listingId);
        return { functionName: name, status: "success", message: `Chose ${pick.categoryLabel}. The app now asks whether to stop by.`, data: data([{ item: pick.categoryLabel }]), mode: "silent" };
      }
      const answer = str("answer");
      if (answer !== "yes" && answer !== "no") return { functionName: name, status: "asking", message: `Do you want to stop by for the ${a.c.categoryLabel}? Say yes or no.`, data: data([{ item: a.c.categoryLabel, detourMin: a.c.detourMin }]) };
      const label = a.c.categoryLabel;
      await c.answer(answer === "yes");
      return {
        functionName: name,
        status: "success",
        message: answer === "yes" ? `Requested the seller of the ${label}. The app will add the stop once the seller accepts.` : `Skipped the ${label}.`,
        data: data([{ item: label, answer }]),
        mode: "silent",
      };
    }
    if (name === "SHOW_BRIEFING") {
      const items = (c.state.candidates.length ? c.state.candidates : (c.state.briefing?.items ?? [])).filter((x) => x.exclusions.length === 0);
      if (c.state.mode === "idle") return { functionName: name, status: "fail", message: "Set a destination first; the briefing follows the route." };
      const top = [...items].sort((x, y) => y.score - x.score).slice(0, 3);
      if (!c.state.restricted) c.open("briefing");
      const summary = top.length ? `${top.length === items.length ? top.length : items.length} listings along the route. ` + top.map((x) => `${x.categoryLabel}, ${x.detourMin} minutes extra`).join("; ") + "." : "No listings along this route.";
      return { functionName: name, status: "success", message: summary, data: data(top.map((x) => ({ item: x.categoryLabel, title: x.title, detourMin: x.detourMin, price: x.price }))) };
    }
    return { functionName: name, status: "fail", message: "Unknown function." };
  } catch (e) {
    return { functionName: name, status: "fail", message: `The app could not complete it: ${(e as Error).message}` };
  }
}

/** 셸·시뮬레이터가 같이 쓰는 입구. 셸이면 GleoBridge.respond로 돌려주고, 아니면 호출자가 Promise로 받는다 */
export function installGleo(c: CarController): (req: GleoRequest) => Promise<GleoResponse> {
  const run = async (req: GleoRequest) => {
    const res = await handleGleo(c, req);
    const shell = (window as unknown as { GleoBridge?: { respond(json: string): void } }).GleoBridge;
    if (shell && req.requestId) shell.respond(JSON.stringify({ requestId: req.requestId, ...res }));
    return res;
  };
  (window as unknown as { __jhgoGleoNames?: readonly string[] }).__jhgoGleoNames = GLEO_FUNCTIONS; // 점검용(브리지 계약 시험)
  (window as unknown as { __jhgoGleo?: (json: string) => boolean }).__jhgoGleo = (json: string) => {
    try {
      const req = JSON.parse(json) as GleoRequest;
      if (!GLEO_FUNCTIONS.includes(req.name)) return false;
      void run({ ...req, params: req.params ?? {} });
      return true;
    } catch {
      return false;
    }
  };
  return run;
}
