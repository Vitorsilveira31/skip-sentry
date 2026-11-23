// The page service's URL scrubbing, against a stand-in for Sentry's SDK: `bun test Web/test`.
import { expect, test } from "bun:test";

let initOptions = null;
globalThis.Sentry = { getClient: () => null, init: (options) => { initOptions = options; }, browserTracingIntegration: () => ({}) };
globalThis.SwiftUIWebServices = { queue: [], define() {} };
await import("../Resources/skip-sentry.js");
SkipSentryWeb.start({ dsn: "https://k@o0.ingest.sentry.io/1", sendURLQueries: false, scrubURL: (url) => url.replace(/(\/convite\/)[^/?#\s]+/g, "$1[token]") });

test("a request URL loses its query and the path secret the page names", () => {
  const event = initOptions.beforeSend({ request: { url: "https://bo.example/convite/SECRET-TOKEN?x=1", query_string: "x=1" } });
  expect(event.request.url).toBe("https://bo.example/convite/[token]");
  expect(event.request.query_string).toBeUndefined();
});

test("span names, attributes and breadcrumbs lose both", () => {
  const span = initOptions.beforeSendSpan({ name: "/convite/SECRET-TOKEN", attributes: { "url.full": "https://cdn.example/a.m3u8?sig=S", "url.query": "sig=S" } });
  expect(span.name).toBe("/convite/[token]");
  expect(span.attributes).toEqual({ "url.full": "https://cdn.example/a.m3u8" });
  const crumb = initOptions.beforeBreadcrumb({ message: "open https://bo.example/convite/SECRET-TOKEN", data: { to: "/convite/SECRET-TOKEN?y" } });
  expect(JSON.stringify(crumb)).not.toContain("SECRET-TOKEN");
});

test("replay recording events lose signed media queries", () => {
  const recording = { type: 5, data: { tag: "performanceSpan", payload: { op: "resource.img", description: "https://cdn.example/cover.jpg?signature=SECRET", data: { url: "https://cdn.example/cover.jpg?signature=SECRET" } } } };
  expect(JSON.stringify(SkipSentryWeb.scrubRecordingEvent(recording))).not.toContain("SECRET");
  const snapshot = { type: 2, data: { node: { attributes: { href: "/keep?x" } } } };
  expect(SkipSentryWeb.scrubRecordingEvent(snapshot)).toBe(snapshot);
});
