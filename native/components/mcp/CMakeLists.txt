set(GMNEW_MCP_PACKAGE_VERSION "0.1.0")

add_library(gm_mcp STATIC ${CMAKE_CURRENT_LIST_DIR}/server.cpp ${CMAKE_CURRENT_LIST_DIR}/skills.cpp ${CMAKE_CURRENT_LIST_DIR}/sha256.cpp ${CMAKE_CURRENT_LIST_DIR}/entry.cpp ${CMAKE_CURRENT_LIST_DIR}/compact.cpp ${CMAKE_CURRENT_LIST_DIR}/pending.cpp)
target_include_directories(gm_mcp PUBLIC ${CMAKE_CURRENT_LIST_DIR}/include ${CMAKE_CURRENT_LIST_DIR}/../../include)
target_compile_definitions(gm_mcp PUBLIC GMNEW_MCP_VERSION="${GMNEW_MCP_PACKAGE_VERSION}")
target_link_libraries(gm_mcp PUBLIC gm_json gm_log gm_proc Threads::Threads $<TARGET_NAME_IF_EXISTS:gm_runcode>)

