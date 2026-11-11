# Windows checklist: what still needs a Windows host

Verified here by reading only. This checkout has no Windows machine, and no
Windows cross compiler (no mingw, no MSVC), so none of the Windows branches
have been compiled. The rule being checked is that gm starts every child
process without a console window.

Verified by reading and by the native check:

- Every process creation in native/ goes through one of four sites: the
  proc/child.cpp spawn (CreateProcessW), proc/proc.cpp run (CreateProcessA),
  verbs/job.cpp (CreateProcessW), and host/relay.cpp (execv, a re-exec of
  the relay itself, not a child).
- Each Windows CreateProcess call is created with flags from
  gm::proc::hidden_creation_flags, which adds CREATE_NO_WINDOW.
  Run: build/release/native/components/tool/gm-tool check <gm binary> check-spawn-sites
  The check fails on the old child.cpp flags (witnessed on this host).
- The Windows branch of hidden_creation_flags is `flags | CREATE_NO_WINDOW`,
  which compiles only with windows.h, so the Windows compile is not witnessed.

Run on a Windows x64 machine (and once on arm64):

1. cmake --preset release, then cmake --build build/release. Expect a clean build of gm.exe, gm-core.exe and gm-tool.exe.
2. gm-tool.exe check build\release\native\components\host\gm.exe check-spawn-sites. Expect ok.
3. From a process with no console (for example `powershell -WindowStyle Hidden`), start `gm.exe serve --workspace <ws>` and send one run_code body that calls run_shell with `cmd /c echo hi` and a job_start with `ping -n 3 127.0.0.1`. Expect: no new console window appears during the run (watch with `Get-Process | Where-Object MainWindowHandle -ne 0`, or by eye), both outputs return, and the job state is exited.
4. gm.exe install --local build\release --source . --config <scratch>\claude.json. Expect the same messages as on POSIX, the installed path under %USERPROFILE%\.gmnew\current, and a second run that keeps the binaries.
5. gm.exe uninstall --config <scratch>\claude.json removes only the gm entry.

Not covered here: the process-group kill on Windows (DESIGN.md), and the Windows
stdin pipe closing when the relay dies.
