add_library(gm_tool_checks STATIC session.cpp gate.cpp ship.cpp checks/registry.cpp checks/read_after_write.cpp checks/spawn_sites.cpp checks/lazy_browser.cpp checks/rows.cpp checks/fetch.cpp checks/wiki.cpp checks/git.cpp checks/review.cpp)
target_include_directories(gm_tool_checks PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_tool_checks PUBLIC deoxidene::deoxidene gm_json gm_proc)

add_executable(gm-tool main.cpp)
target_link_libraries(gm-tool PRIVATE gm_tool_checks)
