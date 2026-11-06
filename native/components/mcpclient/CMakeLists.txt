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

