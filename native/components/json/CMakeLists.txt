add_library(gm_json STATIC json.cpp)
target_include_directories(gm_json PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_json PUBLIC deoxidene::deoxidene)

