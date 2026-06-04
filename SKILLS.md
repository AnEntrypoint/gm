# SKILLS.md — Skill Discovery Tool

## Purpose

This file enables the agent to dynamically discover available skills in the project.
If the agent doesn't know which skills exist before starting a task,
it must run the command below to get the current skill list.

---

## Getting the Skill List

Run the following command to list all skills in the project:

```bash
uvx --from skills-cli skills to-prompt ./skills/* --format yaml
```

### Example Output

```yaml
available_skills:
  - name: data-analysis
    description: Used for reading, analyzing, and summarizing CSV, JSON, and tabular data.
    location: ./skills/data-analysis/SKILL.md
  - name: pdf-reader
    description: Used when text or tables need to be extracted from PDF files.
    location: ./skills/pdf-reader/SKILL.md
  - name: code-reviewer
    description: Used to evaluate code quality, security, and best practice compliance.
    location: ./skills/code-reviewer/SKILL.md
```

### Output Fields

| Field         | Description                                                        |
|---------------|--------------------------------------------------------------------|
| `name`        | Short identifier for the skill                                     |
| `description` | What the skill does and when it should be used                     |
| `location`    | Full path to the skill's SKILL.md — read this file before using it |

---

## Skill Usage Flow

```
1. Agent doesn't know which skills are needed for the task
         ->
2. Run the command above to get the available_skills list
         ->
3. Read the description fields to identify the right skill
         ->
4. Read the SKILL.md file at the skill's location path
         ->
5. Complete the task following the instructions in SKILL.md
```

---

## Rules

- **Always discover first:** If you don't know the available skills, run the command — don't assume.
- **Read description carefully:** The `description` field determines which skill to use.
- **Read from location:** Always read the SKILL.md at the `location` path before using a skill.
- **Multiple skills:** If the task requires more than one skill, read all relevant SKILL.md files.
- **No skill found:** If no suitable skill exists, proceed with your general knowledge and note it.