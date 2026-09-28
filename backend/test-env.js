require('dotenv').config();
const env = require('./config/env');
console.log('OLLAMA_BASE_URL:', env.OLLAMA_BASE_URL);
console.log('OLLAMA_MODEL:', env.OLLAMA_MODEL);
console.log('AI_SUPPORT_ENABLED:', env.AI_SUPPORT_ENABLED);