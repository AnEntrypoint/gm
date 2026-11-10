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
option(GMNEW_TXIKI_WASI "Build the txiki runtime and run_code as a wasm32-wasi reactor on the browser libuv port, exporting the gm_txiki_* shim" OFF)

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

if(GMNEW_TXIKI AND NOT GMNEW_TXIKI_WASI)
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

if(GMNEW_TXIKI_WASI)
    set(GMNEW_UV_WASI_DIR ${CMAKE_CURRENT_BINARY_DIR}/uv-wasi)
    file(READ ${GMNEW_TXIKI_ROOT}/libuv/include/uv.h GMNEW_UV_HEADER)
    string(REPLACE "#if defined(UV_FREERTOS)\n# include \"uv/freertos.h\"" "#if 1\n# include \"uv/browser.h\"" GMNEW_UV_HEADER "${GMNEW_UV_HEADER}")
    if(NOT GMNEW_UV_HEADER MATCHES "uv/browser.h")
        message(FATAL_ERROR "libuv include/uv.h has no FreeRTOS branch to replace with uv/browser.h")
    endif()
    file(WRITE ${GMNEW_UV_WASI_DIR}/uv.h "${GMNEW_UV_HEADER}")

    set(GMNEW_TXIKI_WASI_SOURCES
        builtins.c error.c eval.c mem.c mod_engine.c mod_fs.c mod_os.c mod_streams.c mod_sys.c modules.c signals.c
        tbuf.c text-coding.c timers.c url.c utils.c version.c vm.c worker.c
        bundles/c/core/core.c bundles/c/core/polyfills.c bundles/c/core/run-main.c bundles/c/core/worker-bootstrap.c
    )
    list(TRANSFORM GMNEW_TXIKI_WASI_SOURCES PREPEND ${GMNEW_TXIKI_DIR}/src/)
    set(GMNEW_TXIKI_WASI_INCLUDES
        ${GMNEW_UV_WASI_DIR} ${GMNEW_TXIKI_ROOT}/libuv/include ${GMNEW_TXIKI_ROOT}/browser
        ${GMNEW_TXIKI_GLUE_DIR}/overlay ${GMNEW_TXIKI_DIR}/src ${GMNEW_TXIKI_DIR}/deps/ada ${GMNEW_QUICKJS_DIR}
    )
    set(GMNEW_TXIKI_WASI_DEFINES _GNU_SOURCE _WASI_EMULATED_SIGNAL _WASI_EMULATED_PROCESS_CLOCKS _WASI_EMULATED_GETPID TJS__PLATFORM="wasi")

    add_library(gm_txiki_core_wasi STATIC
        ${GMNEW_TXIKI_WASI_SOURCES}
        ${GMNEW_TXIKI_DIR}/deps/ada/ada.cpp
        ${GMNEW_TXIKI_GLUE_DIR}/txiki_stubs.c
        ${GMNEW_TXIKI_ROOT}/browser/uv-browser.c
    )
    set_target_properties(gm_txiki_core_wasi PROPERTIES C_STANDARD 11 C_EXTENSIONS ON C_VISIBILITY_PRESET hidden CXX_STANDARD 20)
    target_compile_definitions(gm_txiki_core_wasi PRIVATE ${GMNEW_TXIKI_WASI_DEFINES})
    target_include_directories(gm_txiki_core_wasi SYSTEM PRIVATE ${GMNEW_TXIKI_WASI_INCLUDES})
    target_include_directories(gm_txiki_core_wasi PUBLIC ${GMNEW_TXIKI_GLUE_DIR})
    target_compile_options(gm_txiki_core_wasi PRIVATE -O2 -w)
    target_link_libraries(gm_txiki_core_wasi PUBLIC gm_quickjs_ng)

    target_compile_definitions(gm_runcode PRIVATE GM_HAVE_TXIKI)
    target_include_directories(gm_runcode PRIVATE ${GMNEW_TXIKI_GLUE_DIR})
    target_link_libraries(gm_runcode PRIVATE gm_txiki_core_wasi)

    add_executable(gm_txiki_wasi ${GMNEW_TXIKI_GLUE_DIR}/txiki_shim.c)
    set_target_properties(gm_txiki_wasi PROPERTIES SUFFIX ".wasm" C_STANDARD 11 C_EXTENSIONS ON CXX_STANDARD 20)
    target_compile_definitions(gm_txiki_wasi PRIVATE ${GMNEW_TXIKI_WASI_DEFINES})
    target_include_directories(gm_txiki_wasi SYSTEM PRIVATE ${GMNEW_TXIKI_WASI_INCLUDES})
    target_compile_options(gm_txiki_wasi PRIVATE -O2 -w)
    target_link_libraries(gm_txiki_wasi PRIVATE gm_runcode gm_txiki_core_wasi gm_json gm_quickjs_ng)
    target_link_options(gm_txiki_wasi PRIVATE
        -mexec-model=reactor -Wl,--no-entry -Wl,--export-dynamic -Wl,--no-gc-sections
        -Wl,--export=gm_txiki_new -Wl,--export=gm_txiki_free -Wl,--export=gm_txiki_context
        -Wl,--export=gm_txiki_loop_alive -Wl,--export=gm_txiki_loop_turn -Wl,--export=gm_txiki_load_builtin
        -Wl,--export=gm_txiki_refresh_loop_time
        -Wl,--export=malloc -Wl,--export=free -Wl,--export=realloc -Wl,--export=calloc
        -lc++ -lc++abi -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-getpid -lm
    )
endif()
