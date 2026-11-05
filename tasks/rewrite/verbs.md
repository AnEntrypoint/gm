# Brief: core verbs (components/verbs)

Implement the core VerbTable in the library gm_verbs (components/verbs, verbs.cpp, job.cpp), a class CoreVerbs : public gm::VerbTable, built on proc.hpp and RunLog. Verbs:
- read_file({path, offset?, limit?}), write_file({path, content}), edit_file, stat_file, list_dir({path}).
- run_shell({command, timeoutMs?}) through proc::shell in the workspace.
- job_start({job, command, timeoutMs?}): runs the command in the background on a std::thread, output to <run_dir>/jobs/<job>.log; job_status({job, waitMs?, offset?}) returns state, exitCode, output tail; job_stop({job}).
- query_log({js?, kind?, fromMono?, toMono?, after?, last?}): reads the run's RunLog. The js filter can be left out in this brief; report it as a gap if so.
Path rules (src/tools.mjs): a relative path is taken from the workspace; an absolute path is used as given, so it may point outside. Match the Node reply shapes and error texts exactly.
Verbs list and input schemas are the ones in src/tools.mjs (gm.verbs()). Copy the schema JSON strings from there.
Tests in components/verbs/tests/verbs_test.cpp: read and write round trip in a temp dir, edit_file, list_dir, run_shell echo, a job that finishes and reports exit 0, job_stop on a sleep, query_log with kind.
Spec: src/tools.mjs (the verb table), src/exec.mjs, src/log.mjs, src/run.mjs.