set(GMNEW_QUICKJS_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/quickjs-ng)

add_library(gm_quickjs_ng STATIC
    ${GMNEW_QUICKJS_DIR}/dtoa.c
    ${GMNEW_QUICKJS_DIR}/libregexp.c
    ${GMNEW_QUICKJS_DIR}/libunicode.c
    ${GMNEW_QUICKJS_DIR}/quickjs.c
)
set_target_properties(gm_quickjs_ng PROPERTIES C_STANDARD 11 C_EXTENSIONS ON C_VISIBILITY_PRESET hidden)
target_include_directories(gm_quickjs_ng SYSTEM PUBLIC ${GMNEW_QUICKJS_DIR})
target_compile_definitions(gm_quickjs_ng PRIVATE QUICKJS_NG_BUILD _GNU_SOURCE)
if(WIN32)
    target_compile_definitions(gm_quickjs_ng PRIVATE WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0601)
else()
    target_link_libraries(gm_quickjs_ng PUBLIC m)
endif()
target_link_libraries(gm_quickjs_ng PUBLIC ${CMAKE_DL_LIBS} Threads::Threads)
if(MSVC)
    target_compile_options(gm_quickjs_ng PRIVATE /experimental:c11atomics /wd4018 /wd4061 /wd4100 /wd4200 /wd4242 /wd4244 /wd4245 /wd4267 /wd4388 /wd4389 /wd4456 /wd4457 /wd4996)
else()
    target_compile_options(gm_quickjs_ng PRIVATE -funsigned-char -w)
endif()

add_library(gm_runcode STATIC engine.cpp runcode.cpp leaves.cpp query.cpp)
target_link_libraries(gm_runcode PUBLIC gm_json PRIVATE gm_quickjs_ng)
add_library(gm_leaves ALIAS gm_runcode)

if(GMNEW_BUILD_TESTS)
    add_executable(gm_runcode_test tests/runcode_test.cpp)
    target_link_libraries(gm_runcode_test PRIVATE gm_runcode)
    add_test(NAME gm_runcode_test COMMAND gm_runcode_test)
    add_executable(gm_leaves_test tests/leaves_test.cpp)
    target_include_directories(gm_leaves_test PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
    target_link_libraries(gm_leaves_test PRIVATE gm_runcode gm_quickjs_ng)
    add_test(NAME gm_leaves_test COMMAND gm_leaves_test ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
endif()
