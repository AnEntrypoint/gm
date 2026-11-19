await gm.read_file({ path: 'skill://gm/SKILL.md' });
await new Promise((resolve) => setTimeout(resolve, 60000));
return 'gap done';
