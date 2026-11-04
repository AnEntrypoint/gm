# Brief: ci-setup (.github, setup.sh, README, scripts)

Read tasks/rewrite/common.md. You own .github/, scripts/, setup.sh, README.md and docs/ notes for the native build. Do not edit native/, src/, tools/, skills/, .mcp.json, AGENTS.md or DESIGN.md.

1. Workflows: adapt deoxidene's .github/workflows/ci.yml and release.yml (copied under /workspace/deoxidene/.github) to gm-new. Matrix: ubuntu x64 and arm64, macos arm64 and x64, windows x64 and arm64. Each job: cmake --preset release, build, ctest with GMNEW_BUILD_TESTS=ON. Release uploads the gmnew binary per target on a tag. No network listener in any job.
2. scripts/: replace deoxidene.sh and deoxidene.ps1 with gmnew.sh and gmnew.ps1 that run the same steps for gm-new (configure, build, test, run doctor). Keep them small.
3. setup.sh: keep the Node setup as it is for now, and add a native section that configures and builds the preset and prints the binary path, without changing .mcp.json (cutover is a later decision).
4. README.md: add a short native section. Do not rewrite the Node sections.
5. Verify what can be verified here: shell syntax of the scripts (bash -n), YAML parse with node (node -e using a small parser or the yaml file read as text with a check of the structure), and that the scripts run the preset on Linux (build/ci). Report which parts are unverified (Windows and macOS).