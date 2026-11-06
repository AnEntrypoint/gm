add_library(gm_proc STATIC proc.cpp child.cpp)
target_include_directories(gm_proc PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_link_libraries(gm_proc PUBLIC deoxidene::deoxidene)

