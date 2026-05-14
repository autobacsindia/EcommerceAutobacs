// Cache service split into modules under ./cache/
// This file is kept as a barrel for backward compatibility with existing imports.
export { default, CACHE_VERSION, CACHE_CONFIG, TTL, getRedisClient } from './cache/index.js';
