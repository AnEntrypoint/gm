#include <cstdio>
#include <string>

#include "gm/json.hpp"

using namespace gm::json;

static int failures = 0;

#define CHECK(cond)                                                      \
    do {                                                                 \
        if (!(cond)) {                                                   \
            std::fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #cond); \
            ++failures;                                                  \
        }                                                                \
    } while (0)

static std::string round_trip(const std::string& text) {
    auto v = parse(text);
    return v ? dump(*v) : "ERR:" + v.error();
}

int main() {
    CHECK(round_trip("{\"a\":[1,2.5,true,null,\"x\"],\"b\":{}}") == "{\"a\":[1,2.5,true,null,\"x\"],\"b\":{}}");
    CHECK(round_trip(" [ 1 , 2 ] ") == "[1,2]");
    CHECK(round_trip("3.0") == "3");
    CHECK(round_trip("-0.125") == "-0.125");
    CHECK(round_trip("1e3") == "1000");
    CHECK(round_trip("0.1") == "0.1");
    CHECK(dump(Value(std::int64_t{9007199254740991})) == "9007199254740991");
    CHECK(dump(Value(0.1 + 0.2)) == "0.30000000000000004");
    CHECK(dump(Value(1.5)) == "1.5");

    CHECK(quote("a\"b\\c\n\t\x01") == "\"a\\\"b\\\\c\\n\\t\\u0001\"");
    CHECK(round_trip("\"\\u00e9\"") == "\"\xC3\xA9\"");
    CHECK(round_trip("\"\\ud83d\\ude00\"") == "\"\xF0\x9F\x98\x80\"");
    CHECK(round_trip("\"\xE2\x82\xAC\"") == "\"\xE2\x82\xAC\"");
    CHECK(round_trip("\"\\/\"") == "\"/\"");

    auto bad = parse("[1,2] x");
    CHECK(!bad && bad.error().find("byte 6") != std::string::npos);
    auto bad2 = parse("{\"a\":}");
    CHECK(!bad2 && bad2.error().find("byte 5") != std::string::npos);
    CHECK(!parse(""));
    CHECK(!parse("[1,]"));
    CHECK(!parse("01"));
    CHECK(!parse("\"abc"));
    CHECK(!parse("\"a\nb\""));
    CHECK(!parse("{\"a\" 1}"));
    CHECK(!parse("tru"));

    Value o;
    o.set("k", 1).set("s", "v").set("k", 2);
    CHECK(dump(o) == "{\"k\":2,\"s\":\"v\"}");
    CHECK(o.find("k") && o.find("k")->as_number() == 2);
    CHECK(o.find("none") == nullptr);
    Value a;
    a.push(1).push("two");
    CHECK(dump(a) == "[1,\"two\"]");
    CHECK(a.is_array() && a.as_array().size() == 2);
    CHECK(o == *parse("{\"k\":2,\"s\":\"v\"}"));
    CHECK(!(o == a));
    CHECK(parse("{\"a\":1,\"a\":2}")->find("a")->as_number() == 2);

    std::string deep(1000, '[');
    CHECK(!parse(deep));

    if (failures == 0) std::puts("json_test ok");
    return failures == 0 ? 0 : 1;
}
