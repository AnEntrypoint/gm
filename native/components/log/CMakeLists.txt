add_library(gm_log STATIC log.cpp)
target_include_directories(gm_log PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_log PUBLIC gm_json)

