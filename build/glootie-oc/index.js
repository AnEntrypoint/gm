export const glootie = async ({ project, client, $, directory, worktree }) => {
  return {
    hooks: {
      sessionStart: require('./hooks/session-start-hook.js'),
      preTool: require('./hooks/pre-tool-use-hook.js'),
      promptSubmit: require('./hooks/prompt-submit-hook.js'),
      stop: require('./hooks/stop-hook.js'),
      stopGit: require('./hooks/stop-hook-git.js')
    }
  };
};
