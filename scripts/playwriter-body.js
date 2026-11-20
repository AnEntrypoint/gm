await gm.read_file({ path: 'skill://gm/SKILL.md' });
return JSON.stringify(await gm.playwriter_execute({ code: 'return 1;' }));
