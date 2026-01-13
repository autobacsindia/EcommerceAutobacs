import { EventEmitter } from 'events';
import RateLimitEvent from '../models/RateLimitEvent.js';

class RateLimitEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.inMemoryStore = [];
    this.maxInMemoryEvents = 1000; // Keep last 1000 events in memory for real-time dashboard
    
    // Set up event listeners
    this.setupListeners();
  }
  
  setupListeners() {
    // Listen for rate limit events and persist to database
    this.on('rate_limit_event', async (eventData) => {
      try {
        // Store in memory for real-time access
        this.storeInMemory(eventData);
        
        // Persist to MongoDB (async, non-blocking)
        await this.persistToDatabase(eventData);
      } catch (error) {
        console.error('Error handling rate limit event:', error);
      }
    });
  }
  
  storeInMemory(eventData) {
    this.inMemoryStore.push({
      ...eventData,
      timestamp: new Date()
    });
    
    // Keep only the most recent events
    if (this.inMemoryStore.length > this.maxInMemoryEvents) {
      this.inMemoryStore.shift();
    }
  }
  
  async persistToDatabase(eventData) {
    try {
      await RateLimitEvent.create({
        ...eventData,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Failed to persist rate limit event to database:', error);
    }
  }
  
  // Emit a rate limit hit event
  emitHit(data) {
    this.emit('rate_limit_event', {
      eventType: 'hit',
      ...data
    });
  }
  
  // Emit a rate limit block event
  emitBlock(data) {
    this.emit('rate_limit_event', {
      eventType: 'block',
      ...data
    });
  }
  
  // Emit a retry success event
  emitRetrySuccess(data) {
    this.emit('rate_limit_event', {
      eventType: 'retry_success',
      ...data
    });
  }
  
  // Emit a retry failure event
  emitRetryFailure(data) {
    this.emit('rate_limit_event', {
      eventType: 'retry_failure',
      ...data
    });
  }
  
  // Emit a threshold change event
  emitThresholdChange(data) {
    this.emit('rate_limit_event', {
      eventType: 'threshold_change',
      ...data
    });
  }
  
  // Get in-memory events for real-time dashboard
  getRecentEvents(limit = 100) {
    return this.inMemoryStore.slice(-limit);
  }
  
  // Get events by type from memory
  getRecentEventsByType(eventType, limit = 100) {
    return this.inMemoryStore
      .filter(event => event.eventType === eventType)
      .slice(-limit);
  }
  
  // Get real-time statistics
  getRealtimeStats() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000; // 1 minute
    
    const recentEvents = this.inMemoryStore.filter(event => 
      event.timestamp && event.timestamp.getTime() > oneMinuteAgo
    );
    
    const stats = {
      total: recentEvents.length,
      byType: {},
      byEndpoint: {},
      uniqueIPs: new Set(),
      uniqueUsers: new Set()
    };
    
    recentEvents.forEach(event => {
      // Count by type
      stats.byType[event.eventType] = (stats.byType[event.eventType] || 0) + 1;
      
      // Count by endpoint
      if (event.endpoint) {
        stats.byEndpoint[event.endpoint] = (stats.byEndpoint[event.endpoint] || 0) + 1;
      }
      
      // Track unique IPs
      if (event.ipAddress) {
        stats.uniqueIPs.add(event.ipAddress);
      }
      
      // Track unique users
      if (event.userId) {
        stats.uniqueUsers.add(event.userId.toString());
      }
    });
    
    // Convert sets to counts
    stats.uniqueIPCount = stats.uniqueIPs.size;
    stats.uniqueUserCount = stats.uniqueUsers.size;
    delete stats.uniqueIPs;
    delete stats.uniqueUsers;
    
    return stats;
  }
  
  // Clear old in-memory events (cleanup)
  cleanupInMemory(maxAgeMs = 3600000) { // Default 1 hour
    const now = Date.now();
    this.inMemoryStore = this.inMemoryStore.filter(event =>
      event.timestamp && (now - event.timestamp.getTime()) < maxAgeMs
    );
  }
}

// Create singleton instance
const rateLimitEventEmitter = new RateLimitEventEmitter();

// Export both the instance and the class
export default rateLimitEventEmitter;
export { RateLimitEventEmitter };
