add_library(gm_search STATIC search.cpp search_impl.cpp)
target_include_directories(gm_search PUBLIC ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_search PUBLIC deoxidene::deoxidene gm_json gm_proc)

