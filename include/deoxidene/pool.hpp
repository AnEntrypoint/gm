#pragma once

#include <cstddef>
#include <cstdint>
#include <exception>
#include <optional>
#include <vector>

namespace deoxidene {

template <typename T>
class Pool {
  public:
    using Index = std::uint32_t;

    explicit Pool(std::size_t capacity) : slots_(capacity) {
        free_.reserve(capacity);
        for (std::size_t i = capacity; i > 0; --i) {
            free_.push_back(static_cast<Index>(i - 1));
        }
    }

    [[nodiscard]] auto acquire() noexcept -> std::optional<Index> {
        if (free_.empty()) {
            return std::nullopt;
        }
        const Index index = free_.back();
        free_.pop_back();
        return index;
    }

    void release(Index index) {
        if (index >= slots_.size() || free_.size() == slots_.size()) {
            std::terminate();
        }
        free_.push_back(index);
    }

    [[nodiscard]] auto operator[](Index index) noexcept -> T& { return slots_[index]; }
    [[nodiscard]] auto capacity() const noexcept -> std::size_t { return slots_.size(); }
    [[nodiscard]] auto in_use() const noexcept -> std::size_t { return slots_.size() - free_.size(); }

  private:
    std::vector<T> slots_;
    std::vector<Index> free_;
};

}  // namespace deoxidene
