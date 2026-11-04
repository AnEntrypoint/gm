add_library(gmnew_search STATIC search.cpp search_impl.cpp)
target_include_directories(gmnew_search PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gmnew_search PUBLIC deoxidene::deoxidene gmnew_json gmnew_proc)

if(GMNEW_BUILD_TESTS)
    add_executable(gmnew_search_test tests/search_test.cpp)
    target_link_libraries(gmnew_search_test PRIVATE gmnew_search)
    add_test(NAME gmnew_search_test COMMAND gmnew_search_test)
endif()
