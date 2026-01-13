import AdaptiveThrottlingProfile from '../models/AdaptiveThrottlingProfile.js';
import rateLimitEventEmitter from './rateLimitEventEmitter.js';

class AdaptiveThrottlingService {
  constructor() {
    this.activeProfile = null;
    this.errorRateMonitor = new Map(); // Track error rates per endpoint
    this.checkInterval = null;
  }
  
  /**
   * Initialize the service and start monitoring
   */
  async initialize() {
    // Load active profile if exists
    await this.refreshActiveProfile();
    
    // Start scheduled profile checker (every minute)
    this.checkInterval = setInterval(() => {
      this.checkScheduledProfiles();
    }, 60000);
    
    console.log('✓ Adaptive Throttling Service initialized');
  }
  
  /**
   * Refresh active profile from database
   */
  async refreshActiveProfile() {
    try {
      this.activeProfile = await AdaptiveThrottlingProfile.getActiveProfile();
      if (this.activeProfile) {
        console.log(`✓ Active throttling profile loaded: ${this.activeProfile.name}`);
      }
    } catch (error) {
      console.error('Error refreshing active profile:', error);
    }
  }
  
  /**
   * Get adjusted rate limit for an endpoint
   * @param {string} endpoint - The endpoint to check
   * @param {number} defaultLimit - The default rate limit
   * @returns {number} - Adjusted rate limit or default if no profile active
   */
  getAdjustedLimit(endpoint, defaultLimit) {
    if (!this.activeProfile) {
      return defaultLimit;
    }
    
    const adjustedLimit = this.activeProfile.getAdjustedLimit(endpoint);
    return adjustedLimit !== null ? adjustedLimit : defaultLimit;
  }
  
  /**
   * Check if a profile is currently active
   */
  isProfileActive() {
    return this.activeProfile !== null && this.activeProfile.status === 'active';
  }
  
  /**
   * Get current active profile info
   */
  getActiveProfileInfo() {
    if (!this.activeProfile) {
      return null;
    }
    
    return {
      id: this.activeProfile._id,
      name: this.activeProfile.name,
      description: this.activeProfile.description,
      status: this.activeProfile.status,
      activatedAt: this.activeProfile.lastActivated,
      endpointCount: this.activeProfile.endpointAdjustments.length
    };
  }
  
  /**
   * Activate a profile
   */
  async activateProfile(profileId, adminUserId, reason = '') {
    try {
      const profile = await AdaptiveThrottlingProfile.findById(profileId);
      
      if (!profile) {
        throw new Error('Profile not found');
      }
      
      await profile.activate('admin', adminUserId, reason);
      await this.refreshActiveProfile();
      
      // Emit threshold change events for all adjusted endpoints
      profile.endpointAdjustments.forEach(adjustment => {
        const newLimit = Math.floor(adjustment.originalLimit * adjustment.multiplier);
        rateLimitEventEmitter.emitThresholdChange({
          endpoint: adjustment.endpointPattern,
          method: 'ALL',
          ipAddress: 'system',
          limitType: 'window',
          currentLimit: newLimit,
          oldLimit: adjustment.originalLimit,
          newLimit,
          changeReason: `Adaptive profile "${profile.name}" activated`,
          changedBy: adminUserId
        });
      });
      
      console.log(`✓ Activated adaptive throttling profile: ${profile.name}`);
      
      return profile;
    } catch (error) {
      console.error('Error activating profile:', error);
      throw error;
    }
  }
  
  /**
   * Deactivate current profile
   */
  async deactivateProfile(adminUserId, reason = '') {
    try {
      if (!this.activeProfile) {
        throw new Error('No active profile to deactivate');
      }
      
      const profile = this.activeProfile;
      await profile.deactivate('admin', adminUserId, reason);
      
      // Emit threshold change events for all endpoints (reverting to original)
      profile.endpointAdjustments.forEach(adjustment => {
        rateLimitEventEmitter.emitThresholdChange({
          endpoint: adjustment.endpointPattern,
          method: 'ALL',
          ipAddress: 'system',
          limitType: 'window',
          currentLimit: adjustment.originalLimit,
          oldLimit: Math.floor(adjustment.originalLimit * adjustment.multiplier),
          newLimit: adjustment.originalLimit,
          changeReason: `Adaptive profile "${profile.name}" deactivated`,
          changedBy: adminUserId
        });
      });
      
      console.log(`✓ Deactivated adaptive throttling profile: ${profile.name}`);
      
      this.activeProfile = null;
      
      return profile;
    } catch (error) {
      console.error('Error deactivating profile:', error);
      throw error;
    }
  }
  
  /**
   * Check for scheduled profiles that should activate/deactivate
   */
  async checkScheduledProfiles() {
    try {
      const { profilesToActivate, profilesToDeactivate } = await AdaptiveThrottlingProfile.checkScheduledProfiles();
      
      // Deactivate profiles first
      for (const profile of profilesToDeactivate) {
        await profile.deactivate('scheduled', null, 'Scheduled deactivation time reached');
        console.log(`✓ Auto-deactivated profile: ${profile.name} (scheduled)`);
      }
      
      // Then activate new profiles
      for (const profile of profilesToActivate) {
        await profile.activate('scheduled', null, 'Scheduled activation time reached');
        console.log(`✓ Auto-activated profile: ${profile.name} (scheduled)`);
      }
      
      // Refresh if any changes occurred
      if (profilesToActivate.length > 0 || profilesToDeactivate.length > 0) {
        await this.refreshActiveProfile();
      }
    } catch (error) {
      console.error('Error checking scheduled profiles:', error);
    }
  }
  
  /**
   * Monitor error rate and auto-deactivate if threshold exceeded
   */
  async monitorErrorRate(endpoint, isError) {
    if (!this.activeProfile || !this.activeProfile.safetyChecks.autoDeactivateOnError) {
      return;
    }
    
    const key = `error_rate:${endpoint}`;
    const now = Date.now();
    
    if (!this.errorRateMonitor.has(key)) {
      this.errorRateMonitor.set(key, {
        totalRequests: 0,
        errorRequests: 0,
        windowStart: now
      });
    }
    
    const monitor = this.errorRateMonitor.get(key);
    
    // Reset window if more than 1 minute old
    if (now - monitor.windowStart > 60000) {
      monitor.totalRequests = 0;
      monitor.errorRequests = 0;
      monitor.windowStart = now;
    }
    
    monitor.totalRequests++;
    if (isError) {
      monitor.errorRequests++;
    }
    
    // Check error rate (only if we have enough data)
    if (monitor.totalRequests >= 10) {
      const errorRate = (monitor.errorRequests / monitor.totalRequests) * 100;
      
      if (errorRate > this.activeProfile.safetyChecks.errorRateThreshold) {
        console.warn(`⚠ Error rate ${errorRate.toFixed(2)}% exceeds threshold on ${endpoint}`);
        console.warn(`⚠ Auto-deactivating profile: ${this.activeProfile.name}`);
        
        await this.activeProfile.deactivate('auto', null, `Error rate ${errorRate.toFixed(2)}% exceeded threshold`, errorRate);
        this.activeProfile = null;
        
        // Clear error rate monitor
        this.errorRateMonitor.clear();
      }
    }
  }
  
  /**
   * Clean up on shutdown
   */
  shutdown() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    console.log('✓ Adaptive Throttling Service shut down');
  }
}

// Create singleton instance
const adaptiveThrottlingService = new AdaptiveThrottlingService();

export default adaptiveThrottlingService;
