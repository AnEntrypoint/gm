#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <memory_resource>
#include <span>
#include <type_traits>
#include <vector>

#include "deoxidene/result.hpp"

namespace deoxidene {

enum class ArenaError : std::uint8_t { kExhausted };

class Arena {
  public:
    explicit Arena(std::size_t capacity_bytes)
        : storage_(capacity_bytes),
          resource_(storage_.data(), storage_.size(), std::pmr::null_memory_resource()) {}

    template <typename T>
        requires std::is_trivially_destructible_v<T> && (alignof(T) <= alignof(std::max_align_t))
    [[nodiscard]] auto allocate(std::size_t count) -> Result<std::span<T>, ArenaError> {
        const std::size_t start = align_up(used_, alignof(T));
        const std::size_t bytes = count * sizeof(T);
        if (start > storage_.size() || bytes > storage_.size() - start) {
            return Fail<ArenaError, std::span<T>>(ArenaError::kExhausted);
        }
        auto* first = static_cast<T*>(resource_.allocate(bytes, alignof(T)));
        std::uninitialized_value_construct_n(first, count);
        used_ = start + bytes;
        return Ok<std::span<T>, ArenaError>(std::span<T>{first, count});
    }

    void reset() noexcept {
        used_ = 0;
        resource_.release();
    }
    [[nodiscard]] auto used() const noexcept -> std::size_t { return used_; }
    [[nodiscard]] auto capacity() const noexcept -> std::size_t { return storage_.size(); }

  private:
    [[nodiscard]] static constexpr auto align_up(std::size_t value, std::size_t alignment) noexcept -> std::size_t {
        return (value + alignment - 1) / alignment * alignment;
    }

    std::vector<std::byte> storage_;
    std::pmr::monotonic_buffer_resource resource_;
    std::size_t used_ = 0;
};

}  // namespace deoxidene
