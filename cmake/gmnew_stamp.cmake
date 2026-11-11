# Run at build time, every build: cmake -DSOURCE_DIR=<tree> -DOUTPUT=<header> [-DOVERRIDE=<version>] -P gmnew_stamp.cmake
find_package(Git QUIET)
set(commit "unknown")
set(head "unknown")
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
    set(trees "")
    set(ok TRUE)
    foreach(dir native src defaults)
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
set(version "${commit}-dev")
if(NOT "${head}" STREQUAL "unknown" AND DEFINED OVERRIDE AND "${OVERRIDE}" MATCHES "^${head}(-|$)")
    set(version "${OVERRIDE}")
endif()
set(text "#pragma once\n\n#include <string_view>\n\nnamespace gm::host {\n\ninline constexpr std::string_view kBuildVersion = \"${version}\";\ninline constexpr std::string_view kBuildCommit = \"${commit}\";\n\n}\n")
set(current "")
if(EXISTS "${OUTPUT}")
    file(READ "${OUTPUT}" current)
endif()
if(NOT "${current}" STREQUAL "${text}")
    file(WRITE "${OUTPUT}" "${text}")
endif()
