# Brief: process spawn (components/proc)

Implement native/include/gm/proc.hpp in components/proc (library gm_proc, proc.cpp).
- POSIX: posix_spawnp with pipes for stdin, stdout and stderr; setpgid so the timeout kills the whole group; poll the pipes so large outputs do not deadlock; collect exit status (signals map to 128+n).
- Windows: CreateProcess with pipes, CREATE_NEW_PROCESS_GROUP, TerminateProcess on timeout. Write it under #if defined(_WIN32). It cannot be built here; say so in the report and keep it small.
- shell(): /bin/sh -c on POSIX and cmd /c on Windows.
- Tests in components/proc/tests/proc_test.cpp: echo, exit code, stdin piped through cat, timeout kills a sleep, large output (1 MB) does not hang, a missing program gives started=false.
Spec: how src/exec.mjs and src/git.mjs call child processes (timeouts, output handling). Match their result shapes.