function(gmnew_configure_build_info source_root)
    set(commit "unknown")
    find_package(Git QUIET)
    if(GIT_FOUND)
        execute_process(
            COMMAND "${GIT_EXECUTABLE}" rev-parse --short HEAD
            WORKING_DIRECTORY "${source_root}"
            OUTPUT_VARIABLE head
            OUTPUT_STRIP_TRAILING_WHITESPACE
            ERROR_QUIET
            RESULT_VARIABLE rc)
        if(rc EQUAL 0 AND "${head}" MATCHES "^[0-9a-f]+$")
            set(commit "${head}")
        endif()
    endif()
    set(GMNEW_COMMIT "${commit}" CACHE STRING "Source commit stamped into gm builds" FORCE)
    set(GMNEW_VERSION "${commit}-dev" CACHE STRING "Version stamped into gm builds")
endfunction()
