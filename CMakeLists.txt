cmake_minimum_required(VERSION 3.25)
project(gm LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(CMAKE_SYSTEM_NAME STREQUAL "WASI")
    add_library(gm_no_threads INTERFACE)
    add_library(Threads::Threads ALIAS gm_no_threads)
else()
    find_package(Threads REQUIRED)
endif()

add_library(deoxidene INTERFACE)
add_library(deoxidene::deoxidene ALIAS deoxidene)
target_link_libraries(deoxidene INTERFACE Threads::Threads)
target_include_directories(deoxidene INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/third_party>
)
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(deoxidene INTERFACE -Wall -Wextra -Wpedantic)
elseif(MSVC)
    target_compile_options(deoxidene INTERFACE /W4 /permissive-)
endif()

include(cmake/gmnew_build_info.cmake)
gmnew_configure_build_info("${CMAKE_CURRENT_SOURCE_DIR}")

add_subdirectory(native)

enable_testing()
find_program(GMNEW_NODE node REQUIRED)
add_test(NAME check-build COMMAND ${GMNEW_NODE} ${CMAKE_CURRENT_SOURCE_DIR}/tools/check-build.mjs ${CMAKE_BINARY_DIR})
set_tests_properties(check-build PROPERTIES TIMEOUT 1500)
