cmake_minimum_required(VERSION 3.25)
project(gm LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(Threads REQUIRED)

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
