# SkipSentry in the browser

With SwiftUIWeb's Embedded build (`SWIFTUIWEB_EMBEDDED`), `import SkipSentry` resolves to `Sources/SkipSentryWeb`: the
same public API, sent as fire-and-forget calls to the page service in `Resources/skip-sentry.js`, which drives Sentry's
browser SDK (`globalThis.Sentry`).

An application:

1. Copies Sentry's CDN bundle (for example `bundle.tracing.logs.metrics.min.js` from `browser.sentry-cdn.com`, version
   pinned) and `Resources/skip-sentry.js` into its own `Web/Resources`, so `script-src 'self'` allows them.
2. Loads both from `head.html`, deferred, before the app starts:

   ```html
   <script defer src="./sentry.js"></script>
   <script defer src="./skip-sentry.js"></script>
   ```

3. Starts the SDK either from the page, which also catches the errors that happen before the app runs:

   ```js
   SkipSentryWeb.start({ dsn, environment: "production", tracesSampleRate: 0.1, sendURLQueries: false });
   ```

   or from Swift with `SkipSentry.start { … }`. Only the first start initializes the SDK.
4. Allows the DSN's host in `connect-src` if its Content-Security-Policy restricts it.

`sendURLQueries: false` keeps only the path of the URLs the SDK records (and `scrubURL: (url) => …` lets the page redact secrets that live in paths, such as an invitation token) and turns off its collection of query strings,
headers, cookies, bodies and user details. SwiftUIWeb's `runtime-error` event (a WebAssembly trap it catches) is
reported as an unhandled `SwiftUIWebRuntimeError` with the trap's Swift frames. With Session Replay, pass
`beforeAddRecordingEvent: SkipSentryWeb.scrubRecordingEvent` to `replayIntegration` so recordings (resource timings of
images and videos) lose URL queries too. `bun test Web/test` checks the scrubbing against a stand-in SDK.

Browser differences: `beforeSend` is not called (filter in the page's `start` options), `capture(error:)` carries a
generic description (no reflection in Embedded Swift; use `capture(message:level:tags:extras:fingerprint:)` for
context), `crashedLastRun` is `nil` and `flush` does not wait.
