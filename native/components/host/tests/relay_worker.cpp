#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#endif

int main(int argc, char** argv) {
#if defined(_WIN32)
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    const std::string mode = argc > 1 ? argv[1] : "echo";
    std::string line;
    while (std::getline(std::cin, line)) {
        if (mode == "slow" && line.find("slow") != std::string::npos) std::this_thread::sleep_for(std::chrono::seconds(1));
        if (mode == "hang" && line.find("hang") != std::string::npos) std::this_thread::sleep_for(std::chrono::seconds(3));
        std::cout << line << '\n' << std::flush;
    }
    return 0;
}
