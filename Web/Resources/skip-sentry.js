// SkipSentry in the browser: the page service behind Sources/SkipSentryWeb (`BrowserService("skip-sentry")` in
// SwiftUIWeb). It drives Sentry's browser SDK, `globalThis.Sentry`, which the page loads from Sentry's CDN bundle
// (copied next to this file, for example as sentry.js, so the page's `script-src 'self'` policy allows it).
//
// `SkipSentryWeb.start(options)` starts the SDK once: call it from the page to catch the errors that happen before the
// app runs, or let Swift's `SkipSentry.start` do it. A later start only logs that the SDK already runs, so the SDK is
// never initialized twice. Options are Sentry's own plus `sendURLQueries: false`, which keeps only the path of every URL
// the SDK records and turns off its collection of query strings, headers, cookies, bodies and user details.
(() => {
  const sdk = () => globalThis.Sentry;
  // The page's own rule for secrets in URL paths (an invitation token in /convite/<token>, say), from `scrubURL`.
  let scrubPath = (url) => url;
  const withoutQuery = (url) => (typeof url === "string" ? scrubPath(url.replace(/[?#].*$/, "")) : url);
  const isURL = (value) => typeof value === "string" && /^(https?:\/\/|\/)/.test(value);
  const withoutQueries = (text) =>
    typeof text === "string" ? text.replace(/((?:https?:\/\/|\/)[^\s?#]*)([?#][^\s]*)?/g, (_, url) => scrubPath(url)) : text;
  // Session Replay's recording events (resource timings of images and videos among them) carry URLs no other hook sees.
  const scrubValue = (value, depth) => {
    if (typeof value === "string") return isURL(value) ? withoutQuery(value) : withoutQueries(value);
    if (depth > 8 || value === null || typeof value !== "object") return value;
    for (const key of Object.keys(value)) value[key] = scrubValue(value[key], depth + 1);
    return value;
  };
  // rrweb's custom events (type 5) hold Sentry's performance spans and breadcrumbs; DOM snapshots keep the SDK's masking.
  const scrubRecordingEvent = (event) => (event?.type === 5 ? scrubValue(event, 0) : event);
  const scrubAttributes = (attributes) => {
    if (!attributes) return;
    for (const key of Object.keys(attributes)) {
      if (/(^|\.)(query|fragment)$/.test(key)) delete attributes[key];
      else if (isURL(attributes[key])) attributes[key] = withoutQuery(attributes[key]);
    }
  };
  // Chains a hook after the page's own one of the same name (the page may filter too).
  const after = (first, second) => (first ? (value, hint) => { const kept = first(value, hint); return kept && second(kept, hint); } : second);

  function withoutURLQueries(options) {
    return {
      ...options,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: { request: false, response: false }, httpBodies: [], urlQueryParams: false, ...options.dataCollection },
      beforeBreadcrumb: after(options.beforeBreadcrumb, (breadcrumb) => {
        breadcrumb.message = withoutQueries(breadcrumb.message);
        for (const key of ["url", "from", "to"]) if (breadcrumb.data?.[key]) breadcrumb.data[key] = withoutQuery(breadcrumb.data[key]);
        return breadcrumb;
      }),
      // Streamed spans (the SDK's default) carry `attributes` and `name`, static ones `data` and `description`.
      beforeSendSpan: after(options.beforeSendSpan, (span) => {
        scrubAttributes(span.attributes);
        scrubAttributes(span.data);
        span.name = withoutQueries(span.name);
        span.description = withoutQueries(span.description);
        return span;
      }),
      beforeSendLog: after(options.beforeSendLog, (log) => {
        log.message = withoutQueries(log.message);
        scrubAttributes(log.attributes);
        return log;
      }),
      // URLs written into a message or an exception's text lose their queries too.
      beforeSend: after(options.beforeSend, (event) => {
        if (typeof event.message === "string") event.message = withoutQueries(event.message);
        if (event.logentry?.message) event.logentry.message = withoutQueries(event.logentry.message);
        for (const exception of event.exception?.values ?? []) exception.value = withoutQueries(exception.value);
        if (event.request) {
          event.request.url = withoutQuery(event.request.url);
          delete event.request.query_string;
        }
        return event;
      }),
    };
  }

  let listening = false;
  function start(options) {
    const Sentry = sdk();
    if (!Sentry) throw new Error("Sentry's browser SDK is not loaded (globalThis.Sentry)");
    if (Sentry.getClient()) return "already started";
    const { sendURLQueries = true, scrubURL, ...rest } = options ?? {};
    if (typeof scrubURL === "function") scrubPath = (url) => (typeof url === "string" ? scrubURL(url) : url);
    const integrations = rest.integrations ?? (rest.tracesSampleRate != null && Sentry.browserTracingIntegration ? [Sentry.browserTracingIntegration()] : []);
    Sentry.init(sendURLQueries ? { ...rest, integrations } : withoutURLQueries({ ...rest, integrations }));
    // SwiftUIWeb catches a WebAssembly trap or a failed commit itself and announces it with `runtime-error`; its detail
    // carries a redacted message and stack (the Swift frames of a trap), reported here as an unhandled error.
    if (!listening && typeof addEventListener === "function") {
      listening = true;
      addEventListener("runtime-error", ({ detail }) => {
        const error = new Error(detail?.message || "SwiftUIWeb runtime error");
        error.name = "SwiftUIWebRuntimeError";
        error.stack = detail?.stack || `${error.name}: ${error.message}`;
        sdk()?.captureException(error, { mechanism: { type: "swiftuiweb.runtime-error", handled: false } });
      });
    }
    return "started";
  }

  const parse = (payload) => (payload ? JSON.parse(payload) : {});
  // `scrubRecordingEvent` is for `Sentry.replayIntegration({ beforeAddRecordingEvent })`: with `sendURLQueries: false`,
  // replays lose URL queries (and `scrubURL`'s path secrets) like every other payload.
  globalThis.SkipSentryWeb = { start, scrubRecordingEvent };
  (globalThis.SwiftUIWebServices ??= { queue: [], define(name, factory) { this.queue.push([name, factory]); } })
    .define("skip-sentry", () => ({
      start: (payload) => start(parse(payload)),
      close: () => sdk()?.close(),
      captureException(payload) {
        const { type, value, fingerprint } = parse(payload);
        const error = new Error(value);
        error.name = type || "Error";
        sdk()?.captureException(error, fingerprint ? { fingerprint } : undefined);
      },
      // An event rather than `captureMessage`, which attaches a synthetic JavaScript stack whose top frame (this
      // service) Sentry would then use as the issue's title instead of the message.
      captureMessage(payload) {
        const { message, level, tags, extras, fingerprint } = parse(payload);
        sdk()?.captureEvent({ message, level, tags, extra: extras, fingerprint: fingerprint?.length ? fingerprint : undefined });
      },
      log(payload) {
        const { message, level, attributes } = parse(payload);
        sdk()?.logger?.[level]?.(message, attributes);
      },
      metric(payload) {
        const { kind, key, value, unit, attributes } = parse(payload);
        sdk()?.metrics?.[kind]?.(key, value, { unit, attributes });
      },
      addBreadcrumb: (payload) => sdk()?.addBreadcrumb(parse(payload)),
      clearBreadcrumbs: () => sdk()?.getCurrentScope?.().clearBreadcrumbs(),
      setUser: (payload) => sdk()?.setUser(payload === "null" ? null : parse(payload)),
      setTag(payload) { const { key, value } = parse(payload); sdk()?.setTag(key, value); },
      removeTag(payload) { const { key } = parse(payload); sdk()?.setTag(key, undefined); },
      setExtra(payload) { const { key, value } = parse(payload); sdk()?.setExtra(key, value); },
      setLevel(payload) { const { level } = parse(payload); sdk()?.getCurrentScope?.().setLevel(level); },
      flush(payload) { const { timeout } = parse(payload); return sdk()?.flush((timeout ?? 5) * 1000).then(() => ""); },
    }));
})();
