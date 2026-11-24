# SkipSentry in the browser

With SwiftUIWeb's Embedded build (`SWIFTUIWEB_EMBEDDED`), `import SkipSentry` resolves to `Sources/SkipSentryWeb`: the
same public API, sent as fire-and-forget calls to the page service in `Resources/skip-sentry.js`, which drives Sentry's
browser SDK (`globalThis.Sentry`).

The browser files ship with this package, in `Web/Resources/`: `skip-sentry.js`, Sentry's own SDK as two of its CDN
bundles (@sentry/browser 11.16.0, as published on `browser.sentry-cdn.com`): `sentry.tracing.js`
(`bundle.tracing.logs.metrics.min.js`) and `sentry.tracing.replay.js` (`bundle.tracing.replay.logs.metrics.min.js`, with
Session Replay), and `head.html`, which loads `skip-sentry.js`, deferred. SwiftUIWeb's browser build copies a local
package dependency's `Web/Resources/` into the application's bundle and puts its `head.html` before the application's,
so an application keeps no copies.

An application:

1. Depends on this package through a local path in its browser manifest (`.package(path: "../skip-sentry")`).
2. Loads the SDK bundle it needs from its own `head.html`, deferred, before the script that starts it (the package's
   fragment comes first, so `SkipSentryWeb` exists by then):

   ```html
   <script defer src="./sentry.tracing.js"></script>
   <script defer src="./sentry-init.js"></script>
   ```

3. Starts the SDK either from the page, which also catches the errors that happen before the app runs:

   ```js
   SkipSentryWeb.start({ dsn, environment: "production", tracesSampleRate: 0.1, sendURLQueries: false });
   ```

   or from Swift with `SkipSentry.start { … }`. Only the first start initializes the SDK; a later one applies its
   `environment` and `release` to the events after it.
4. Allows the DSN's host in `connect-src` if its Content-Security-Policy restricts it.

`sendURLQueries: false` keeps only the path of the URLs the SDK records (and `scrubURL: (url) => …` lets the page redact secrets that live in paths, such as an invitation token) and turns off its collection of query strings,
headers, cookies, bodies and user details. SwiftUIWeb's `runtime-error` event (a WebAssembly trap it catches) is
reported as an unhandled `SwiftUIWebRuntimeError` with the trap's Swift frames. With Session Replay, pass
`beforeAddRecordingEvent: SkipSentryWeb.scrubRecordingEvent` to `replayIntegration` so recordings lose URL queries too:
resource timings of images and videos, console arguments, and the URL attributes of the DOM snapshots (`href`, `src`,
`srcset`, `action`, `poster`, ...). With `sendURLQueries: false` the replay's own list of page URLs follows the same
policy. Text in the page keeps Replay's own masking. `cd Web && bun test` checks the scrubbing and the calls against a stand-in SDK.

Browser differences: `beforeSend` is not called (filter in the page's `start` options), `capture(error:)` carries a
generic description (no reflection in Embedded Swift; use `capture(message:level:tags:extras:fingerprint:)` for
context), `crashedLastRun` is `nil`, `flush` does not wait, and `isEnabled` is the page SDK's own answer, `false` until
it has arrived (after a start, or shortly after the first read). Numbers go to the page as their bit patterns, so a
metric of any size arrives exactly.
