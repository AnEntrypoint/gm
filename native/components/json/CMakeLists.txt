add_library(gmnew_json STATIC json.cpp)
target_include_directories(gmnew_json PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gmnew_json PUBLIC deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_json_test tests/json_test.cpp)
    target_link_libraries(gmnew_json_test PRIVATE gmnew_json)
    add_test(NAME gmnew_json_test COMMAND gmnew_json_test)
endif()
