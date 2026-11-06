#pragma once

#include <algorithm>
#include <atomic>
#include <concepts>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <thread>
#include <type_traits>
#include <vector>

namespace deoxidene {

class JobSystem {
  public:
    static auto default_workers() noexcept -> std::size_t {
        const std::size_t hardware = std::thread::hardware_concurrency();
        return hardware > 1 ? hardware - 1 : 0;
    }

    explicit JobSystem(std::size_t workers = default_workers()) {
        threads_.reserve(workers);
        for (std::size_t i = 0; i < workers; ++i) {
            threads_.emplace_back([this] { worker_loop(); });
        }
    }

    ~JobSystem() {
        {
            const std::scoped_lock lock{mutex_};
            stop_ = true;
        }
        wake_.notify_all();
        for (std::thread& thread : threads_) {
            thread.join();
        }
    }

    JobSystem(const JobSystem&) = delete;
    auto operator=(const JobSystem&) -> JobSystem& = delete;
    JobSystem(JobSystem&&) = delete;
    auto operator=(JobSystem&&) -> JobSystem& = delete;

    template <typename Body>
        requires std::invocable<const Body&, std::size_t, std::size_t>
    void parallel_for(std::size_t count, std::size_t chunk, const Body& body) {
        if (count == 0) {
            return;
        }
        chunk = std::max<std::size_t>(chunk, 1);
        const std::size_t chunks = (count + chunk - 1) / chunk;
        if (chunks == 1 || threads_.empty()) {
            body(std::size_t{0}, count);
            return;
        }

        Batch batch{
            .run = [](const void* context, std::size_t begin, std::size_t end) {
                (*static_cast<const Body*>(context))(begin, end);
            },
            .context = std::addressof(body),
            .count = count,
            .chunk = chunk,
            .chunks_left = chunks,
        };

        const std::scoped_lock submit{submit_};
        {
            const std::scoped_lock lock{mutex_};
            current_ = &batch;
            ++generation_;
        }
        wake_.notify_all();
        run_chunks(batch);

        std::unique_lock lock{mutex_};
        done_.wait(lock, [&] { return batch.chunks_left.load() == 0 && batch.active_threads == 0; });
        current_ = nullptr;
    }

  private:
    using Run = void (*)(const void*, std::size_t, std::size_t);

    struct Batch {
        Run run;
        const void* context;
        std::size_t count;
        std::size_t chunk;
        std::atomic<std::size_t> next_begin{0};
        std::atomic<std::size_t> chunks_left{0};
        std::size_t active_threads = 0;
    };

    void run_chunks(Batch& batch) {
        for (;;) {
            const std::size_t begin = batch.next_begin.fetch_add(batch.chunk);
            if (begin >= batch.count) {
                return;
            }
            batch.run(batch.context, begin, std::min(begin + batch.chunk, batch.count));
            if (batch.chunks_left.fetch_sub(1) == 1) {
                { const std::scoped_lock lock{mutex_}; }
                done_.notify_all();
            }
        }
    }

    void worker_loop() {
        std::uint64_t seen = 0;
        for (;;) {
            std::unique_lock lock{mutex_};
            wake_.wait(lock, [&] { return stop_ || (current_ != nullptr && generation_ != seen); });
            if (stop_) {
                return;
            }
            seen = generation_;
            Batch& batch = *current_;
            ++batch.active_threads;
            lock.unlock();

            run_chunks(batch);

            lock.lock();
            --batch.active_threads;
            lock.unlock();
            done_.notify_all();
        }
    }

    std::mutex submit_;
    std::mutex mutex_;
    std::condition_variable wake_;
    std::condition_variable done_;
    Batch* current_ = nullptr;
    std::uint64_t generation_ = 0;
    bool stop_ = false;
    std::vector<std::thread> threads_;
};

}
