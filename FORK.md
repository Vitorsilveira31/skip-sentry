# Vitorsilveira31/skip-sentry

A maintained fork of [skiptools/skip-sentry](https://github.com/skiptools/skip-sentry) (Apache-2.0, the upstream's
license and attributions are unchanged) used by Novelo+. It follows upstream and keeps its own changes small and generic,
so they can be offered back.

| | |
|---|---|
| Upstream | `https://github.com/skiptools/skip-sentry`, remote `upstream` |
| Based on | upstream `main` at `8d89569` (captureFeedback, merged 2026-11-23) |
| Sentry Cocoa | `from: "9.8.0"` (resolves to the newest 9.x; 9.35.0 on 2026-11-23) |
| Sentry Android | `io.sentry:sentry-android:8.65.0` (upstream pins 8.43.0) |

## Changes from upstream

- `SkipSentryOptions.sendURLQueries` (default `true`, the SDKs' own behavior): `false` drops URL query strings and
  fragments from breadcrumbs, event requests and, on iOS, span data.
- Sentry Android 8.43.0 → 8.65.0.

## Syncing with upstream

```bash
git fetch upstream --tags
git switch main && git merge upstream/main      # never force-push main
swift test                                       # macOS tests plus XCSkipTests (Robolectric on Android)
```

Keep fork changes in their own commits, resolve conflicts in favor of upstream code unless a fork change needs the line,
and note each sync below.

## History

- 2026-11-23: forked at upstream `667c2c9`; `sendURLQueries`; Sentry Android 8.65.0. Tests: 13 on macOS, 12 transpiled
  on Android (Robolectric), all passing.
