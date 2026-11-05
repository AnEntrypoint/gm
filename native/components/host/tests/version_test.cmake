set(failures 0)

include("${GMNEW_MODULE}")

gmnew_configure_build_info("${GMNEW_SOURCE_ROOT}")
set(default_version "${GMNEW_VERSION}")
set(resolved_commit "${GMNEW_COMMIT}")

if("${resolved_commit}" STREQUAL "unknown" OR "${resolved_commit}" MATCHES "^[0-9a-f][0-9a-f][0-9a-f][0-9a-f]+$")
  message("ok   the commit resolves to a sha or unknown (${resolved_commit})")
else()
  message("FAIL the commit resolved to ${resolved_commit}")
  math(EXPR failures "${failures} + 1")
endif()

if("${default_version}" STREQUAL "${resolved_commit}-dev")
  message("ok   the default version derives from the commit (${default_version})")
else()
  message("FAIL the default version ${default_version} does not derive from ${resolved_commit}")
  math(EXPR failures "${failures} + 1")
endif()

set(GMNEW_VERSION "EXPLICIT-PROBE" CACHE STRING "" FORCE)
gmnew_configure_build_info("${GMNEW_SOURCE_ROOT}")
if("${GMNEW_VERSION}" STREQUAL "EXPLICIT-PROBE")
  message("ok   an explicit GMNEW_VERSION wins")
else()
  message("FAIL an explicit GMNEW_VERSION was replaced by ${GMNEW_VERSION}")
  math(EXPR failures "${failures} + 1")
endif()

macro(check_version label binary)
  execute_process(COMMAND "${binary}" --version
                  OUTPUT_VARIABLE out
                  OUTPUT_STRIP_TRAILING_WHITESPACE
                  RESULT_VARIABLE rc)
  if(NOT rc EQUAL 0)
    message("FAIL ${label} --version exited ${rc}")
    math(EXPR failures "${failures} + 1")
  else()
    string(FIND "${out}" "${GMNEW_EXPECTED_VERSION}" version_at)
    string(FIND "${out}" "${GMNEW_EXPECTED_COMMIT}" commit_at)
    if(version_at LESS 0 OR commit_at LESS 0 OR "${out}" STREQUAL "${GMNEW_EXPECTED_VERSION}")
      message("FAIL ${label} --version printed: ${out}")
      math(EXPR failures "${failures} + 1")
    else()
      message("ok   ${label} --version names version and commit: ${out}")
    endif()
  endif()
endmacro()

check_version("gm" "${GMNEW_GM_BINARY}")
check_version("gm-core" "${GMNEW_CORE_BINARY}")

if(NOT "${GMNEW_EXPECTED_COMMIT}" STREQUAL "unknown" AND NOT "${GMNEW_EXPECTED_COMMIT}" MATCHES "^[0-9a-f][0-9a-f][0-9a-f][0-9a-f]+$")
  message("FAIL the compiled commit is not a sha: ${GMNEW_EXPECTED_COMMIT}")
  math(EXPR failures "${failures} + 1")
endif()

if(failures GREATER 0)
  message(FATAL_ERROR "gm_version_test: ${failures} check(s) failed")
else()
  message("gm_version_test passed")
endif()
