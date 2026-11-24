// SkipSentry in the browser: the page service behind Sources/SkipSentryWeb (`BrowserService("skip-sentry")` in
// SwiftUIWeb). It drives Sentry's browser SDK, `globalThis.Sentry`, which the page loads from Sentry's CDN bundle
// (copied next to this file, for example as sentry.js, so the page's `script-src 'self'` policy allows it).
//
// `SkipSentryWeb.start(options)` starts the SDK once: call it from the page to catch the errors that happen before the
// app runs, or let Swift's `SkipSentry.start` do it. A later start never initializes the SDK again; it only applies its
// `environment` and `release` to the events sent after it. Options are Sentry's own plus `sendURLQueries: false`, which
// keeps only the path of every URL the SDK records (also in transactions, spans, logs, and Session Replay's events,
// metadata and the URL attributes of its DOM snapshots: href, src, srcset, ...) and turns off
// its collection of query strings, headers, cookies, bodies and user details, and `scrubURL`, the page's rule for
// secrets in URL paths.
(() => {
  const sdk = () => globalThis.Sentry;
  // The page's own rule for secrets in URL paths (an invitation token in /convite/<token>, say), from `scrubURL`.
  let scrubPath = (url) => url;
  const withoutQuery = (url) => (typeof url === "string" ? scrubPath(url.replace(/[?#].*$/, "")) : url);
  // A whole URL or path, nothing else: text that merely starts with one keeps the words after it.
  const isURL = (value) => typeof value === "string" && /^(https?:\/\/|\/)\S*$/.test(value);
  const withoutQueries = (text) =>
    typeof text === "string" ? text.replace(/((?:https?:\/\/|\/)[^\s?#]*)([?#][^\s]*)?/g, (_, url) => scrubPath(url)) : text;
  const scrubText = (text) => (isURL(text) ? withoutQuery(text) : withoutQueries(text));
  // Session Replay's recording events (resource timings of images and videos among them, console arguments) carry URLs
  // no other hook sees. Strings are scrubbed at any depth; an object deeper than the limit (far past the levels Replay
  // keeps) is replaced, never passed on unscrubbed.
  const MAX_DEPTH = 32;
  const scrubValue = (value, depth, seen) => {
    if (typeof value === "string") return scrubText(value);
    if (value === null || typeof value !== "object") return value;
    if (depth > MAX_DEPTH) return "[Filtered]";
    if (seen.has(value)) return value;
    seen.add(value);
    for (const key of Object.keys(value)) value[key] = scrubValue(value[key], depth + 1, seen);
    return value;
  };
  // DOM snapshots (rrweb types 2 and 3) keep the SDK's text masking, but Replay masks no `href` or `src`: the URL
  // attributes of every recorded element lose their queries (each candidate of a srcset too). Text content is left.
  const URL_ATTRIBUTES = new Set(["href", "src", "srcset", "action", "formaction", "poster", "cite", "data", "background", "xlink:href"]);
  const scrubURLAttribute = (name, value) =>
    name === "srcset"
      ? value.split(",").map((candidate) => { const [url, ...descriptor] = candidate.trim().split(/\s+/); return [withoutQuery(url), ...descriptor].join(" "); }).join(", ")
      : scrubText(value);
  const scrubElementAttributes = (attributes) => {
    if (!attributes || typeof attributes !== "object") return;
    for (const name of Object.keys(attributes)) {
      if (typeof attributes[name] === "string" && URL_ATTRIBUTES.has(name.toLowerCase())) attributes[name] = scrubURLAttribute(name.toLowerCase(), attributes[name]);
    }
  };
  const scrubNodes = (root) => {
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      scrubElementAttributes(node.attributes);
      if (Array.isArray(node.childNodes)) stack.push(...node.childNodes);
    }
  };
  const scrubSnapshot = (event) => {
    if (event.type === 2) scrubNodes(event.data?.node);
    // An incremental mutation (source 0): the nodes it adds and the attributes it changes.
    else if (event.data?.source === 0) {
      for (const added of event.data.adds ?? []) scrubNodes(added?.node);
      for (const change of event.data.attributes ?? []) scrubElementAttributes(change?.attributes);
    }
    return event;
  };
  // rrweb's custom events (type 5) hold Sentry's performance spans and breadcrumbs, its snapshots (2 and 3) the DOM.
  const scrubRecordingEvent = (event) =>
    event?.type === 5 ? scrubValue(event, 0, new WeakSet()) : event?.type === 2 || event?.type === 3 ? scrubSnapshot(event) : event;
  const scrubAttributes = (attributes) => {
    if (!attributes) return;
    for (const key of Object.keys(attributes)) {
      if (/(^|\.)(query|fragment)$/.test(key)) delete attributes[key];
      else if (typeof attributes[key] === "string") attributes[key] = scrubText(attributes[key]);
    }
  };
  const scrubRequest = (request) => {
    if (!request) return;
    request.url = withoutQuery(request.url);
    delete request.query_string;
  };
  // Chains a hook after the page's own one of the same name (the page may filter too). The page's hook may answer with
  // a promise (Sentry awaits `beforeSend` and `beforeSendTransaction`): the scrubbing then runs on what it resolves to.
  // A null answer still drops the event.
  const after = (first, second) =>
    first
      ? (value, hint) => {
          const kept = first(value, hint);
          if (kept && typeof kept.then === "function") return kept.then((resolved) => resolved && second(resolved, hint));
          return kept && second(kept, hint);
        }
      : second;

  function withoutURLQueries(options, Sentry) {
    // Streamed spans (the SDK's default) carry `attributes` and `name`, static ones `data` and `description`.
    const scrubSpan = (span) => {
      scrubAttributes(span.attributes);
      scrubAttributes(span.data);
      span.name = withoutQueries(span.name);
      span.description = withoutQueries(span.description);
      return span;
    };
    let beforeSendSpan = after(options.beforeSendSpan, scrubSpan);
    // With `traceLifecycle: "static"` the SDK runs only a span callback marked by `withStaticSpan`.
    if (options.traceLifecycle === "static" && typeof Sentry.withStaticSpan === "function") beforeSendSpan = Sentry.withStaticSpan(beforeSendSpan);
    return {
      ...options,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: { request: false, response: false }, httpBodies: [], urlQueryParams: false, ...options.dataCollection },
      beforeBreadcrumb: after(options.beforeBreadcrumb, (breadcrumb) => {
        breadcrumb.message = withoutQueries(breadcrumb.message);
        for (const key of ["url", "from", "to"]) if (breadcrumb.data?.[key]) breadcrumb.data[key] = withoutQuery(breadcrumb.data[key]);
        return breadcrumb;
      }),
      beforeSendSpan,
      // Transactions (the static lifecycle sends them as events): their name, request, spans and trace data.
      beforeSendTransaction: after(options.beforeSendTransaction, (event) => {
        event.transaction = withoutQueries(event.transaction);
        scrubRequest(event.request);
        scrubAttributes(event.contexts?.trace?.data);
        for (const span of event.spans ?? []) scrubSpan(span);
        return event;
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
        scrubRequest(event.request);
        return event;
      }),
    };
  }

  let listening = false;
  function start(options) {
    const Sentry = sdk();
    if (!Sentry) throw new Error("Sentry's browser SDK is not loaded (globalThis.Sentry)");
    const client = Sentry.getClient();
    if (client) {
      // The events after a later start carry its environment and release (the SDK reads them from its options).
      const current = client.getOptions?.();
      if (current && options?.environment) current.environment = options.environment;
      if (current && options?.release) current.release = options.release;
      return "already started";
    }
    const { sendURLQueries = true, scrubURL, ...rest } = options ?? {};
    if (typeof scrubURL === "function") scrubPath = (url) => (typeof url === "string" ? scrubURL(url) : url);
    const integrations = rest.integrations ?? (rest.tracesSampleRate != null && Sentry.browserTracingIntegration ? [Sentry.browserTracingIntegration()] : []);
    Sentry.init(sendURLQueries ? { ...rest, integrations } : withoutURLQueries({ ...rest, integrations }, Sentry));
    // Session Replay's own event lists the page URLs the replay saw (`urls`): the same policy applies to them.
    if (!sendURLQueries && typeof Sentry.addEventProcessor === "function") {
      Sentry.addEventProcessor((event) => {
        if (event?.type === "replay_event") {
          if (Array.isArray(event.urls)) event.urls = event.urls.map(withoutQuery);
          scrubRequest(event.request);
        }
        return event;
      });
    }
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

  // Swift sends each Double as its bit pattern (Sources/SkipSentryWeb/JSON.swift), so no value is rounded on the way.
  // Only the fields Swift fills with a Double are read that way: a dictionary of the app's own (tags, extras,
  // attributes) that happens to look like a marker stays as it is.
  const NUMERIC_FIELDS = new Set(["value", "timeout", "sampleRate", "tracesSampleRate", "profilesSampleRate", "replaysSessionSampleRate", "replaysOnErrorSampleRate"]);
  const f64 = (hex) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, BigInt(`0x${hex}`));
    return view.getFloat64(0);
  };
  const exact = (key, value) =>
    NUMERIC_FIELDS.has(key) && value && typeof value === "object" && Object.keys(value).length === 1 && /^[0-9a-f]{16}$/.test(value.$f64)
      ? f64(value.$f64)
      : value;
  const parse = (payload) => (payload ? JSON.parse(payload, exact) : {});
  // `scrubRecordingEvent` is for `Sentry.replayIntegration({ beforeAddRecordingEvent })`: with `sendURLQueries: false`,
  // replays lose URL queries (and `scrubURL`'s path secrets) like every other payload.
  globalThis.SkipSentryWeb = { start, scrubRecordingEvent };
  (globalThis.SwiftUIWebServices ??= { queue: [], define(name, factory) { this.queue.push([name, factory]); } })
    .define("skip-sentry", () => ({
      start: (payload) => start(parse(payload)),
      // The SDK's own answer (its `enabled` option and a transport), not only whether a client exists.
      isEnabled: () => {
        const Sentry = sdk();
        const enabled = typeof Sentry?.isEnabled === "function" ? Sentry.isEnabled() : !!Sentry?.getClient?.();
        return enabled ? "true" : "false";
      },
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
      captureFeedback(payload) {
        const { message, name, email, associatedEventId } = parse(payload);
        sdk()?.captureFeedback?.({ message, name, email, associatedEventId });
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
      // `addBreadcrumb` writes to the isolation scope (Sentry 8 and later): clear that one, and the current scope too.
      clearBreadcrumbs: () => {
        sdk()?.getIsolationScope?.().clearBreadcrumbs();
        sdk()?.getCurrentScope?.().clearBreadcrumbs();
      },
      setUser: (payload) => sdk()?.setUser(payload === "null" ? null : parse(payload)),
      setTag(payload) { const { key, value } = parse(payload); sdk()?.setTag(key, value); },
      removeTag(payload) { const { key } = parse(payload); sdk()?.setTag(key, undefined); },
      setExtra(payload) { const { key, value } = parse(payload); sdk()?.setExtra(key, value); },
      setLevel(payload) { const { level } = parse(payload); sdk()?.getCurrentScope?.().setLevel(level); },
      flush(payload) { const { timeout } = parse(payload); return sdk()?.flush((timeout ?? 5) * 1000).then(() => ""); },
    }));
})();
