find_package(Threads REQUIRED)

set(CXXMCP_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/cxxmcp)
add_library(gmnew_cxxmcp STATIC
    ${CXXMCP_ROOT}/src/client.cpp
    ${CXXMCP_ROOT}/src/process_stdio_transport.cpp
    ${CXXMCP_ROOT}/src/stdio_transport.cpp
    ${CXXMCP_ROOT}/src/transport_adapter.cpp
    ${CXXMCP_ROOT}/src/serialization.cpp)
target_include_directories(gmnew_cxxmcp SYSTEM PUBLIC ${CXXMCP_ROOT}/include)
target_link_libraries(gmnew_cxxmcp PUBLIC Threads::Threads)
if(MSVC)
    target_compile_options(gmnew_cxxmcp PRIVATE /bigobj)
endif()

add_library(gmnew_mcpclient STATIC mcpclient.cpp config.cpp client.cpp transport.cpp)
target_include_directories(gmnew_mcpclient PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gmnew_mcpclient PUBLIC gmnew_json gmnew_proc gmnew_cxxmcp deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_mcpclient_fake_server tests/fake_mcp_server.cpp)
    target_link_libraries(gmnew_mcpclient_fake_server PRIVATE gmnew_json)
    add_executable(gmnew_mcpclient_test tests/mcpclient_test.cpp)
    target_link_libraries(gmnew_mcpclient_test PRIVATE gmnew_mcpclient)
    target_compile_definitions(gmnew_mcpclient_test PRIVATE GMNEW_FAKE_MCP_SERVER="$<TARGET_FILE:gmnew_mcpclient_fake_server>")
    add_dependencies(gmnew_mcpclient_test gmnew_mcpclient_fake_server)
    add_test(NAME gmnew_mcpclient_test COMMAND gmnew_mcpclient_test)
endif()
