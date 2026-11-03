/**
 * HTTP API (Hono). Node 서버와 브라우저 시연(app.fetch 직접 호출)에서 같은 코드로 동작한다.
 * 인증: Authorization: Bearer <token> (SSE는 ?token=)
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  categorize,
  CATEGORIES,
  DEMO_NET,
  DEMO_PLACES,
  estimateSize,
  needsMeasuredSize,
  parsePastedListing,
  referencePrice,
  VEHICLE_TABLE,
  type Condition,
  type GoLevel,
  type TradeEvent,
} from "@jhgo/core";
import { DemoClock, type AppEvent } from "./infra.ts";
import { DEMO_START, PICKUP_PLACES, seedDemo } from "./seed.ts";
import { ApiError, Service, type DriveContextInput, type ListingInput, type User } from "./service.ts";

type Env = { Variables: { user: User } };

export interface AppOptions {
  /** 시연 엔드포인트(/v1/demo/*) 허용 */
  demo: boolean;
  sseHeartbeatMs?: number;
}

export function createApp(svc: Service, opts: AppOptions) {
  const app = new Hono<Env>();
  app.use("/v1/*", cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof SyntaxError) return c.json({ error: "bad_json", message: "요청 형식이 잘못됐어요" }, 400);
    console.error(err);
    return c.json({ error: "internal", message: "서버 오류가 났어요" }, 500);
  });

  const auth = (role?: "buyer" | "seller") => async (c: Context<Env>, next: () => Promise<void>) => {
    const h = c.req.header("Authorization");
    const token = h?.startsWith("Bearer ") ? h.slice(7) : c.req.query("token");
    const user = svc.userByToken(token);
    if (!user) throw new ApiError(401, "unauthorized", "다시 로그인해 주세요");
    if (role && user.role !== role) throw new ApiError(403, "forbidden", role === "buyer" ? "차량(구매자) 계정이 필요해요" : "판매자 계정이 필요해요");
    c.set("user", user);
    await next();
  };
  const body = async <T>(c: Context<Env>): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      return {} as T;
    }
  };

  // ── 공통 ──
  app.get("/v1/health", (c) => c.json({ ok: true, now: svc.now(), demo: opts.demo }));
  app.get("/v1/clock", (c) => c.json({ now: svc.now(), rate: svc.d.clock.rate(), demo: svc.d.clock.demo }));
  app.get("/v1/map", (c) => c.json({ net: DEMO_NET, places: DEMO_PLACES }));
  app.get("/v1/catalog", (c) =>
    c.json({
      categories: CATEGORIES.map((x) => ({ id: x.id, label: x.label, fragile: !!x.fragile })),
      vehicles: VEHICLE_TABLE.map((v) => ({ model: v.model, powertrain: v.powertrain, seatRows: v.seatRows })),
      pickupPlaces: PICKUP_PLACES,
      /** 사진으로 크기 추정을 쓸 수 있는지(서버에 API 키가 있을 때) */
      aiSize: !!svc.d.sizeAI,
      /** 판매자 웹 푸시를 쓸 수 있는지 */
      push: !!svc.pushKey(),
      tradeConfig: svc.tradeConfigView(),
    }),
  );

  // ── 웹 푸시(판매자) ──
  app.get("/v1/push/key", (c) => {
    const key = svc.pushKey();
    if (!key) throw new ApiError(404, "push_unavailable", "이 서버는 웹 푸시를 쓰지 않아요");
    return c.json({ publicKey: key });
  });
  app.get("/v1/push/status", auth(), (c) => c.json({ available: !!svc.pushKey(), count: svc.pushCount(c.get("user")) }));
  app.post("/v1/push/subscribe", auth(), async (c) => c.json(svc.subscribePush(c.get("user"), (await body<{ subscription?: unknown }>(c)).subscription)));
  app.post("/v1/push/unsubscribe", auth(), async (c) => c.json(svc.unsubscribePush(c.get("user"), String((await body<{ endpoint?: string }>(c)).endpoint ?? ""))));

  app.post("/v1/session", async (c) => {
    const b = await body<{ role?: "buyer" | "seller"; name?: string; userId?: string }>(c);
    if (b.userId) {
      if (!opts.demo) throw new ApiError(403, "forbidden", "시연 모드에서만 됩니다");
      const u = svc.user(b.userId);
      return c.json({ token: u.token, user: svc.publicUser(u) });
    }
    if (b.role !== "buyer" && b.role !== "seller") throw new ApiError(422, "bad_role", "역할을 골라 주세요");
    const u = svc.createUser(b.role, b.name ?? "");
    return c.json({ token: u.token, user: svc.publicUser(u) });
  });
  app.get("/v1/me", auth(), (c) => {
    const u = c.get("user");
    return c.json({ user: svc.publicUser(u), trust: svc.trustSummary(u.id, u.role) });
  });
  app.get("/v1/events", auth(), (c) => c.json({ events: svc.events(c.get("user"), Number(c.req.query("since") ?? 0)) }));

  app.get("/v1/stream", auth(), (c) => {
    const user = c.get("user");
    const heartbeat = opts.sseHeartbeatMs ?? 15000;
    return streamSSE(c, async (stream) => {
      const queue: AppEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsub = svc.d.bus.subscribe(user.id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsub();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ now: svc.now(), userId: user.id }) });
      while (!closed) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, heartbeat);
          });
          wake = null;
        }
        if (closed) break;
        if (queue.length === 0) {
          await stream.writeSSE({ event: "ping", data: JSON.stringify({ now: svc.now() }) });
          continue;
        }
        while (queue.length) {
          const e = queue.shift()!;
          await stream.writeSSE({ event: "app", id: e.id, data: JSON.stringify(e) });
        }
      }
      unsub();
    });
  });

  // ── 시연 ──
  if (opts.demo) {
    app.get("/v1/demo/users", (c) =>
      c.json({ users: svc.d.store.list<User>("users").map((u) => ({ id: u.id, role: u.role, name: u.name })) }),
    );
    app.post("/v1/demo/reset", async (c) => {
      const b = await body<{ includeCarSeat?: boolean; startAt?: number; rate?: number }>(c);
      svc.d.store.clear();
      const clock = svc.d.clock;
      if (clock instanceof DemoClock) {
        clock.set(b.startAt ?? DEMO_START);
        if (b.rate !== undefined) clock.setRate(b.rate);
      }
      const r = seedDemo(svc, { includeCarSeat: b.includeCarSeat });
      return c.json({
        now: svc.now(),
        buyer: { id: r.buyer.id, name: r.buyer.name },
        sellers: Object.values(r.sellers).map((s) => ({ id: s.id, name: s.name })),
      });
    });
    app.post("/v1/demo/clock", async (c) => {
      const b = await body<{ rate?: number; now?: number }>(c);
      const clock = svc.d.clock;
      if (!(clock instanceof DemoClock)) throw new ApiError(409, "not_demo_clock", "시연 시계가 아니에요");
      if (b.now !== undefined) clock.set(b.now);
      if (b.rate !== undefined) clock.setRate(b.rate);
      return c.json({ now: clock.now(), rate: clock.rate() });
    });
  }

  // ── 판매자 ──
  app.post("/v1/seller/parse", auth("seller"), async (c) => {
    const b = await body<{ text?: string }>(c);
    const p = parsePastedListing(b.text ?? "");
    const category = p.category ?? categorize(p.title);
    const est = estimateSize(p.title, category);
    return c.json({ ...p, category, sizeEstimate: est, referencePrice: category ? referencePrice(category, "good") : null });
  });
  app.post("/v1/seller/estimate-size", auth("seller"), async (c) => {
    const b = await body<{ title?: string; category?: string; photo?: string }>(c);
    return c.json(await svc.estimateSizeFor(c.get("user"), b));
  });
  app.get("/v1/seller/reference-price", auth("seller"), (c) =>
    c.json({ referencePrice: referencePrice(c.req.query("category") ?? "", (c.req.query("condition") as Condition) ?? "good") }),
  );
  app.get("/v1/seller/listings", auth("seller"), (c) => c.json({ listings: svc.sellerListings(c.get("user")) }));
  app.post("/v1/seller/listings", auth("seller"), async (c) => c.json({ listing: svc.createListing(c.get("user"), await body<ListingInput>(c)) }, 201));
  app.patch("/v1/seller/listings/:id", auth("seller"), async (c) => c.json({ listing: svc.updateListing(c.get("user"), (c.req.param("id") ?? ""), await body(c)) }));
  app.get("/v1/seller/trades", auth("seller"), (c) => c.json({ trades: svc.sellerTrades(c.get("user")) }));
  app.get("/v1/seller/summary", auth("seller"), (c) => c.json(svc.sellerSummary(c.get("user"))));
  const sellerAction = (path: string, make: (b: Record<string, unknown>) => TradeEvent) =>
    app.post(`/v1/seller/trades/:id/${path}`, auth("seller"), async (c) =>
      c.json({ trade: svc.sellerTradeEvent(c.get("user"), (c.req.param("id") ?? ""), make(await body<Record<string, unknown>>(c))) }),
    );
  sellerAction("accept", () => ({ type: "SELLER_ACCEPT" }));
  sellerAction("decline", (b) => ({ type: "SELLER_DECLINE", reason: b.reason as string | undefined }));
  sellerAction("handed", () => ({ type: "SELLER_HANDED" }));
  sellerAction("cancel", (b) => ({ type: "SELLER_CANCEL", reason: b.reason as string | undefined }));
  sellerAction("rate", (b) => ({ type: "RATE", by: "seller", stars: Number(b.stars ?? 5) }));

  // ── 구매자(차량) ──
  app.get("/v1/buyer/profile", auth("buyer"), (c) => {
    const u = c.get("user");
    return c.json({ user: svc.publicUser(u), interests: svc.interestViews(u), trust: svc.trustSummary(u.id, "buyer"), block: svc.blockFor(u) });
  });
  app.get("/v1/buyer/payment-method", auth("buyer"), (c) => c.json({ paymentMethod: c.get("user").paymentMethod ?? null, block: svc.blockFor(c.get("user")) }));
  app.put("/v1/buyer/payment-method", auth("buyer"), async (c) => c.json({ paymentMethod: svc.setPaymentMethod(c.get("user"), await body(c)) }));
  app.delete("/v1/buyer/payment-method", auth("buyer"), (c) => {
    svc.clearPaymentMethod(c.get("user"));
    return c.json({ ok: true });
  });
  app.put("/v1/buyer/vehicle", auth("buyer"), async (c) => c.json({ vehicle: svc.setVehicle(c.get("user"), await body(c)) }));
  app.put("/v1/buyer/settings", auth("buyer"), async (c) => c.json({ settings: svc.setSettings(c.get("user"), await body(c)) }));
  app.post("/v1/buyer/interests", auth("buyer"), async (c) =>
    c.json({ interest: svc.addInterest(c.get("user"), await body<{ type: "keyword" | "wish"; keyword?: string; listingId?: string; goLevel: GoLevel }>(c)) }, 201),
  );
  app.delete("/v1/buyer/interests/:id", auth("buyer"), (c) => {
    svc.removeInterest(c.get("user"), (c.req.param("id") ?? ""));
    return c.json({ ok: true });
  });
  app.get("/v1/buyer/trades", auth("buyer"), (c) => c.json({ trades: svc.buyerTrades(c.get("user")) }));
  app.get("/v1/buyer/trades/:id", auth("buyer"), (c) => {
    const t = svc.trade((c.req.param("id") ?? ""));
    if (t.buyerId !== c.get("user").id) throw new ApiError(404, "trade_not_found", "거래를 찾을 수 없어요");
    return c.json({ trade: svc.buyerTradeView(t) });
  });
  const buyerAction = (path: string, make: (b: Record<string, unknown>) => TradeEvent) =>
    app.post(`/v1/buyer/trades/:id/${path}`, auth("buyer"), async (c) =>
      c.json({ trade: svc.buyerTradeEvent(c.get("user"), (c.req.param("id") ?? ""), make(await body<Record<string, unknown>>(c))) }),
    );
  buyerAction("waypoint-confirmed", () => ({ type: "WAYPOINT_CONFIRMED" }));
  buyerAction("eta", (b) => ({ type: "ETA", remainS: Number(b.remainS ?? 0) }));
  buyerAction("arrived", () => ({ type: "ARRIVED" }));
  buyerAction("received", () => ({ type: "BUYER_RECEIVED" }));
  buyerAction("decline", (b) => ({ type: "BUYER_DECLINE_MISMATCH", reason: String(b.reason ?? "등록 정보와 달라요"), note: b.note as string | undefined }));
  buyerAction("cancel", (b) => ({ type: "BUYER_CANCEL", reason: b.reason as string | undefined, system: b.system === true }));
  buyerAction("rate", (b) => ({ type: "RATE", by: "buyer", stars: Number(b.stars ?? 5) }));
  buyerAction("nudge", () => ({ type: "BUYER_NUDGE" }));
  buyerAction("seller-absent", () => ({ type: "BUYER_REPORT_SELLER_ABSENT" }));
  buyerAction("evidence", (b) => ({ type: "BUYER_EVIDENCE", photos: Array.isArray(b.photos) ? (b.photos as string[]) : [] }));

  // ── 주행 ──
  const ctxOf = (b: { ctx?: DriveContextInput }): DriveContextInput => {
    const ctx = b.ctx;
    if (!ctx || !ctx.location || typeof ctx.location.lat !== "number") throw new ApiError(422, "ctx_required", "주행 정보가 필요해요");
    return {
      ...ctx,
      now: typeof ctx.now === "number" ? ctx.now : svc.now(),
      waypointCount: ctx.waypointCount ?? ctx.waypoints?.length ?? 0,
      seats: ctx.seats ?? { row2Occupied: null, row3Occupied: null },
    };
  };
  app.post("/v1/drive/briefing", auth("buyer"), async (c) => c.json(svc.briefing(c.get("user"), ctxOf(await body(c)))));
  app.post("/v1/drive/context", auth("buyer"), async (c) => c.json(svc.driveContext(c.get("user"), ctxOf(await body(c)))));
  app.post("/v1/drive/alerted", auth("buyer"), async (c) => {
    const b = await body<{ listingIds?: string[] }>(c);
    svc.markAlerted(c.get("user"), b.listingIds ?? []);
    return c.json({ ok: true });
  });
  app.post("/v1/drive/dismiss", auth("buyer"), async (c) => {
    const b = await body<{ listingId?: string }>(c);
    if (b.listingId) svc.dismiss(c.get("user"), b.listingId);
    return c.json({ ok: true });
  });
  app.post("/v1/drive/request", auth("buyer"), async (c) => {
    const b = await body<{ ctx?: DriveContextInput; listingId?: string; source?: "drive" | "briefing" }>(c);
    if (!b.listingId) throw new ApiError(422, "listing_required", "매물을 골라 주세요");
    return c.json({ trade: svc.request(c.get("user"), ctxOf(b), b.listingId, b.source === "briefing" ? "briefing" : "drive") }, 201);
  });
  app.post("/v1/drive/end", auth("buyer"), async (c) => c.json(svc.endDrive(c.get("user"), await body(c))));

  return app;
}
