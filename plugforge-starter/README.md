# glootius maximus (gm)
GM is a claude code plugin that adds code search and execution mcp tooling, with a policy opinionation that was built over time through daily use and testing.

tl/dr: 
```
claude plugin marketplace add AnEntrypoint/gm
claude plugin install -s user gm@gm
#update
# claude plugin marketplace update gm
# claude plugin update gm@gm
# SET UP AN ALIAS FOR THAT
mkdir -p ~/.local/bin && echo -e '#!/bin/sh\nclaude plugin marketplace update gm' > ~/.local/bin/gmupdate && chmod +x ~/.local/bin/gmupdate && echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

It should 'just work' but if you want to make sure the sub agent always calls, you can add 'gm everything' to your prompt

This is my personal dev workflow on discovering the best approach to automatic use of this, and use glootie for everything is already included as a system prompt, however prompting it does appear to help right now

the plugin marketplace will appear as 'gm'
the mcp tools will appear under the 'gm' plugin
plugin:gm:dev is how it will now execute all code, giving a controllable environment for execution, currently the recommended way to add client side coding abilities to this tool is playwriter:
https://github.com/remorses/playwriter
NOTE: playwriter uses a browser plugin, be sure to grab and activate that too to get browser access

what glootie does is it enacts a system policy as a virtual state machine that the LLM then has to try and emulate, enforces the use of code execution instead of file edit and run loops, adds:

code-search - external dependency-free code search

dev (mcp-glootie) - local execution in any language (replaces bash and create/run/read/edit/run loops) 

gm agent (only agent you need, also system prompt hook) - strong, opinionated state machine-like coding policy, self cleaning, self correcting (instead of traditional learning), self re-architecting, grounding-over-stasis policies, with optimizations for LLM context based on long-term heuristic benchmarks in token reduction and execution accuracy, ideas like not commenting the code. Strong policy based on research of context compaction, latent space extraction, linguistic hyperparameters, LLM state machine emulation, embedding machines like WFGY is the basis for the concepts behind the system prompt, but its been optimized for human edinting

looping (stop hook) - a more refined alternative to wiggum looping: including the native behaviors that claude code does during planning with better tooling preferences, and having a revision loop at the end with conversation insight as experimental improvements on wiggum looping (no special commands required, its built in)

git enforcement (stop hook) - always pushes code after updates (make sure you have init and a git remote)

ast analysis (thorns) - automated one-shot ast at conversation start offsets the need for explorative ast with compact context and less turns, code-search provides explorative discovery semantically, and code execution and reading being its final stage

policy - no md and txt creation, some built in tools force redirected to better tools

<img width="225" height="325" alt="image" src="https://github.com/user-attachments/assets/866e6861-a2e2-490d-8bd0-ec558753dbed" />

**Note:** we use gxe as an npx-to-github proxy to start the tools faster and keep them up-to-date, if you ever need to fix an issue with partial installs or something, just delete ~/.gxe and try again

https://www.youtube.com/clip/UgkxMczBOi4uGHRFOb4J-R28kELLfWnzSN7R

<!-- Stop hook test: 2026-01-13 -->



