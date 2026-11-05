#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "deoxidene/result.hpp"

namespace gm::json {

class Value;
using Array = std::vector<Value>;
using Member = std::pair<std::string, Value>;
using Object = std::vector<Member>;

enum class Kind { Null, Bool, Number, String, Array, Object };

class Value {
public:
    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool b) : data_(b) {}
    Value(double n) : data_(n) {}
    Value(int n) : data_(static_cast<double>(n)) {}
    Value(std::int64_t n) : data_(static_cast<double>(n)) {}
    Value(std::uint64_t n) : data_(static_cast<double>(n)) {}
    Value(const char* s) : data_(std::string(s)) {}
    Value(std::string s) : data_(std::move(s)) {}
    Value(Array a) : data_(std::move(a)) {}
    Value(Object o) : data_(std::move(o)) {}

    Kind kind() const;
    bool is_null() const { return kind() == Kind::Null; }
    bool is_bool() const { return kind() == Kind::Bool; }
    bool is_number() const { return kind() == Kind::Number; }
    bool is_string() const { return kind() == Kind::String; }
    bool is_array() const { return kind() == Kind::Array; }
    bool is_object() const { return kind() == Kind::Object; }

    bool as_bool(bool fallback = false) const;
    double as_number(double fallback = 0) const;
    const std::string& as_string() const;
    const Array& as_array() const;
    const Object& as_object() const;

    const Value* find(std::string_view key) const;
    Value& set(std::string key, Value v);
    Value& push(Value v);

    bool operator==(const Value& other) const;

private:
    std::variant<std::monostate, bool, double, std::string, Array, Object> data_;
};

deoxidene::Result<Value, std::string> parse(std::string_view text);

std::string dump(const Value& v);

std::string quote(std::string_view s);

}
