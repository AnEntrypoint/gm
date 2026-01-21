module.exports = [
  {
    name: 'shell',
    description: 'Execute shell commands',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms', default: 30000 }
      },
      required: ['command']
    }
  },
  {
    name: 'file_write',
    description: 'Write or modify files',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['create', 'append', 'overwrite'], default: 'overwrite' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'file_glob',
    description: 'Find files matching pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        exclude: { type: 'array' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'file_search',
    description: 'Search file content',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        files: { type: 'string' },
        context_lines: { type: 'number', default: 2 }
      },
      required: ['pattern']
    }
  },
  {
    name: 'semantic_search',
    description: 'AI-powered semantic search',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        scope: { type: 'string' }
      },
      required: ['query']
    }
  }
];
