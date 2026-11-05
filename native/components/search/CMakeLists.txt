add_library(gm_search STATIC search.cpp search_impl.cpp)
target_include_directories(gm_search PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_search PUBLIC deoxidene::deoxidene gm_json gm_proc)

if(GMNEW_BUILD_TESTS)
    add_executable(gm_search_test tests/search_test.cpp)
    target_link_libraries(gm_search_test PRIVATE gm_search)
    add_test(NAME gm_search_test COMMAND gm_search_test)
endif()
