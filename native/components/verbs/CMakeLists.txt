add_library(gm_verbs STATIC verbs.cpp job.cpp text.cpp condense.cpp rows.cpp)
target_include_directories(gm_verbs PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include ${CMAKE_CURRENT_SOURCE_DIR}/../../include)
target_include_directories(gm_verbs PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../quickjs)
target_link_libraries(gm_verbs PUBLIC gm_json gm_log gm_proc Threads::Threads PRIVATE gm_runcode gm_quickjs_ng)

