set(GMNEW_TXIKI_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/txiki)
set(GMNEW_QUICKJS_DIR ${GMNEW_TXIKI_ROOT}/quickjs)
set(GMNEW_TXIKI_DIR ${GMNEW_TXIKI_ROOT}/txiki)
set(GMNEW_TXIKI_GLUE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/txiki)

if(MSVC)
    set(GMNEW_TXIKI_DEFAULT OFF)
else()
    set(GMNEW_TXIKI_DEFAULT ON)
endif()
option(GMNEW_TXIKI "Embed the txiki.js runtime (libuv event loop and web globals) around QuickJS-NG" ${GMNEW_TXIKI_DEFAULT})

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

if(GMNEW_TXIKI)
    set(LIBUV_BUILD_SHARED OFF CACHE BOOL "" FORCE)
    set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
    add_subdirectory(${GMNEW_TXIKI_ROOT}/libuv ${CMAKE_CURRENT_BINARY_DIR}/libuv EXCLUDE_FROM_ALL)
    target_compile_options(uv_a PRIVATE -w)

    set(GMNEW_TXIKI_SOURCES
        builtins.c error.c eval.c mem.c mod_channel.c mod_dns.c mod_engine.c mod_fs.c mod_fswatch.c mod_os.c
        mod_process.c mod_streams.c mod_sys.c mod_udp.c modules.c signals.c tbuf.c text-coding.c timers.c url.c
        utils.c version.c vm.c worker.c
        bundles/c/core/core.c bundles/c/core/polyfills.c bundles/c/core/run-main.c bundles/c/core/worker-bootstrap.c
    )
    if(UNIX)
        list(APPEND GMNEW_TXIKI_SOURCES mod_posix-socket.c)
    endif()
    list(TRANSFORM GMNEW_TXIKI_SOURCES PREPEND ${GMNEW_TXIKI_DIR}/src/)

    add_library(gm_txiki STATIC
        ${GMNEW_TXIKI_SOURCES}
        ${GMNEW_TXIKI_DIR}/deps/ada/ada.cpp
        ${GMNEW_TXIKI_GLUE_DIR}/txiki_stubs.c
        ${GMNEW_TXIKI_GLUE_DIR}/txiki_shim.c
    )
    set_target_properties(gm_txiki PROPERTIES C_STANDARD 11 C_EXTENSIONS ON C_VISIBILITY_PRESET hidden CXX_STANDARD 20)
    string(TOLOWER ${CMAKE_SYSTEM_NAME} GMNEW_TXIKI_PLATFORM)
    target_compile_definitions(gm_txiki PRIVATE _GNU_SOURCE TJS__PLATFORM="${GMNEW_TXIKI_PLATFORM}")
    target_include_directories(gm_txiki SYSTEM PRIVATE ${GMNEW_TXIKI_GLUE_DIR}/overlay ${GMNEW_TXIKI_DIR}/src ${GMNEW_TXIKI_DIR}/deps/ada)
    target_include_directories(gm_txiki PUBLIC ${GMNEW_TXIKI_GLUE_DIR})
    target_compile_options(gm_txiki PRIVATE -w)
    target_link_libraries(gm_txiki PUBLIC gm_quickjs_ng uv_a)

    target_compile_definitions(gm_runcode PRIVATE GM_HAVE_TXIKI)
    target_link_libraries(gm_runcode PRIVATE gm_txiki)
endif()
