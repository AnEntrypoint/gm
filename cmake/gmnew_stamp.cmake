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
    set(index_file "${OUTPUT}.index")
    file(REMOVE "${index_file}")
    set(ENV{GIT_INDEX_FILE} "${index_file}")
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" read-tree HEAD
        WORKING_DIRECTORY "${SOURCE_DIR}"
        RESULT_VARIABLE read_rc
        OUTPUT_QUIET
        ERROR_QUIET)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" add --all -- native defaults
        WORKING_DIRECTORY "${SOURCE_DIR}"
        RESULT_VARIABLE add_rc
        OUTPUT_QUIET
        ERROR_QUIET)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" write-tree
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE tree
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE tree_rc)
    unset(ENV{GIT_INDEX_FILE})
    file(REMOVE "${index_file}")
    if(read_rc EQUAL 0 AND add_rc EQUAL 0 AND tree_rc EQUAL 0 AND "${tree}" MATCHES "^[0-9a-f]+$")
        string(SHA256 digest "${tree}")
        string(SUBSTRING "${digest}" 0 12 commit)
    endif()
endif()
set(state "unknown")
set(dirty_paths "")
if(GIT_FOUND AND NOT "${head}" STREQUAL "unknown")
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" rev-parse HEAD
        WORKING_DIRECTORY "${SOURCE_DIR}"
        OUTPUT_VARIABLE head_full
        OUTPUT_STRIP_TRAILING_WHITESPACE
        ERROR_QUIET
        RESULT_VARIABLE head_full_rc)
    execute_process(
        COMMAND "${GIT_EXECUTABLE}" status --porcelain -- . ":(exclude,literal).ccache"
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
            string(REPLACE "\n" " | " dirty_paths "${dirty_files}")
            string(REPLACE "\"" "'" dirty_paths "${dirty_paths}")
            string(REPLACE "\\" "/" dirty_paths "${dirty_paths}")
            string(SUBSTRING "${dirty_paths}" 0 240 dirty_paths)
            message(STATUS "gm build state: dirty, uncommitted: ${dirty_paths}")
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
string(REPLACE "\n}\n" "\ninline constexpr std::string_view kBuildDirty = \"${dirty_paths}\";\n}\n" text "${text}")
set(current "")
if(EXISTS "${OUTPUT}")
    file(READ "${OUTPUT}" current)
endif()
if(NOT "${current}" STREQUAL "${text}")
    file(WRITE "${OUTPUT}" "${text}")
endif()
