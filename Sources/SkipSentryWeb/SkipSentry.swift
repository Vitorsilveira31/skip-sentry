// SkipSentry for the browser (SwiftUIWeb, https://github.com/Vitorsilveira31/SwiftUIWeb). The same public API as
// Sources/SkipSentry drives Sentry's browser SDK through a page service: Swift calls `BrowserService("skip-sentry")`
// and Web/Resources/skip-sentry.js forwards each call to `globalThis.Sentry` (Sentry's CDN bundle, which the page
// loads). Calls are fire-and-forget; payloads are JSON built here, since Embedded Swift has no Codable.
import SwiftUIWebBrowserIO
import WebFoundation

/// Severity levels for Sentry events.
public enum SkipSentryLevel: String {
    case debug
    case info
    case warning
    case error
    case fatal
}

/// Severity levels for Sentry structured logs.
public enum SkipSentryLogLevel: String {
    case trace
    case debug
    case info
    case warn
    case error
    case fatal
}

/// Cross-platform Sentry facade; see the native implementation for the documentation of each call. Browser specifics:
/// `beforeSend` is not called (the browser SDK filters in JavaScript), `capture(error:)` carries a generic description
/// (the browser build has no reflection to describe an arbitrary error; prefer `capture(message:level:tags:extras:fingerprint:)`
/// for context), `crashedLastRun` is `nil`, and `flush` does not wait.
public class SkipSentry {
    private static let service = BrowserService("skip-sentry")
    nonisolated(unsafe) private static var started = false

    public static func start(dsn: String? = nil, debug: Bool = false) {
        start { options in
            options.dsn = dsn
            options.debug = debug
        }
    }

    /// Starts the browser SDK unless the page already did (an early start in the page catches the errors that happen
    /// before the app runs; see Web/README.md): then only the scope set here (environment, release) is applied.
    public static func start(configure: @escaping (SkipSentryOptions) -> Void) {
        let options = SkipSentryOptions()
        configure(options)
        started = options.dsn != nil
        service.send("start", options.json)
    }

    public static var isEnabled: Bool { started }

    public static func close() {
        started = false
        service.send("close")
    }

    public static func capture(error: Error, fingerprint: String? = nil) {
        var fields = [JSONField("type", "SwiftError"), JSONField("value", error.localizedDescription)]
        if let fingerprint { fields.append(JSONField("fingerprint", [fingerprint])) }
        service.send("captureException", JSON.object(fields))
    }

    public static func capture(message: String, level: SkipSentryLevel = .info) {
        capture(message: message, level: level, tags: [:], extras: [:], fingerprint: [])
    }

    public static func capture(message: String, level: SkipSentryLevel, tags: [String: String], extras: [String: String], fingerprint: [String]) {
        service.send("captureMessage", JSON.object([
            JSONField("message", message), JSONField("level", level.rawValue), JSONField("tags", tags),
            JSONField("extras", extras), JSONField("fingerprint", fingerprint)
        ]))
    }

    public static func log(_ message: String, level: SkipSentryLogLevel, attributes: [String: String] = [:]) {
        service.send("log", JSON.object([JSONField("message", message), JSONField("level", level.rawValue), JSONField("attributes", attributes)]))
    }

    public static func count(_ key: String, value: Int = 1, attributes: [String: String] = [:]) {
        metric("count", key, Double(value), nil, attributes)
    }

    public static func distribution(_ key: String, value: Double, unit: String? = nil, attributes: [String: String] = [:]) {
        metric("distribution", key, value, unit, attributes)
    }

    public static func gauge(_ key: String, value: Double, unit: String? = nil, attributes: [String: String] = [:]) {
        metric("gauge", key, value, unit, attributes)
    }

    private static func metric(_ kind: String, _ key: String, _ value: Double, _ unit: String?, _ attributes: [String: String]) {
        var fields = [JSONField("kind", kind), JSONField("key", key), JSONField("value", value), JSONField("attributes", attributes)]
        if let unit { fields.append(JSONField("unit", unit)) }
        service.send("metric", JSON.object(fields))
    }

    public static func addBreadcrumb(message: String) {
        addBreadcrumb(message: message, category: "default", level: .info, data: [:])
    }

    public static func addBreadcrumb(message: String, category: String, level: SkipSentryLevel = .info) {
        addBreadcrumb(message: message, category: category, level: level, data: [:])
    }

    public static func addBreadcrumb(message: String, category: String, level: SkipSentryLevel = .info, data: [String: String]) {
        service.send("addBreadcrumb", JSON.object([
            JSONField("message", message), JSONField("category", category), JSONField("level", level.rawValue), JSONField("data", data)
        ]))
    }

    public static func clearBreadcrumbs() { service.send("clearBreadcrumbs") }

    public static func setUser(id: String? = nil, email: String? = nil, username: String? = nil) {
        var fields: [JSONField] = []
        if let id { fields.append(JSONField("id", id)) }
        if let email { fields.append(JSONField("email", email)) }
        if let username { fields.append(JSONField("username", username)) }
        service.send("setUser", JSON.object(fields))
    }

    public static func clearUser() { service.send("setUser", "null") }

    public static func setTag(key: String, value: String) {
        service.send("setTag", JSON.object([JSONField("key", key), JSONField("value", value)]))
    }

    public static func removeTag(key: String) {
        service.send("removeTag", JSON.object([JSONField("key", key)]))
    }

    public static func setExtra(key: String, value: String) {
        service.send("setExtra", JSON.object([JSONField("key", key), JSONField("value", value)]))
    }

    public static func setLevel(_ level: SkipSentryLevel) {
        service.send("setLevel", JSON.object([JSONField("level", level.rawValue)]))
    }

    public static func flush(timeout: Double = 5.0) {
        service.send("flush", JSON.object([JSONField("timeout", timeout)]))
    }

    public static var crashedLastRun: Bool? { nil }
}

/// Configuration options for initializing Sentry (the same properties as on iOS and Android; the browser uses the
/// ones its SDK has: dsn, debug, environment, release, dist, sampleRate, tracesSampleRate, enableLogs,
/// tracePropagationTargets and sendURLQueries).
public class SkipSentryOptions {
    public var dsn: String?
    public var debug: Bool = false
    public var environment: String?
    public var release: String?
    public var dist: String?
    public var sampleRate: Double?
    public var tracesSampleRate: Double?
    public var enableAutoSessionTracking: Bool = true
    public var sessionTrackingIntervalMillis: Int?
    public var attachStacktrace: Bool = true
    public var enableAppHangTracking: Bool = true
    public var isReportHistoricalTombstones: Bool = true
    public var enableLogs: Bool = false
    public var enableMetrics: Bool = true
    public var tracePropagationTargets: [String]?
    public var droppedFailedRequestHosts: [String] = []
    public var sendURLQueries: Bool = true
    /// Not called in the browser: filter there in JavaScript (`beforeSend` of the page's early start).
    public var beforeSend: ((SkipSentryEvent) -> SkipSentryEvent?)?

    public init() { }

    var json: String {
        var fields = [JSONField("debug", debug), JSONField("enableLogs", enableLogs), JSONField("sendURLQueries", sendURLQueries)]
        if let dsn { fields.append(JSONField("dsn", dsn)) }
        if let environment { fields.append(JSONField("environment", environment)) }
        if let release { fields.append(JSONField("release", release)) }
        if let dist { fields.append(JSONField("dist", dist)) }
        if let sampleRate { fields.append(JSONField("sampleRate", sampleRate)) }
        if let tracesSampleRate { fields.append(JSONField("tracesSampleRate", tracesSampleRate)) }
        if let tracePropagationTargets { fields.append(JSONField("tracePropagationTargets", tracePropagationTargets)) }
        return JSON.object(fields)
    }
}

/// A Sentry event as `beforeSend` sees it on iOS and Android (kept here so shared code compiles for the browser).
public struct SkipSentryEvent {
    public var message: String?
    public var level: SkipSentryLevel?
    public var exceptions: [SkipSentryException]
    public var exceptionValues: [String] { exceptions.compactMap { $0.value } }

    public init(message: String? = nil, level: SkipSentryLevel? = nil, exceptions: [SkipSentryException] = []) {
        self.message = message
        self.level = level
        self.exceptions = exceptions
    }
}

public struct SkipSentryException {
    public var type: String?
    public var value: String?

    public init(type: String? = nil, value: String? = nil) {
        self.type = type
        self.value = value
    }
}
