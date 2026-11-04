add_library(gmnew_proc STATIC proc.cpp)
target_include_directories(gmnew_proc PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gmnew_proc PUBLIC deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_proc_test tests/proc_test.cpp)
    target_link_libraries(gmnew_proc_test PRIVATE gmnew_proc)
    add_test(NAME gmnew_proc COMMAND gmnew_proc_test)
endif()
