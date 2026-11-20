#include "gm/tool.hpp"
#include "gm/file.hpp"

#include <filesystem>
#include <fstream>
#include <system_error>

namespace gm::tool {

CheckResult check_read_binary(const std::string&) {
    CheckResult result;
    const std::filesystem::path dir = std::filesystem::temp_directory_path() / "gm-read-binary-check";
    std::filesystem::create_directories(dir);
    const std::filesystem::path file = dir / "bytes.bin";
    const std::string bytes("a\0b\r\n\xff\xfe", 7);
    {
        std::ofstream out(file, std::ios::binary);
        out << bytes;
    }
    if (gm::read_binary(file) != bytes) result.failures.push_back("read_binary did not return the bytes written, NUL, CRLF and high bytes included");
    if (!gm::read_binary(dir / "missing.bin").empty()) result.failures.push_back("read_binary of a missing file is not empty");
    std::error_code ec;
    std::filesystem::remove_all(dir, ec);
    result.summary = "read_binary returns a file's bytes exactly, NUL, CRLF and high bytes included, and an empty string for a missing file";
    return result;
}

}
