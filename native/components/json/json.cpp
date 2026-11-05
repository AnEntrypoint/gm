#include "gm/json.hpp"

#include <charconv>
#include <cmath>

namespace gm::json {

namespace {

const std::string kEmptyString;
const Array kEmptyArray;
const Object kEmptyObject;
constexpr int kMaxDepth = 512;

void append_utf8(std::string& out, std::uint32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    }
}

class Parser {
public:
    explicit Parser(std::string_view text) : text_(text) {}

    deoxidene::Result<Value, std::string> document() {
        skip_space();
        auto value = parse_value(0);
        if (!value) return value;
        skip_space();
        if (pos_ != text_.size()) return fail("unexpected trailing text");
        return value;
    }

private:
    std::string_view text_;
    std::size_t pos_ = 0;

    deoxidene::Result<Value, std::string> fail(const std::string& what) const {
        return deoxidene::Err<std::string>{what + " at byte " + std::to_string(pos_)};
    }

    void skip_space() {
        while (pos_ < text_.size()) {
            char c = text_[pos_];
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') break;
            ++pos_;
        }
    }

    bool take(std::string_view word) {
        if (text_.substr(pos_, word.size()) != word) return false;
        pos_ += word.size();
        return true;
    }

    deoxidene::Result<Value, std::string> parse_value(int depth) {
        if (depth > kMaxDepth) return fail("nesting too deep");
        if (pos_ >= text_.size()) return fail("unexpected end of input");
        char c = text_[pos_];
        switch (c) {
            case '{': return parse_object(depth);
            case '[': return parse_array(depth);
            case '"': {
                auto s = parse_string();
                if (!s) return deoxidene::Err<std::string>{s.error()};
                return Value(std::move(*s));
            }
            case 't':
                if (take("true")) return Value(true);
                return fail("invalid literal");
            case 'f':
                if (take("false")) return Value(false);
                return fail("invalid literal");
            case 'n':
                if (take("null")) return Value();
                return fail("invalid literal");
            default:
                if (c == '-' || (c >= '0' && c <= '9')) return parse_number();
                return fail("unexpected character");
        }
    }

    deoxidene::Result<Value, std::string> parse_number() {
        std::size_t start = pos_;
        if (text_[pos_] == '-') ++pos_;
        if (pos_ >= text_.size()) return fail("invalid number");
        if (text_[pos_] == '0') {
            ++pos_;
        } else if (text_[pos_] >= '1' && text_[pos_] <= '9') {
            while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') ++pos_;
        } else {
            return fail("invalid number");
        }
        if (pos_ < text_.size() && text_[pos_] == '.') {
            ++pos_;
            std::size_t digits = pos_;
            while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') ++pos_;
            if (pos_ == digits) return fail("invalid number");
        }
        if (pos_ < text_.size() && (text_[pos_] == 'e' || text_[pos_] == 'E')) {
            ++pos_;
            if (pos_ < text_.size() && (text_[pos_] == '+' || text_[pos_] == '-')) ++pos_;
            std::size_t digits = pos_;
            while (pos_ < text_.size() && text_[pos_] >= '0' && text_[pos_] <= '9') ++pos_;
            if (pos_ == digits) return fail("invalid number");
        }
        double number = 0;
        auto res = std::from_chars(text_.data() + start, text_.data() + pos_, number);
        if (res.ec == std::errc::result_out_of_range) {
            number = text_[start] == '-' ? -HUGE_VAL : HUGE_VAL;
            if (std::fabs(number) == HUGE_VAL && res.ptr == text_.data() + pos_) {
                bool tiny = false;
                for (std::size_t i = start; i < pos_; ++i) {
                    if (text_[i] == 'e' || text_[i] == 'E') {
                        tiny = i + 1 < pos_ && text_[i + 1] == '-';
                        break;
                    }
                }
                if (tiny) number = 0;
            }
        } else if (res.ec != std::errc()) {
            return fail("invalid number");
        }
        return Value(number);
    }

    deoxidene::Result<std::uint32_t, std::string> hex4() {
        if (pos_ + 4 > text_.size()) {
            return deoxidene::Err<std::string>{"truncated unicode escape at byte " + std::to_string(pos_)};
        }
        std::uint32_t v = 0;
        for (int i = 0; i < 4; ++i) {
            char c = text_[pos_ + i];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= static_cast<std::uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') v |= static_cast<std::uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= static_cast<std::uint32_t>(c - 'A' + 10);
            else return deoxidene::Err<std::string>{"invalid unicode escape at byte " + std::to_string(pos_ + i)};
        }
        pos_ += 4;
        return v;
    }

    deoxidene::Result<std::string, std::string> parse_string() {
        ++pos_;
        std::string out;
        for (;;) {
            if (pos_ >= text_.size()) {
                return deoxidene::Err<std::string>{"unterminated string at byte " + std::to_string(pos_)};
            }
            unsigned char c = static_cast<unsigned char>(text_[pos_]);
            if (c == '"') {
                ++pos_;
                return out;
            }
            if (c < 0x20) {
                return deoxidene::Err<std::string>{"control character in string at byte " + std::to_string(pos_)};
            }
            if (c != '\\') {
                out.push_back(static_cast<char>(c));
                ++pos_;
                continue;
            }
            ++pos_;
            if (pos_ >= text_.size()) {
                return deoxidene::Err<std::string>{"unterminated string at byte " + std::to_string(pos_)};
            }
            char e = text_[pos_++];
            switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    auto hi = hex4();
                    if (!hi) return deoxidene::Err<std::string>{hi.error()};
                    std::uint32_t cp = *hi;
                    if (cp >= 0xD800 && cp <= 0xDBFF && text_.substr(pos_, 2) == "\\u") {
                        std::size_t save = pos_;
                        pos_ += 2;
                        auto lo = hex4();
                        if (lo && *lo >= 0xDC00 && *lo <= 0xDFFF) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (*lo - 0xDC00);
                        } else {
                            pos_ = save;
                        }
                    }
                    if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0xFFFD;
                    append_utf8(out, cp);
                    break;
                }
                default:
                    return deoxidene::Err<std::string>{"invalid escape at byte " + std::to_string(pos_ - 1)};
            }
        }
    }

    deoxidene::Result<Value, std::string> parse_array(int depth) {
        ++pos_;
        Array items;
        skip_space();
        if (pos_ < text_.size() && text_[pos_] == ']') {
            ++pos_;
            return Value(std::move(items));
        }
        for (;;) {
            skip_space();
            auto item = parse_value(depth + 1);
            if (!item) return item;
            items.push_back(std::move(*item));
            skip_space();
            if (pos_ >= text_.size()) return fail("unterminated array");
            if (text_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (text_[pos_] == ']') {
                ++pos_;
                return Value(std::move(items));
            }
            return fail("expected , or ]");
        }
    }

    deoxidene::Result<Value, std::string> parse_object(int depth) {
        ++pos_;
        Value object = Object{};
        skip_space();
        if (pos_ < text_.size() && text_[pos_] == '}') {
            ++pos_;
            return object;
        }
        for (;;) {
            skip_space();
            if (pos_ >= text_.size() || text_[pos_] != '"') return fail("expected string key");
            auto key = parse_string();
            if (!key) return deoxidene::Err<std::string>{key.error()};
            skip_space();
            if (pos_ >= text_.size() || text_[pos_] != ':') return fail("expected :");
            ++pos_;
            skip_space();
            auto value = parse_value(depth + 1);
            if (!value) return value;
            object.set(std::move(*key), std::move(*value));
            skip_space();
            if (pos_ >= text_.size()) return fail("unterminated object");
            if (text_[pos_] == ',') {
                ++pos_;
                continue;
            }
            if (text_[pos_] == '}') {
                ++pos_;
                return object;
            }
            return fail("expected , or }");
        }
    }
};

void dump_number(std::string& out, double n) {
    if (!std::isfinite(n)) {
        out += "null";
        return;
    }
    char buf[64];
    if (n == std::floor(n) && std::fabs(n) < 1e15) {
        auto res = std::to_chars(buf, buf + sizeof buf, static_cast<std::int64_t>(n));
        out.append(buf, res.ptr);
        return;
    }
    auto res = std::to_chars(buf, buf + sizeof buf, n);
    out.append(buf, res.ptr);
}

void quote_into(std::string& out, std::string_view s) {
    static const char hex[] = "0123456789abcdef";
    out.push_back('"');
    for (char ch : s) {
        unsigned char c = static_cast<unsigned char>(ch);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    out += "\\u00";
                    out.push_back(hex[c >> 4]);
                    out.push_back(hex[c & 0xF]);
                } else {
                    out.push_back(ch);
                }
        }
    }
    out.push_back('"');
}

void dump_into(std::string& out, const Value& v) {
    switch (v.kind()) {
        case Kind::Null: out += "null"; break;
        case Kind::Bool: out += v.as_bool() ? "true" : "false"; break;
        case Kind::Number: dump_number(out, v.as_number()); break;
        case Kind::String: quote_into(out, v.as_string()); break;
        case Kind::Array: {
            out.push_back('[');
            bool first = true;
            for (const Value& item : v.as_array()) {
                if (!first) out.push_back(',');
                first = false;
                dump_into(out, item);
            }
            out.push_back(']');
            break;
        }
        case Kind::Object: {
            out.push_back('{');
            bool first = true;
            for (const Member& m : v.as_object()) {
                if (!first) out.push_back(',');
                first = false;
                quote_into(out, m.first);
                out.push_back(':');
                dump_into(out, m.second);
            }
            out.push_back('}');
            break;
        }
    }
}

}

Kind Value::kind() const {
    switch (data_.index()) {
        case 0: return Kind::Null;
        case 1: return Kind::Bool;
        case 2: return Kind::Number;
        case 3: return Kind::String;
        case 4: return Kind::Array;
        default: return Kind::Object;
    }
}

bool Value::as_bool(bool fallback) const {
    const bool* b = std::get_if<bool>(&data_);
    return b ? *b : fallback;
}

double Value::as_number(double fallback) const {
    const double* n = std::get_if<double>(&data_);
    return n ? *n : fallback;
}

const std::string& Value::as_string() const {
    const std::string* s = std::get_if<std::string>(&data_);
    return s ? *s : kEmptyString;
}

const Array& Value::as_array() const {
    const Array* a = std::get_if<Array>(&data_);
    return a ? *a : kEmptyArray;
}

const Object& Value::as_object() const {
    const Object* o = std::get_if<Object>(&data_);
    return o ? *o : kEmptyObject;
}

const Value* Value::find(std::string_view key) const {
    const Object* o = std::get_if<Object>(&data_);
    if (!o) return nullptr;
    for (const Member& m : *o) {
        if (m.first == key) return &m.second;
    }
    return nullptr;
}

Value& Value::set(std::string key, Value v) {
    if (is_null()) data_ = Object{};
    Object* o = std::get_if<Object>(&data_);
    if (!o) return *this;
    for (Member& m : *o) {
        if (m.first == key) {
            m.second = std::move(v);
            return *this;
        }
    }
    o->emplace_back(std::move(key), std::move(v));
    return *this;
}

Value& Value::push(Value v) {
    if (is_null()) data_ = Array{};
    Array* a = std::get_if<Array>(&data_);
    if (a) a->push_back(std::move(v));
    return *this;
}

bool Value::operator==(const Value& other) const { return data_ == other.data_; }

deoxidene::Result<Value, std::string> parse(std::string_view text) { return Parser(text).document(); }

std::string dump(const Value& v) {
    std::string out;
    dump_into(out, v);
    return out;
}

std::string quote(std::string_view s) {
    std::string out;
    quote_into(out, s);
    return out;
}

}
