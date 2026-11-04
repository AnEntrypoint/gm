#include <algorithm>
#include <atomic>
#include <cstdio>
#include <vector>

#include "deoxidene/arena.hpp"
#include "deoxidene/containers.hpp"
#include "deoxidene/jobs.hpp"
#include "deoxidene/ownership.hpp"
#include "deoxidene/parse.hpp"
#include "deoxidene/pool.hpp"

namespace {

int failures = 0;

void check(bool ok, const char* what) {
    if (!ok) {
        ++failures;
        std::fprintf(stderr, "FAILED: %s\n", what);
    }
}

void test_parse() {
    using deoxidene::ParseError;
    using deoxidene::parse_positive_int;
    check(parse_positive_int("42").value() == 42, "parse 42");
    check(parse_positive_int("2147483647").value() == 2147483647, "parse INT_MAX");
    check(parse_positive_int("2147483648").error() == ParseError::kOverflow, "overflow");
    check(parse_positive_int("").error() == ParseError::kEmpty, "empty");
    check(parse_positive_int("-1").error() == ParseError::kNotNumeric, "negative");
    check(parse_positive_int("+1").error() == ParseError::kNotNumeric, "plus sign");
    check(parse_positive_int("12a").error() == ParseError::kNotNumeric, "trailing junk");
}

void test_small_vec() {
    deoxidene::SmallVec<int, 4> inline_only;
    inline_only.push_back(1);
    inline_only.push_back(2);
    check(inline_only.size() == 2 && inline_only.front() == 1 && inline_only.back() == 2, "inline storage");

    deoxidene::SmallVec<int, 4> spilled;
    for (int i = 0; i < 10; ++i) {
        spilled.push_back(i * 3);
    }
    bool ordered = spilled.size() == 10;
    for (int i = 0; ordered && i < 10; ++i) {
        ordered = spilled[static_cast<std::size_t>(i)] == i * 3;
    }
    check(ordered && spilled.back() == 27, "spill keeps order");
}

void test_pointers() {
    int value = 9;
    deoxidene::NotNull<int*> pointer{&value};
    check(*pointer == 9 && pointer.get() == &value, "NotNull dereference");
    auto boxed = deoxidene::make_box<int>(7);
    check(*boxed == 7, "make_box");
}

void test_arena() {
    deoxidene::Arena arena{256};
    const auto small = arena.allocate<char>(1);
    const auto wide = arena.allocate<double>(1);
    check(small.has_value() && wide.has_value() && arena.used() == 16, "arena aligns to alignof(double)");
    const auto too_big = arena.allocate<double>(64);
    check(!too_big.has_value() && too_big.error() == deoxidene::ArenaError::kExhausted, "arena reports exhaustion");
    arena.reset();
    const auto again = arena.allocate<char>(1);
    check(again.has_value() && again->data() == small->data(), "arena reuses its storage after reset");
    const auto zeroed = arena.allocate<int>(4);
    check(zeroed.has_value() && (*zeroed)[3] == 0, "arena value-initializes");
}

void test_pool() {
    deoxidene::Pool<int> pool{2};
    const auto first = pool.acquire();
    const auto second = pool.acquire();
    check(first.has_value() && second.has_value() && *first != *second, "pool hands out distinct slots");
    check(!pool.acquire().has_value() && pool.in_use() == 2, "pool reports exhaustion");
    pool[*first] = 5;
    pool.release(*first);
    const auto reused = pool.acquire();
    check(reused.has_value() && *reused == *first && pool[*reused] == 5 && pool.in_use() == 2,
          "released slot is reused with its storage");
}

void test_jobs() {
    deoxidene::JobSystem jobs{3};
    std::vector<int> touched(10000, 0);
    jobs.parallel_for(touched.size(), 97, [&touched](std::size_t begin, std::size_t end) {
        for (std::size_t i = begin; i < end; ++i) {
            ++touched[i];
        }
    });
    check(std::ranges::all_of(touched, [](int count) { return count == 1; }), "parallel_for covers each index once");

    std::atomic<std::size_t> total{0};
    for (int round = 0; round < 200; ++round) {
        jobs.parallel_for(1000, 16, [&total](std::size_t begin, std::size_t end) { total += end - begin; });
    }
    check(total.load() == 200'000, "repeated batches reuse the workers");

    deoxidene::JobSystem serial{0};
    std::size_t serial_total = 0;
    serial.parallel_for(100, 7, [&serial_total](std::size_t begin, std::size_t end) { serial_total += end - begin; });
    check(serial_total == 100, "zero workers run on the caller");

    bool called = false;
    jobs.parallel_for(0, 1, [&called](std::size_t, std::size_t) { called = true; });
    check(!called, "empty range is a no-op");
}

}  // namespace

auto main() -> int {
    test_parse();
    test_small_vec();
    test_pointers();
    test_arena();
    test_pool();
    test_jobs();
    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    std::puts("all checks passed");
    return 0;
}
