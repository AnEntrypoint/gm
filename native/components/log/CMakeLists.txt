add_library(gm_log STATIC log.cpp)
target_include_directories(gm_log PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_log PUBLIC gm_json)

if(GMNEW_BUILD_TESTS)
    add_executable(gm_log_test tests/log_test.cpp)
    target_link_libraries(gm_log_test PRIVATE gm_log)
    add_test(NAME gm_log_test COMMAND gm_log_test)
endif()
