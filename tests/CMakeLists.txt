add_executable(deoxidene_tests main.cpp)
target_link_libraries(deoxidene_tests PRIVATE deoxidene::deoxidene)
add_test(NAME deoxidene_tests COMMAND deoxidene_tests)
