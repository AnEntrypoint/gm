# Run at build time, every build: cmake -DSOURCE_DIR=<tree> -DOUTPUT=<header> [-DOVERRIDE=<version>] -P gmnew_stamp.cmake
find_package(Git QUIET)
set(commit "unknown")
set(head "unknown")
set(committed "unknown")
if(GIT_FOUND)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" rev-parse --short HEAD
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE short_head
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE rc)
    if(rc EQUAL 0 AND "${short_head}" MATCHES "^[0-9a-f]+$")
        set(head "${short_head}")
    endif()
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" log -1 --format=%ct HEAD
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE commit_time
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE committed_rc)
    if(committed_rc EQUAL 0 AND "${commit_time}" MATCHES "^[0-9]+$")
        set(committed "${commit_time}")
    endif()
    set(trees "")
    set(ok TRUE)
    foreach(dir native defaults)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" rev-parse "HEAD:${dir}"
            WORKING_DIRECTORY "${SOURCE_DIR}"
            OUTPUT_VARIABLE tree
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_QUIET
            RESULT_VARIABLE tree_rc)
        if(NOT tree_rc EQUAL 0 OR NOT "${tree}" MATCHES "^[0-9a-f]+$")
            set(ok FALSE)
        endif()
        string(APPEND trees "${tree}")
    endforeach()
    if(ok)
        string(SHA256 digest "${trees}")
        string(SUBSTRING "${digest}" 0 12 commit)
    endif()
endif()
set(state "unknown")
if(GIT_FOUND AND NOT "${head}" STREQUAL "unknown")
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" rev-parse HEAD
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE head_full
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE head_full_rc)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" status --porcelain
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE dirty_files
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE dirty_rc)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" rev-parse --verify -q refs/remotes/origin/main
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE origin_full
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE origin_rc)
    if(head_full_rc EQUAL 0 AND dirty_rc EQUAL 0)
        set(state "clean")
        if(NOT dirty_files STREQUAL "")
            set(state "dirty")
        elseif(origin_rc EQUAL 0 AND NOT origin_full STREQUAL head_full)
            set(state "unpushed")
        endif()
    endif()
endif()
set(version "${commit}-dev")
if(NOT "${head}" STREQUAL "unknown" AND DEFINED OVERRIDE AND "${OVERRIDE}" MATCHES "^${head}(-|$)")
    set(version "${OVERRIDE}")
endif()
set(text "#pragma once\n\n#include <string_view>\n\nnamespace gm::host {\n\ninline constexpr std::string_view kBuildVersion = \"${version}\";\ninline constexpr std::string_view kBuildCommit = \"${commit}\";\ninline constexpr std::string_view kBuildCommitTime = \"${committed}\";\ninline constexpr std::string_view kBuildHead = \"${head}\";\ninline constexpr std::string_view kBuildState = \"${state}\";\n\n}\n")
set(current "")
if(EXISTS "${OUTPUT}")
    file(READ "${OUTPUT}" current)
endif()
if(NOT "${current}" STREQUAL "${text}")
    file(WRITE "${OUTPUT}" "${text}")
endif()
