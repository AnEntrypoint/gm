#include "gmnew/mcp.hpp"
#include "gmnew/runcode.hpp"

namespace gmnew::mcp {

int serve(std::istream& in, std::ostream& out, VerbTable& verbs, std::filesystem::path workspace,
          std::filesystem::path runs, std::filesystem::path skills, ServerOptions options) {
    options.workspace = std::move(workspace);
    options.runs = std::move(runs);
    options.skills = std::move(skills);
    if (!options.run_body) {
        options.run_body = [](VerbTable& table, std::string_view body, const std::filesystem::path& root) {
            return gmnew::run_body(table, body, root);
        };
    }
    return serve_stream(in, out, verbs, std::move(options));
}

}
