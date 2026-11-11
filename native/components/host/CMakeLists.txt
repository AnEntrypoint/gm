add_library(gm_host STATIC child.cpp composed_verbs.cpp browser_scope.cpp relay.cpp options.cpp primitives.cpp cli.cpp update.cpp install.cpp)
target_include_directories(gm_host PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../../include
                                          ${CMAKE_BINARY_DIR}/gmnew)
target_link_libraries(gm_host PUBLIC deoxidene::deoxidene gm_json gm_log gm_proc gm_runcode
                                        $<TARGET_NAME_IF_EXISTS:gm_mcp>)
add_dependencies(gm_host gmnew_stamp)

add_executable(gm main.cpp serve.cpp)
target_link_libraries(gm PRIVATE gm_host)
target_compile_definitions(gm PRIVATE GMNEW_HOST_ABI_VERSION=1)

add_custom_target(gm_skills ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${PROJECT_SOURCE_DIR}/skills ${CMAKE_CURRENT_BINARY_DIR}/skills
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${PROJECT_SOURCE_DIR}/native/leaves ${CMAKE_CURRENT_BINARY_DIR}/leaves
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${PROJECT_SOURCE_DIR}/defaults ${CMAKE_CURRENT_BINARY_DIR}/defaults)

add_executable(gm-core main.cpp serve.cpp)
target_link_libraries(gm-core PRIVATE gm_host)
target_compile_definitions(gm-core PRIVATE GMNEW_HOST_ABI_VERSION=1)

function(gm_host_link_worker)
    get_property(host_dir GLOBAL PROPERTY GMNEW_HOST_DIR)
    set(missing)
    foreach(needed IN ITEMS gm_mcp gm_verbs gm_search gm_runcode gm_mcpclient)
        if(NOT TARGET ${needed})
            list(APPEND missing ${needed})
        endif()
    endforeach()
    set(leaf_targets)
    if(TARGET gm_leaves)
        list(APPEND leaf_targets gm_leaves)
    endif()
    if(missing)
        list(JOIN missing ", " missing_text)
        message(STATUS "gm: worker and doctor modes wait for ${missing_text}")
        foreach(exe IN ITEMS gm gm-core)
            target_sources(${exe} PRIVATE ${host_dir}/worker_unavailable.cpp)
            target_compile_definitions(${exe} PRIVATE GMNEW_HOST_MISSING_TARGETS="${missing_text}")
        endforeach()
        return()
    endif()
    foreach(exe IN ITEMS gm gm-core)
        target_sources(${exe} PRIVATE ${host_dir}/worker.cpp)
        target_link_libraries(${exe} PRIVATE gm_mcp gm_verbs gm_search gm_runcode gm_mcpclient ${leaf_targets})
    endforeach()
endfunction()
set_property(GLOBAL PROPERTY GMNEW_HOST_DIR ${CMAKE_CURRENT_SOURCE_DIR})
cmake_language(DEFER DIRECTORY ${PROJECT_SOURCE_DIR} CALL gm_host_link_worker)
