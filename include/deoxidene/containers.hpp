#pragma once

#include <array>
#include <cstddef>
#include <span>
#include <type_traits>
#include <vector>

namespace deoxidene {

template <typename T, std::size_t N>
    requires std::is_trivially_copyable_v<T> && std::is_default_constructible_v<T>
class SmallVec {
  public:
    using value_type = T;
    using size_type = std::size_t;

    void push_back(const T& value) {
        if (spilled_) {
            heap_.push_back(value);
        } else if (size_ < N) {
            inline_[size_] = value;
        } else {
            heap_.assign(inline_.begin(), inline_.end());
            heap_.push_back(value);
            spilled_ = true;
        }
        ++size_;
    }

    [[nodiscard]] auto size() const noexcept -> size_type { return size_; }
    [[nodiscard]] auto empty() const noexcept -> bool { return size_ == 0; }
    [[nodiscard]] auto data() noexcept -> T* { return view().data(); }
    [[nodiscard]] auto data() const noexcept -> const T* { return view().data(); }
    [[nodiscard]] auto operator[](size_type index) noexcept -> T& { return view()[index]; }
    [[nodiscard]] auto operator[](size_type index) const noexcept -> const T& { return view()[index]; }
    [[nodiscard]] auto front() noexcept -> T& { return view().front(); }
    [[nodiscard]] auto back() noexcept -> T& { return view().back(); }
    [[nodiscard]] auto begin() noexcept { return view().begin(); }
    [[nodiscard]] auto end() noexcept { return view().end(); }
    [[nodiscard]] auto begin() const noexcept { return view().begin(); }
    [[nodiscard]] auto end() const noexcept { return view().end(); }

  private:
    [[nodiscard]] auto view() noexcept -> std::span<T> {
        return spilled_ ? std::span<T>{heap_} : std::span<T>{inline_}.first(size_);
    }
    [[nodiscard]] auto view() const noexcept -> std::span<const T> {
        return spilled_ ? std::span<const T>{heap_} : std::span<const T>{inline_}.first(size_);
    }

    std::array<T, N> inline_{};
    std::vector<T> heap_;
    size_type size_ = 0;
    bool spilled_ = false;
};

}  // namespace deoxidene
