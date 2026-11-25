file(GLOB GM_CHECK_SOURCES CONFIGURE_DEPENDS checks/*.cpp)
add_library(gm_tool_checks STATIC session.cpp gate.cpp ship.cpp ship_push.cpp red_report.cpp scratch.cpp driver.cpp release.cpp installed.cpp repos.cpp ${GM_CHECK_SOURCES})
target_include_directories(gm_tool_checks PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_tool_checks PUBLIC deoxidene::deoxidene gm_json gm_proc)

add_executable(gm-tool main.cpp)
target_link_libraries(gm-tool PRIVATE gm_tool_checks)
