#pragma once

#if __has_include(<version>)
#include <version>
#endif

#if defined(__cpp_lib_expected)
#include <expected>
namespace deoxidene {
template <typename T, typename E>
using Result = std::expected<T, E>;
template <typename E>
using Err = std::unexpected<E>;
using std::unexpect;
}  // namespace deoxidene
#elif __has_include(<tl/expected.hpp>)
#include <tl/expected.hpp>
namespace deoxidene {
template <typename T, typename E>
using Result = tl::expected<T, E>;
template <typename E>
using Err = tl::unexpected<E>;
inline constexpr tl::unexpect_t unexpect{};
}  // namespace deoxidene
#else
#error "deoxidene::Result requires <expected> (C++23) or tl::expected as a fallback"
#endif

namespace deoxidene {

template <typename T, typename E>
[[nodiscard]] constexpr auto Ok(T value) -> Result<T, E> {
    return Result<T, E>{std::move(value)};
}

template <typename E, typename T = void>
[[nodiscard]] constexpr auto Fail(E error) -> Result<T, E> {
    return Err<E>{std::move(error)};
}

}  // namespace deoxidene
