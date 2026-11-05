add_library(gm_proc STATIC proc.cpp child.cpp)
target_include_directories(gm_proc PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_proc PUBLIC deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS AND NOT WIN32)
    add_executable(gm_proc_test tests/proc_test.cpp)
    target_link_libraries(gm_proc_test PRIVATE gm_proc)
    add_test(NAME gm_proc COMMAND gm_proc_test)
endif()
