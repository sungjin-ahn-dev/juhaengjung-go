/**
 * 녹화 영상 자르기 도우미 — Playwright 녹화는 페이지가 바쁘면 프레임이 밀려 영상 시간이 실제 시간보다 늘어난다.
 * 그래서 장면이 바뀔 때마다 화면 맨 아래 띠의 색을 바꾸고(mark), 영상에서 그 색이 처음 나온 프레임으로 시점을 찾는다.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const SYNC_H = 10;
export const PALETTE: [number, number, number][] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
  [255, 128, 0],
];

/** 페이지에 넣을 CSS·스크립트: 장면 설명(#rec-cap), 누른 곳 표시, 아래 색 띠(#rec-sync) */
export function recordOverlay(capBottom: number): { css: string; init: string } {
  const css = `
#rec-sync { position: fixed; left: 0; right: 0; bottom: 0; height: ${SYNC_H}px; background: #000; z-index: 101; }
#rec-cap { position: fixed; left: 24px; bottom: ${capBottom}px; max-width: 1250px; z-index: 99; display: flex; gap: 14px; align-items: baseline;
  font-family: "IBM Plex Sans KR", "Noto Sans CJK KR", sans-serif; color: #e8edf3; }
#rec-cap b { font-family: "Do Hyeon", "Noto Sans CJK KR", sans-serif; font-weight: 400; font-size: 30px; color: #d9b27c; white-space: nowrap; }
#rec-cap span { font-size: 21px; line-height: 1.45; }
.rec-tap { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 3px solid #ffffff;
  background: rgba(255,255,255,0.18); pointer-events: none; z-index: 100; animation: rec-tap 650ms ease-out forwards; }
@keyframes rec-tap { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }`;
  const init = `
document.addEventListener("DOMContentLoaded", () => {
  const cap = document.createElement("div"); cap.id = "rec-cap"; cap.innerHTML = "<b></b><span></span>"; document.body.appendChild(cap);
  window.__cap = (t, s) => { cap.querySelector("b").textContent = t; cap.querySelector("span").textContent = s; };
  const sync = document.createElement("div"); sync.id = "rec-sync"; document.body.appendChild(sync);
  window.__sync = (rgb) => { sync.style.background = "rgb(" + rgb.join(",") + ")"; };
});
document.addEventListener("pointerdown", (e) => {
  const d = document.createElement("div"); d.className = "rec-tap"; d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px";
  document.body.appendChild(d); setTimeout(() => d.remove(), 700);
}, true);`;
  return { css, init };
}

/** 영상에서 각 표시(mark)가 처음 보인 시점(초). 표시 색이 한 프레임도 안 잡혔으면 다음 표시와 같은 시점 */
export function findMarks(raw: string, w: number, h: number, names: string[]): Map<string, number> {
  const strip = execFileSync("ffmpeg", ["-loglevel", "error", "-i", raw, "-vf", `crop=${w}:${SYNC_H - 4}:0:${h + 2},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const nearest = (r: number, g: number, b: number) => {
    let best = -1;
    let bd = 90 * 90 * 3;
    PALETTE.forEach(([pr, pg, pb], i) => {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const segs: { color: number; start: number }[] = [];
  for (let i = 0, f = 0; i + 2 < strip.length; i += 3, f++) {
    const col = nearest(strip[i], strip[i + 1], strip[i + 2]);
    if (col < 0) continue;
    if (!segs.length || segs[segs.length - 1].color !== col) segs.push({ color: col, start: f });
  }
  const at = new Map<string, number>();
  let si = 0;
  names.forEach((name, k) => {
    const want = k % PALETTE.length;
    const nextWant = k + 1 < names.length ? (k + 1) % PALETTE.length : -1;
    let j = si;
    while (j < segs.length && segs[j].color !== want && segs[j].color !== nextWant) j++;
    if (j >= segs.length) return;
    at.set(name, segs[j].start / 25); // Playwright 녹화는 25fps
    si = segs[j].color === want ? j + 1 : j;
  });
  return at;
}

/** 장면마다 [시작, 끝] 구간을 잘라 이어 붙이고(띠는 잘라 냄) 1280 폭 MP4 + 대표 이미지 */
export function cutClips(raw: string, w: number, h: number, at: Map<string, number>, out: string, clips: { id: string; segs: [string, string, number?, number?][] }[], log: (...a: unknown[]) => void) {
  for (const c of clips) {
    const segs = c.segs.map(([a, b, padA = -0.2, padB = 0]) => [(at.get(a) ?? NaN) + padA, (at.get(b) ?? NaN) + padB] as [number, number]);
    if (segs.some(([a, b]) => !(b > a))) {
      log("건너뜀", c.id);
      continue;
    }
    const parts = segs.map(([a, b], i) => `[0:v]trim=start=${Math.max(0, a).toFixed(2)}:end=${b.toFixed(2)},setpts=PTS-STARTPTS[s${i}]`);
    const join = segs.length > 1 ? `${segs.map((_, i) => `[s${i}]`).join("")}concat=n=${segs.length}:v=1:a=0[j];[j]` : `[s0]`;
    const filter = `${parts.join(";")};${join}crop=${w}:${h}:0:0,scale=1280:-2:flags=lanczos,fps=30,format=yuv420p[out]`;
    const mp4 = path.join(out, `${c.id}.mp4`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-movflags", "+faststart", "-an", mp4]);
    const dur = segs.reduce((s, [a, b]) => s + (b - a), 0);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", Math.min(dur * 0.62, dur - 0.5).toFixed(2), "-i", mp4, "-frames:v", "1", "-q:v", "3", path.join(out, `${c.id}.jpg`)]);
    log(c.id, `${dur.toFixed(1)}s`, `${(fs.statSync(mp4).size / 1024 / 1024).toFixed(2)} MB`);
  }
}
