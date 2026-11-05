#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

#include "gm/proc.hpp"

using namespace gm::proc;

static int failures = 0;
#define CHECK(cond)                                                    \
    do {                                                               \
        if (!(cond)) {                                                 \
            std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #cond); \
            ++failures;                                                \
        }                                                              \
    } while (0)

int main() {
    auto echo = run({"echo", "hello"});
    CHECK(echo.started && echo.exit_code == 0 && echo.out == "hello\n");

    auto code = shell("exit 7");
    CHECK(code.started && code.exit_code == 7);

    auto errtext = shell("echo oops 1>&2");
    CHECK(errtext.err == "oops\n" && errtext.out.empty());

    auto cat = run({"cat"}, {}, "piped input");
    CHECK(cat.out == "piped input" && cat.exit_code == 0);

    auto cwd = run({"pwd"}, "/tmp");
    CHECK(cwd.out.find("/tmp") != std::string::npos);

    auto begin = std::chrono::steady_clock::now();
    auto slow = shell("sleep 30", {}, 300);
    auto elapsed = std::chrono::steady_clock::now() - begin;
    CHECK(slow.started && slow.timed_out && slow.exit_code == 128 + 9);
    CHECK(elapsed < std::chrono::seconds(5));

    auto begin_bg = std::chrono::steady_clock::now();
    auto background = shell("sleep 30 & echo hi");
    CHECK(background.out.find("hi") != std::string::npos && background.exit_code == 0);
    CHECK(std::chrono::steady_clock::now() - begin_bg < std::chrono::seconds(2));

    auto group = shell("sleep 30 & wait", {}, 300);
    CHECK(group.timed_out);

    auto big = shell("head -c 1048576 /dev/zero | tr '\\0' x");
    CHECK(big.out.size() == 1048576 && big.exit_code == 0);

    auto bigboth = run({"cat"}, {}, std::string(1 << 20, 'y'));
    CHECK(bigboth.out.size() == (1u << 20));

    auto missing = run({"definitely-not-a-program-xyz"});
    CHECK(!missing.started);

    {
        std::atomic<bool> finished{false};
        Outcome owned;
        auto owned_begin = std::chrono::steady_clock::now();
        std::thread owner_thread([&] {
            OwnerScope scope(7);
            owned = shell("exec sleep 30");
            finished = true;
        });
        while (!finished) {
            kill_owned(7);
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        owner_thread.join();
        CHECK(owned.started && owned.signal == SIGKILL && owned.exit_code == 128 + SIGKILL);
        CHECK(!owned.timed_out && std::chrono::steady_clock::now() - owned_begin < std::chrono::seconds(10));
        CHECK(signal_name(SIGKILL) != nullptr && std::string(signal_name(SIGKILL)) == "SIGKILL");
    }

    {
        Outcome plain;
        std::thread other([&] {
            OwnerScope scope(8);
            plain = shell("sleep 0.3; exit 4");
        });
        kill_owned(7);
        other.join();
        CHECK(plain.exit_code == 4 && plain.signal == 0);
    }

    if (failures == 0) std::puts("proc ok");
    return failures == 0 ? 0 : 1;
}
