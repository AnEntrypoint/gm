find_package(Threads REQUIRED)

set(CXXMCP_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/cxxmcp)
add_library(gm_cxxmcp STATIC
    ${CXXMCP_ROOT}/src/client.cpp
    ${CXXMCP_ROOT}/src/process_stdio_transport.cpp
    ${CXXMCP_ROOT}/src/stdio_transport.cpp
    ${CXXMCP_ROOT}/src/transport_adapter.cpp
    ${CXXMCP_ROOT}/src/serialization.cpp)
target_include_directories(gm_cxxmcp SYSTEM PUBLIC ${CXXMCP_ROOT}/include)
target_link_libraries(gm_cxxmcp PUBLIC Threads::Threads)
if(MSVC)
    target_compile_options(gm_cxxmcp PRIVATE /bigobj)
endif()

add_library(gm_mcpclient STATIC mcpclient.cpp config.cpp client.cpp transport.cpp)
target_include_directories(gm_mcpclient PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_mcpclient PUBLIC gm_json gm_proc gm_cxxmcp deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS)
    add_executable(gm_mcpclient_fake_server tests/fake_mcp_server.cpp)
    target_link_libraries(gm_mcpclient_fake_server PRIVATE gm_json)
    add_executable(gm_mcpclient_test tests/mcpclient_test.cpp)
    target_link_libraries(gm_mcpclient_test PRIVATE gm_mcpclient)
    target_compile_definitions(gm_mcpclient_test PRIVATE GMNEW_FAKE_MCP_SERVER="$<TARGET_FILE:gm_mcpclient_fake_server>")
    add_dependencies(gm_mcpclient_test gm_mcpclient_fake_server)
    add_test(NAME gm_mcpclient_test COMMAND gm_mcpclient_test)
endif()
