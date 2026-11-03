/**
 * 음성 포트 — Pleos TextToSpeech/SpeechToText는 사용 신청 준비 중이라(2026-11-02),
 * 같은 인터페이스 뒤에 웹 표준(Web Speech API)을 둔다. Android 셸에서는 bridge.ts가 Pleos TTS → 안드로이드 TTS 순으로 쓴다.
 * 대답은 정해진 단어만 받는다("응/아니", 품목 이름) — 오인식을 줄이기 위해.
 */
import type { VoicePort } from "./ports.ts";

type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

/**
 * @param opts.sim 시뮬레이터 모드: 마이크가 없거나 막혀 있어도(아티팩트·헤드리스) 듣는 시간 동안 기다리고,
 *                 가상 콘솔의 hear(word)로 대답을 넣을 수 있다. 브라우저 음성 인식이 되면 그것도 같이 듣는다.
 */
export function createWebVoice(opts: { muted?: () => boolean; sim?: boolean } = {}): VoicePort {
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const synth = (w.speechSynthesis as SpeechSynthesis | undefined) ?? undefined;
  const RecCtor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Rec) | undefined;
  let current: Rec | null = null;
  /** 지금 듣는 중인 질문 — hear()가 여기로 답을 넣는다 */
  let waiting: { words: string[]; finish: (v: string | null) => void } | null = null;
  const match = (words: string[], said: string) => {
    const a = said.replace(/\s/g, "");
    return words.find((wd) => a.includes(wd.replace(/\s/g, ""))) ?? null;
  };
  return {
    tts: !!synth,
    stt: !!RecCtor || !!opts.sim,
    speak(text) {
      if (!synth || opts.muted?.()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        try {
          synth.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = "ko-KR";
          u.rate = 1.05;
          const ko = synth.getVoices().find((v) => v.lang?.startsWith("ko"));
          if (ko) u.voice = ko;
          u.onend = () => resolve();
          u.onerror = () => resolve();
          synth.speak(u);
          setTimeout(resolve, Math.min(9000, 400 + text.length * 120));
        } catch {
          resolve();
        }
      });
    },
    listen(words, timeoutMs) {
      if (!RecCtor && !opts.sim) return Promise.resolve(null);
      return new Promise((resolve) => {
        let done = false;
        const finish = (v: string | null) => {
          if (done) return;
          done = true;
          waiting = null;
          try {
            current?.stop();
          } catch {
            /* 무시 */
          }
          current = null;
          resolve(v);
        };
        waiting = { words, finish };
        setTimeout(() => finish(null), timeoutMs);
        if (!RecCtor) return;
        try {
          const rec = new RecCtor();
          current = rec;
          rec.lang = "ko-KR";
          rec.interimResults = false;
          rec.maxAlternatives = 3;
          rec.onresult = (e) => {
            const alts = Array.from(e.results[0] ?? []).map((a) => a.transcript);
            finish(alts.map((a) => match(words, a)).find((x) => x !== null) ?? null);
          };
          // 시뮬레이터에서는 마이크가 막혀도(권한 없음·헤드리스) 끝내지 않고 콘솔의 대답을 기다린다
          rec.onerror = () => (opts.sim ? (current = null) : finish(null));
          rec.onend = () => (opts.sim ? (current = null) : finish(null));
          rec.start();
        } catch {
          if (!opts.sim) finish(null);
        }
      });
    },
    stop() {
      try {
        synth?.cancel();
        current?.stop();
      } catch {
        /* 무시 */
      }
    },
    hear(word) {
      if (!opts.sim || !waiting) return false;
      waiting.finish(match(waiting.words, word));
      return true;
    },
  };
}

/** 대답 단어 → 의미 */
export const YES_WORDS = ["응", "네", "예", "좋아", "들를게", "가자", "그래"];
export const NO_WORDS = ["아니", "아뇨", "됐어", "다음", "괜찮아", "싫어"];
