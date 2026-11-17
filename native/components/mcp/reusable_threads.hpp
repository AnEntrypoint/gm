#pragma once

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

namespace gm::mcp {

class ReusableThreads {
public:
    ReusableThreads() : state_(std::make_shared<State>()) {}
    ~ReusableThreads() {
        std::lock_guard lock(state_->mutex);
        state_->stopped = true;
        state_->wake.notify_all();
    }
    ReusableThreads(const ReusableThreads&) = delete;
    ReusableThreads& operator=(const ReusableThreads&) = delete;

    void run(std::function<void()> task) {
        std::unique_lock lock(state_->mutex);
        if (state_->idle > 0) {
            state_->idle -= 1;
            state_->queue.push_back(std::move(task));
            state_->wake.notify_one();
            return;
        }
        std::thread([state = state_, first = std::move(task)]() mutable { serve(*state, std::move(first)); }).detach();
    }

private:
    struct State {
        std::mutex mutex;
        std::condition_variable wake;
        std::deque<std::function<void()>> queue;
        std::size_t idle = 0;
        bool stopped = false;
    };

    static void serve(State& state, std::function<void()> task) {
        for (;;) {
            task();
            std::unique_lock lock(state.mutex);
            state.idle += 1;
            state.wake.wait(lock, [&] { return !state.queue.empty() || state.stopped; });
            if (state.queue.empty()) return;
            task = std::move(state.queue.front());
            state.queue.pop_front();
        }
    }

    std::shared_ptr<State> state_;
};

}
