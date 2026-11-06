#pragma once

#include <cstdlib>
#include <exception>
#include <memory>
#include <span>
#include <type_traits>
#include <utility>

namespace deoxidene {

template <typename T>
using Span = std::span<T>;

template <typename T>
using Owner = T;

template <typename T>
    requires std::is_pointer_v<T>
class NotNull {
  public:
    constexpr explicit NotNull(T pointer) : pointer_(pointer) {
        if (pointer_ == nullptr) {
            std::terminate();
        }
    }

    [[nodiscard]] constexpr auto get() const noexcept -> T { return pointer_; }
    [[nodiscard]] constexpr auto operator->() const noexcept -> T { return pointer_; }
    [[nodiscard]] constexpr auto operator*() const noexcept -> decltype(*std::declval<T>()) { return *pointer_; }

  private:
    T pointer_;
};

template <typename T>
using Box = std::unique_ptr<T>;

template <typename T>
using Rc = std::shared_ptr<T>;

template <typename T>
using Weak = std::weak_ptr<T>;

template <typename T, typename... Args>
[[nodiscard]] auto make_box(Args&&... args) -> Box<T> {
    return std::make_unique<T>(std::forward<Args>(args)...);
}

template <typename T, typename... Args>
[[nodiscard]] auto make_rc(Args&&... args) -> Rc<T> {
    return std::make_shared<T>(std::forward<Args>(args)...);
}

}
