set(GMNEW_TREESITTER_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/tree-sitter)
add_library(gm_treesitter STATIC
    ${GMNEW_TREESITTER_ROOT}/lib/src/lib.c
    ${GMNEW_TREESITTER_ROOT}/javascript/src/parser.c
    ${GMNEW_TREESITTER_ROOT}/javascript/src/scanner.c
    ${GMNEW_TREESITTER_ROOT}/typescript/src/parser.c
    ${GMNEW_TREESITTER_ROOT}/typescript/src/scanner.c)
target_include_directories(gm_treesitter PUBLIC ${GMNEW_TREESITTER_ROOT}/lib/include)
target_include_directories(gm_treesitter PRIVATE ${GMNEW_TREESITTER_ROOT}/lib/src ${GMNEW_TREESITTER_ROOT}/javascript/src ${GMNEW_TREESITTER_ROOT}/typescript/src)
if(NOT MSVC)
    target_compile_options(gm_treesitter PRIVATE -w)
endif()
set_target_properties(gm_treesitter PROPERTIES C_STANDARD 11 POSITION_INDEPENDENT_CODE ON)
