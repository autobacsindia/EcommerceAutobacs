export { CACHE_VERSION, CACHE_CONFIG, TTL } from './config.js';
export { getRedisClient } from './redisClient.js';
import CacheService from './CacheService.js';

export default new CacheService();
