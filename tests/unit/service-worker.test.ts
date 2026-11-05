import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Load public/sw.js into a sandbox with a fake service-worker global. */
function loadWorker({ windows = [] as { url: string; focus: () => Promise<void>; navigate: (u: string) => Promise<void> }[] } = {}) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const cache = { addAll: vi.fn(async () => {}) };
  const self = {
    location: { origin: "https://cargo.ngb.example" },
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); },
      pushManager: { subscribe: vi.fn() },
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async (u: string) => { opened.push(u); },
      claim: async () => {},
    },
    skipWaiting: async () => {},
  };
  const context = {
    self, URL, JSON, Promise, console,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined },
    fetch: vi.fn(),
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), context);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { wait = p; } });
    await wait;
  };
  return { listeners, shown, opened, fire, cache, context };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

describe("service worker", () => {
  it("caches only the offline page and its icon", async () => {
    const w = loadWorker();
    await w.fire("install", {});
    expect(w.cache.addAll).toHaveBeenCalledWith(["/offline.html", "/icons/icon-192.png"]);
  });

  it("shows the notification from the sender's payload", async () => {
    const w = loadWorker();
    await w.fire("push", pushEvent({ title: "NGB-2026-00012: Gate-out confirmed", body: "Gate-out for MSKU1234565.", url: "/portal/shipments/NGB-2026-00012", tag: "shipment-1", id: "n1" }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe("NGB-2026-00012: Gate-out confirmed");
    expect(w.shown[0].options).toMatchObject({
      body: "Gate-out for MSKU1234565.", tag: "shipment-1", renotify: true, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png",
      data: { url: "/portal/shipments/NGB-2026-00012", id: "n1" },
    });
  });

  it("still shows something for an empty or broken payload (userVisibleOnly)", async () => {
    const w = loadWorker();
    await w.fire("push", { data: { json: () => { throw new Error("bad"); } } });
    await w.fire("push", { data: null });
    expect(w.shown.map((s) => s.title)).toEqual(["NGB LOGISTICS", "NGB LOGISTICS"]);
  });

  it.each([
    ["https://evil.example/phish", "/portal"],
    ["//evil.example/phish", "/portal"],
    ["/\\evil.example", "/portal"],
    ["javascript:alert(1)", "/portal"],
    ["/admin/shipments/123?tab=docs", "/admin/shipments/123?tab=docs"],
  ])("only opens links on our own origin (%s → %s)", async (url, expected) => {
    const w = loadWorker();
    await w.fire("push", pushEvent({ title: "x", url }));
    expect((w.shown[0].options.data as { url: string }).url).toBe(expected);
  });

  it("click: focuses an open app window and navigates it", async () => {
    const win = { url: "https://cargo.ngb.example/portal", focus: vi.fn(async () => {}), navigate: vi.fn(async () => {}) };
    const w = loadWorker({ windows: [win] });
    await w.fire("notificationclick", { notification: { close: vi.fn(), data: { url: "/portal/shipments/NGB-2026-00012" } } });
    expect(win.focus).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith("https://cargo.ngb.example/portal/shipments/NGB-2026-00012");
  });

  it("click: opens a new window when none is open", async () => {
    const w = loadWorker();
    const close = vi.fn();
    await w.fire("notificationclick", { notification: { close, data: { url: "https://evil.example" } } });
    expect(close).toHaveBeenCalled();
    expect(w.opened).toEqual(["https://cargo.ngb.example/portal"]);
  });
});
