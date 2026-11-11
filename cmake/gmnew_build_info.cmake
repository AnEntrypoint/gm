function(gmnew_configure_build_info source_root)
    set(commit "unknown")
    set(head "unknown")
    find_package(Git QUIET)
    if(GIT_FOUND)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" rev-parse --short HEAD
            WORKING_DIRECTORY "${source_root}"
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
                WORKING_DIRECTORY "${source_root}"
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
    if(NOT "${head}" STREQUAL "unknown" AND DEFINED CACHE{GMNEW_VERSION} AND "${GMNEW_VERSION}" MATCHES "^${head}(-|$)")
        set(version "${GMNEW_VERSION}")
    endif()
    set(GMNEW_COMMIT "${commit}" CACHE STRING "Source commit stamped into gm builds" FORCE)
    set(GMNEW_VERSION "${version}" CACHE STRING "Version stamped into gm builds" FORCE)
    set(GMNEW_COMMIT "${commit}" PARENT_SCOPE)
    set(GMNEW_VERSION "${version}" PARENT_SCOPE)
endfunction()
