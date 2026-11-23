// The JSON payloads Sources/SkipSentryWeb sends to Web/Resources/skip-sentry.js. Embedded Swift has no Codable, and its
// floating-point printing is not relied on: values are encoded here when a field is made.

/// One member of a JSON object, its value already encoded.
struct JSONField {
    let name: String
    let encoded: String

    init(_ name: String, _ value: String) { self.name = name; encoded = JSON.string(value) }
    init(_ name: String, _ value: Bool) { self.name = name; encoded = value ? "true" : "false" }
    init(_ name: String, _ value: Double) { self.name = name; encoded = JSON.number(value) }
    init(_ name: String, _ value: [String]) {
        self.name = name
        encoded = "[" + value.map { JSON.string($0) }.joined(separator: ",") + "]"
    }
    init(_ name: String, _ value: [String: String]) {
        self.name = name
        encoded = JSON.object(value.sorted { $0.key < $1.key }.map { JSONField($0.key, $0.value) })
    }
}

enum JSON {
    static func object(_ fields: [JSONField]) -> String {
        "{" + fields.map { string($0.name) + ":" + $0.encoded }.joined(separator: ",") + "}"
    }

    static func string(_ value: String) -> String {
        var out = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += "\\u00" + hex(UInt8(scalar.value >> 4)) + hex(UInt8(scalar.value & 0xF))
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }

    /// A finite number with up to six decimals (sample rates, timeouts, metric values); `null` otherwise.
    static func number(_ value: Double) -> String {
        guard value.isFinite, value.magnitude < 9_000_000_000 else { return "null" }
        let scaled = Int64((value.magnitude * 1_000_000).rounded())
        var fraction = String(scaled % 1_000_000)
        while fraction.count < 6 { fraction = "0" + fraction }
        while fraction.hasSuffix("0") { fraction.removeLast() }
        let integer = String(scaled / 1_000_000)
        let sign = value < 0 && scaled != 0 ? "-" : ""
        return fraction.isEmpty ? sign + integer : sign + integer + "." + fraction
    }

    private static func hex(_ nibble: UInt8) -> String {
        let digits: [String] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"]
        return digits[Int(nibble)]
    }
}
