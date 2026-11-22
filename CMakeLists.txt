cmake_minimum_required(VERSION 3.25)
project(gm LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_C_STANDARD 11)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(GM_COMPILE_JOBS_OVERRIDE "" CACHE STRING "Compile pool size; empty derives it from MemAvailable as GB divided by 0.8, at most 12")
if(GM_COMPILE_JOBS_OVERRIDE STREQUAL "")
    set(gm_mem_available_kb "")
    if(EXISTS "/proc/meminfo")
        file(STRINGS "/proc/meminfo" gm_mem_available_line REGEX "^MemAvailable:")
        string(REGEX MATCH "[0-9]+" gm_mem_available_kb "${gm_mem_available_line}")
    endif()
    if(gm_mem_available_kb STREQUAL "")
        set(gm_compile_jobs 3)
    else()
        math(EXPR gm_compile_jobs "${gm_mem_available_kb} * 10 / 8388608")
        if(gm_compile_jobs LESS 1)
            set(gm_compile_jobs 1)
        endif()
        if(gm_compile_jobs GREATER 12)
            set(gm_compile_jobs 12)
        endif()
    endif()
else()
    set(gm_compile_jobs ${GM_COMPILE_JOBS_OVERRIDE})
endif()
message(STATUS "gm compile pool: ${gm_compile_jobs} jobs")
set_property(GLOBAL APPEND PROPERTY JOB_POOLS compile_pool=${gm_compile_jobs})
set(CMAKE_JOB_POOL_COMPILE compile_pool)

if(CMAKE_SYSTEM_NAME STREQUAL "WASI")
    add_library(gm_no_threads INTERFACE)
    add_library(Threads::Threads ALIAS gm_no_threads)
    add_compile_options(-g0 $<$<COMPILE_LANGUAGE:CXX>:-fno-exceptions>)
else()
    find_package(Threads REQUIRED)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    add_compile_options(-ffunction-sections -fdata-sections)
    add_link_options(-Wl,--gc-sections)
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

set(GMNEW_STAMP_HEADER "${CMAKE_BINARY_DIR}/gmnew/gmnew_build_info.hpp")
add_custom_target(gmnew_stamp ALL
    COMMAND ${CMAKE_COMMAND} -DSOURCE_DIR=${CMAKE_CURRENT_SOURCE_DIR} -DOUTPUT=${GMNEW_STAMP_HEADER} -DOVERRIDE=${GMNEW_VERSION}
            -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/gmnew_stamp.cmake
    BYPRODUCTS ${GMNEW_STAMP_HEADER}
    VERBATIM)

add_subdirectory(native)

enable_testing()
add_test(NAME check-build COMMAND $<TARGET_FILE:gm-tool> phase-b ${CMAKE_BINARY_DIR} WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
set_tests_properties(check-build PROPERTIES TIMEOUT 1500)
