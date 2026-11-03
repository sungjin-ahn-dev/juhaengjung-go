/** 판매자·구매자 폰이 같이 쓰는 작은 화면 조각 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Banknote,
  Bell,
  Box,
  Camera,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  CreditCard,
  Eye,
  Handshake,
  Heart,
  House,
  ImagePlus,
  Info,
  MapPin,
  Minus,
  Package,
  Pause,
  Pencil,
  Plus,
  Receipt,
  Route,
  Ruler,
  ShieldCheck,
  Star,
  Timer,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ApiClient } from "@jhgo/api";

const ICONS = {
  banknote: Banknote,
  bell: Bell,
  box: Box,
  camera: Camera,
  car: Car,
  check: Check,
  back: ChevronLeft,
  chevron: ChevronRight,
  alert: CircleAlert,
  ok: CircleCheck,
  clock: Clock,
  card: CreditCard,
  eye: Eye,
  handshake: Handshake,
  heart: Heart,
  home: House,
  photo: ImagePlus,
  info: Info,
  pin: MapPin,
  minus: Minus,
  package: Package,
  pause: Pause,
  pencil: Pencil,
  plus: Plus,
  receipt: Receipt,
  route: Route,
  ruler: Ruler,
  shield: ShieldCheck,
  star: Star,
  timer: Timer,
  trash: Trash2,
  wallet: Wallet,
  close: X,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, stroke = 1.9 }: { name: IconName; size?: number; stroke?: number }) {
  const C = ICONS[name];
  return <C className="s-icon" size={size} strokeWidth={stroke} aria-hidden="true" />;
}

/** 켜고 끄기 — 줄 전체가 단추 */
export function Toggle({ checked, onChange, label, sub, testid, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; testid?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="s-toggle" onClick={() => onChange(!checked)} data-testid={testid} disabled={disabled}>
      <span className="s-toggle-text">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
      <span className={`s-switch-track ${checked ? "on" : ""}`} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

/** 아래에서 올라오는 판 */
export function Sheet({ title, onClose, children, testid }: { title: ReactNode; onClose: () => void; children: ReactNode; testid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="s-sheet-wrap" role="presentation">
      <button className="s-sheet-backdrop" aria-label="닫기" onClick={onClose} tabIndex={-1} />
      <div className="s-sheet" role="dialog" aria-modal="true" tabIndex={-1} ref={ref} data-testid={testid}>
        <div className="s-sheet-head">
          <b>{title}</b>
          <button className="s-icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ToastState {
  text: string;
  action?: { label: string; run: () => void };
  tone?: "ok" | "warn";
}

/** 짧은 안내. 되돌릴 수 있으면 단추를 붙인다 */
export function useToast(ms = 3600) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (t: string | ToastState) => {
    const next = typeof t === "string" ? { text: t } : t;
    setToast(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), next.action ? ms + 2400 : ms);
  };
  const view = toast ? (
    <div className={`s-toast ${toast.tone ?? ""}`} role="status" key={toast.text}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  ) : null;
  return { show, view };
}

export function Stars({ onRate, label }: { onRate: (n: number) => void; label: string }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="s-stars" role="group" aria-label={label} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= hover ? "on" : ""} onMouseEnter={() => setHover(n)} onFocus={() => setHover(n)} onClick={() => onRate(n)} aria-label={`${n}점`}>
          <Icon name="star" size={26} stroke={1.6} />
        </button>
      ))}
    </div>
  );
}

/** 0.5초마다 다시 그릴 시각 */
export function useNow(clock: { now(): number }) {
  const [now, setNow] = useState(clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 500);
    return () => clearInterval(id);
  }, [clock]);
  return now;
}

export function beep(freq = 880) {
  try {
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.25);
  } catch {
    /* 소리 못 내도 계속 */
  }
}
export function buzz(p: number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* 무시 */
  }
}

/** 주행중GO! 상표 글자 */
export function Mark({ role }: { role?: string }) {
  return (
    <span className="s-mark" aria-label={`주행중GO!${role ? ` ${role}` : ""}`}>
      주행중<em>GO!</em>
    </span>
  );
}

/** 시연 계정 고르기 — 판매자·구매자 폰이 같이 쓴다 */
export function DemoLogin({
  client,
  role,
  intro,
  sub,
  onLogin,
  allowNew,
  embedded,
  testPrefix,
}: {
  client: ApiClient;
  role: "seller" | "buyer";
  intro: ReactNode;
  sub: ReactNode;
  onLogin: (b: { userId?: string; role?: string; name?: string }) => Promise<void>;
  allowNew?: boolean;
  embedded: boolean;
  testPrefix: string;
}) {
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    client
      .call<{ users: { id: string; name: string; role: string }[] }>("GET", "/v1/demo/users")
      .then((r) => setUsers(r.users.filter((u) => u.role === role)))
      .catch(() => setUsers([]));
  }, [client, role]);
  const go = (b: { userId?: string; role?: string; name?: string }) => onLogin(b).catch((e) => setErr((e as Error).message));
  return (
    <div className={`s-root ${role === "buyer" ? "b-root" : ""} ${embedded ? "embedded" : ""}`}>
      <div className="s-phone s-login">
        <div className="s-login-brand">
          주행중<em>GO!</em>
        </div>
        <p className="s-login-intro">{intro}</p>
        <p className="s-login-sub">{sub}</p>
        <h2>시연 계정으로 시작</h2>
        <div className="s-rows">
          {users === null && <div className="s-empty">불러오는 중</div>}
          {users?.map((u) => (
            <button key={u.id} className="s-row-btn" onClick={() => void go({ userId: u.id })} data-testid={`${testPrefix}${u.name}`}>
              <span className="s-avatar" aria-hidden="true">
                {u.name.slice(0, 1)}
              </span>
              <span className="s-row-main">{u.name}</span>
              <Icon name="chevron" />
            </button>
          ))}
          {users?.length === 0 && <div className="s-empty">시연 계정을 불러오지 못했어요</div>}
        </div>
        {allowNew && (
          <>
            <h2>새 이름으로 시작</h2>
            <form
              className="s-inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void go({ role, name: name.trim() });
              }}
            >
              <input className="s-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="이름" />
              <button className="s-btn primary" disabled={!name.trim()}>
                시작
              </button>
            </form>
          </>
        )}
        {err && <p className="s-warn">{err}</p>}
      </div>
    </div>
  );
}
