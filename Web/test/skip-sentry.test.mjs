// The page service's URL scrubbing and calls, against a stand-in for Sentry's SDK: `cd Web && bun test`.
import { expect, test } from "bun:test";

let initOptions = null;
let client = null;
const processors = [];
const cleared = [];
const calls = [];
globalThis.Sentry = {
  getClient: () => client,
  init: (options) => { initOptions = options; },
  browserTracingIntegration: () => ({}),
  addEventProcessor: (processor) => processors.push(processor),
  withStaticSpan: (callback) => Object.assign(callback, { _static: true }),
  getIsolationScope: () => ({ clearBreadcrumbs: () => cleared.push("isolation") }),
  getCurrentScope: () => ({ clearBreadcrumbs: () => cleared.push("current") }),
  metrics: { gauge: (key, value) => calls.push(["gauge", key, value]) },
};
let service = null;
globalThis.SwiftUIWebServices = { queue: [], define(name, factory) { service = factory({ emit() {} }); } };
await import("../Resources/skip-sentry.js");
const scrubURL = (url) => url.replace(/(\/convite\/)[^/?#\s]+/g, "$1[token]");
SkipSentryWeb.start({ dsn: "https://k@o0.ingest.sentry.io/1", sendURLQueries: false, scrubURL });
const streamed = initOptions;

test("a request URL loses its query and the path secret the page names", () => {
  const event = streamed.beforeSend({ request: { url: "https://bo.example/convite/SECRET-TOKEN?x=1", query_string: "x=1" } });
  expect(event.request.url).toBe("https://bo.example/convite/[token]");
  expect(event.request.query_string).toBeUndefined();
});

test("span names, attributes and breadcrumbs lose both", () => {
  const span = streamed.beforeSendSpan({ name: "/convite/SECRET-TOKEN", attributes: { "url.full": "https://cdn.example/a.m3u8?sig=S", "url.query": "sig=S" } });
  expect(span.name).toBe("/convite/[token]");
  expect(span.attributes).toEqual({ "url.full": "https://cdn.example/a.m3u8" });
  const crumb = streamed.beforeBreadcrumb({ message: "open https://bo.example/convite/SECRET-TOKEN", data: { to: "/convite/SECRET-TOKEN?y" } });
  expect(JSON.stringify(crumb)).not.toContain("SECRET-TOKEN");
  expect(streamed.beforeSendSpan._static).toBeUndefined();
});

test("replay recording events lose signed media queries and keep the words around a URL", () => {
  const recording = { type: 5, data: { tag: "performanceSpan", payload: { op: "resource.img", description: "https://cdn.example/cover.jpg?signature=SECRET", data: { url: "https://cdn.example/cover.jpg?signature=SECRET" } } } };
  expect(JSON.stringify(SkipSentryWeb.scrubRecordingEvent(recording))).not.toContain("SECRET");
  const consoleCrumb = { type: 5, data: { payload: { data: { arguments: ["/api/items?sig=SECRET failed with 503"] } } } };
  expect(SkipSentryWeb.scrubRecordingEvent(consoleCrumb).data.payload.data.arguments[0]).toBe("/api/items failed with 503");
  const snapshot = { type: 2, data: { node: { attributes: { href: "/keep?x" } } } };
  expect(SkipSentryWeb.scrubRecordingEvent(snapshot)).toBe(snapshot);
});

test("nesting does not let a URL through: deep strings are scrubbed, objects past the limit replaced", () => {
  let nested = { url: "https://bo.example/convite/SECRET-TOKEN?sig=SECRET" };
  for (let level = 0; level < 12; level++) nested = { level: nested };
  expect(JSON.stringify(SkipSentryWeb.scrubRecordingEvent({ type: 5, data: nested }))).not.toContain("SECRET");
  let deep = { url: "https://bo.example/convite/SECRET-TOKEN?sig=SECRET" };
  for (let level = 0; level < 40; level++) deep = { level: deep };
  const scrubbed = JSON.stringify(SkipSentryWeb.scrubRecordingEvent({ type: 5, data: deep }));
  expect(scrubbed).not.toContain("SECRET");
  expect(scrubbed).toContain("[Filtered]");
});

test("the replay event's page URLs lose queries and the path secret", () => {
  const replay = processors.reduce((event, processor) => processor(event), { type: "replay_event", urls: ["https://bo.example/convite/SECRET-TOKEN?x=1", "https://bo.example/obras"] });
  expect(replay.urls).toEqual(["https://bo.example/convite/[token]", "https://bo.example/obras"]);
});

test("an asynchronous beforeSend is awaited before the scrubbing, and its null still drops the event", async () => {
  SkipSentryWeb.start({ dsn: "https://k@o0.ingest.sentry.io/1", sendURLQueries: false, scrubURL, beforeSend: async (event) => (event.drop ? null : event) });
  const kept = await initOptions.beforeSend({ message: "GET https://example.test/reset?token=secret" });
  expect(kept.message).toBe("GET https://example.test/reset");
  expect(await initOptions.beforeSend({ drop: true })).toBeNull();
});

test("the static lifecycle runs the marked span callback and scrubs transactions", () => {
  SkipSentryWeb.start({ dsn: "https://k@o0.ingest.sentry.io/1", sendURLQueries: false, scrubURL, traceLifecycle: "static" });
  expect(initOptions.beforeSendSpan._static).toBe(true);
  expect(initOptions.beforeSendSpan({ description: "GET https://example.test/reset?token=secret", data: {} }).description).toBe("GET https://example.test/reset");
  const transaction = initOptions.beforeSendTransaction({
    transaction: "/convite/SECRET-TOKEN",
    request: { url: "https://bo.example/convite/SECRET-TOKEN?x=1", query_string: "x=1" },
    contexts: { trace: { data: { "url.full": "https://bo.example/a?sig=SECRET" } } },
    spans: [{ description: "GET https://cdn.example/a.m3u8?sig=SECRET", data: { "http.query": "sig=SECRET" } }],
  });
  expect(JSON.stringify(transaction)).not.toContain("SECRET");
});

test("a later start applies its environment and release, and does not initialize again", () => {
  client = { options: { environment: "page", release: "0" }, getOptions() { return this.options; } };
  initOptions = null;
  expect(SkipSentryWeb.start({ dsn: "https://k@o0.ingest.sentry.io/1", environment: "production", release: "1.2.0" })).toBe("already started");
  expect(initOptions).toBeNull();
  expect(client.options).toEqual({ environment: "production", release: "1.2.0" });
  expect(service.isEnabled()).toBe("true");
  client = null;
  expect(service.isEnabled()).toBe("false");
});

test("numbers from Swift arrive exactly, and breadcrumbs are cleared on the isolation scope", () => {
  service.metric(JSON.stringify({ kind: "gauge", key: "bytes", value: { $f64: "4202a05f20000000" } }));
  service.metric(JSON.stringify({ kind: "gauge", key: "tiny", value: { $f64: "3e7ad7f29abcaf48" } }));
  expect(calls).toEqual([["gauge", "bytes", 10_000_000_000], ["gauge", "tiny", 1e-7]]);
  service.clearBreadcrumbs();
  expect(cleared).toEqual(["isolation", "current"]);
});
