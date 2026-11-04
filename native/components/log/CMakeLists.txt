add_library(gmnew_log STATIC log.cpp)
target_include_directories(gmnew_log PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gmnew_log PUBLIC gmnew_json)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_log_test tests/log_test.cpp)
    target_link_libraries(gmnew_log_test PRIVATE gmnew_log)
    add_test(NAME gmnew_log_test COMMAND gmnew_log_test)
endif()
