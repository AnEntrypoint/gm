add_library(gm_json STATIC json.cpp)
target_include_directories(gm_json PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_json PUBLIC deoxidene::deoxidene)

if(GMNEW_BUILD_TESTS)
    add_executable(gm_json_test tests/json_test.cpp)
    target_link_libraries(gm_json_test PRIVATE gm_json)
    add_test(NAME gm_json_test COMMAND gm_json_test)
endif()
