file(READ ${CMAKE_CURRENT_LIST_DIR}/../../../package.json GMNEW_MCP_PACKAGE_JSON)
string(JSON GMNEW_MCP_PACKAGE_VERSION GET ${GMNEW_MCP_PACKAGE_JSON} version)

add_library(gmnew_mcp STATIC ${CMAKE_CURRENT_LIST_DIR}/server.cpp ${CMAKE_CURRENT_LIST_DIR}/skills.cpp ${CMAKE_CURRENT_LIST_DIR}/sha256.cpp ${CMAKE_CURRENT_LIST_DIR}/entry.cpp)
target_include_directories(gmnew_mcp PUBLIC ${CMAKE_CURRENT_LIST_DIR}/include ${CMAKE_CURRENT_LIST_DIR}/../../include)
target_compile_definitions(gmnew_mcp PUBLIC GMNEW_MCP_VERSION="${GMNEW_MCP_PACKAGE_VERSION}")
target_link_libraries(gmnew_mcp PUBLIC gmnew_json gmnew_log $<TARGET_NAME_IF_EXISTS:gmnew_runcode>)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_mcp_test ${CMAKE_CURRENT_LIST_DIR}/tests/mcp_test.cpp)
    target_link_libraries(gmnew_mcp_test PRIVATE gmnew_mcp)
    target_compile_definitions(gmnew_mcp_test PRIVATE GMNEW_SOURCE_DIR="${CMAKE_CURRENT_LIST_DIR}/../../.."
                               $<$<TARGET_EXISTS:gmnew_runcode>:GMNEW_HAVE_RUNCODE>)
    add_test(NAME gmnew_mcp_test COMMAND gmnew_mcp_test)
endif()
