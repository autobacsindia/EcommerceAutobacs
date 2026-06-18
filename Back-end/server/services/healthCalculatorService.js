import os from 'os';
import mongoose from 'mongoose';

/**
 * Health Calculator Service
 * Calculates health scores across multiple dimensions for the dashboard
 */
class HealthCalculatorService {
  constructor() {
    this.lastHealthData = null;
    this.lastCalculationTime = 0;
    this.alertHistory = [];
    this.CACHE_TTL = 8000; // 8 s — slightly under SSE health interval (10 s)
  }

  /**
   * Get comprehensive health metrics
   * @returns {Promise<Object>} Health metrics and scores
   */
  async getHealthMetrics() {
    // Return cached data if still valid
    const now = Date.now();
    if (this.lastHealthData && (now - this.lastCalculationTime) < this.CACHE_TTL) {
      return this.lastHealthData;
    }

    try {
      // Calculate all health dimensions
      const infrastructure = await this.calculateInfrastructureHealth();
      const database = await this.calculateDatabaseHealth();
      const application = await this.calculateApplicationHealth();
      const business = await this.calculateBusinessHealth();

      // Calculate overall health score with weighting
      const overallScore = this.calculateOverallScore({
        infrastructure: infrastructure.score,
        database: database.score,
        application: application.score,
        business: business.score
      });

      const healthData = {
        timestamp: now,
        overall: {
          score: overallScore,
          status: this.getHealthStatus(overallScore)
        },
        dimensions: {
          infrastructure,
          database,
          application,
          business
        }
      };

      // Check for alerts
      this.checkHealthAlerts(healthData);

      // Cache the result
      this.lastHealthData = healthData;
      this.lastCalculationTime = now;

      return healthData;
    } catch (error) {
      console.error('Error calculating health metrics:', error);
      return this.getFallbackHealthData();
    }
  }

  /**
   * Calculate infrastructure health (CPU, Memory, Disk, Uptime)
   * @returns {Object} Infrastructure health metrics
   */
  async calculateInfrastructureHealth() {
    try {
      const cpus = os.cpus();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const uptime = process.uptime();

      // Calculate CPU usage (average across all cores)
      const cpuUsage = cpus.reduce((acc, cpu) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        return acc + ((total - idle) / total) * 100;
      }, 0) / cpus.length;

      // Calculate memory usage percentage
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;

      // Score based on thresholds
      let cpuScore = 100;
      if (cpuUsage > 95) cpuScore = 30;
      else if (cpuUsage > 80) cpuScore = 60;
      else if (cpuUsage > 60) cpuScore = 80;

      let memoryScore = 100;
      if (memoryUsage > 95) memoryScore = 30;
      else if (memoryUsage > 85) memoryScore = 60;
      else if (memoryUsage > 70) memoryScore = 80;

      // Overall infrastructure score (average)
      const score = Math.round((cpuScore + memoryScore) / 2);

      return {
        score,
        status: this.getHealthStatus(score),
        metrics: {
          cpu: {
            usage: Math.round(cpuUsage * 10) / 10,
            cores: cpus.length,
            score: cpuScore
          },
          memory: {
            total: Math.round(totalMemory / (1024 * 1024 * 1024) * 10) / 10, // GB
            free: Math.round(freeMemory / (1024 * 1024 * 1024) * 10) / 10, // GB
            usage: Math.round(memoryUsage * 10) / 10,
            score: memoryScore
          },
          uptime: {
            seconds: Math.round(uptime),
            hours: Math.round(uptime / 3600 * 10) / 10
          }
        }
      };
    } catch (error) {
      console.error('Error calculating infrastructure health:', error);
      return { score: 50, status: 'unknown', metrics: {} };
    }
  }

  /**
   * Calculate database health (MongoDB connection, query performance)
   * @returns {Object} Database health metrics
   */
  async calculateDatabaseHealth() {
    try {
      const mongooseState = mongoose.connection.readyState;
      const isConnected = mongooseState === 1;

      if (!isConnected) {
        return {
          score: 0,
          status: 'critical',
          metrics: {
            connected: false,
            state: this.getMongooseStateString(mongooseState)
          }
        };
      }

      // Connection pool stats require the clusterMonitor role on the admin
      // database, which a standard Atlas app user does not have.
      // Mongoose exposes the pool size via its own connection object, which
      // is sufficient for health monitoring without needing admin privileges.
      const poolStats = {
        connections: {
          current: mongoose.connection.pool?.totalConnectionCount ?? null,
          available: mongoose.connection.pool?.availableConnectionCount ?? null
        }
      };

      // Calculate score based on connection state
      let score = 100;
      if (mongooseState !== 1) score = 0;

      return {
        score,
        status: this.getHealthStatus(score),
        metrics: {
          connected: isConnected,
          state: this.getMongooseStateString(mongooseState),
          connectionPool: poolStats
        }
      };
    } catch (error) {
      console.error('Error calculating database health:', error);
      return { score: 30, status: 'warning', metrics: { error: error.message } };
    }
  }

  /**
   * Calculate application health (API performance, error rates)
   * @returns {Object} Application health metrics
   */
  async calculateApplicationHealth() {
    try {
      // In a production system, this would query metrics from a monitoring system
      // For now, we'll use process metrics
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      let score = 100;
      if (heapUsedPercent > 90) score = 40;
      else if (heapUsedPercent > 75) score = 70;
      else if (heapUsedPercent > 60) score = 85;

      return {
        score,
        status: this.getHealthStatus(score),
        metrics: {
          heapUsed: Math.round(memUsage.heapUsed / (1024 * 1024) * 10) / 10, // MB
          heapTotal: Math.round(memUsage.heapTotal / (1024 * 1024) * 10) / 10, // MB
          heapUsedPercent: Math.round(heapUsedPercent * 10) / 10,
          external: Math.round(memUsage.external / (1024 * 1024) * 10) / 10 // MB
        }
      };
    } catch (error) {
      console.error('Error calculating application health:', error);
      return { score: 50, status: 'unknown', metrics: {} };
    }
  }

  /**
   * Calculate business process health
   * @returns {Object} Business health metrics
   */
  async calculateBusinessHealth() {
    // This would query actual business metrics from the database.
    // For now, return a baseline score.
    return {
      score: 85,
      status: 'healthy',
      metrics: {
        orderProcessing: 'normal',
        paymentGateway: 'operational'
      }
    };
  }

  /**
   * Calculate weighted overall health score
   * @param {Object} scores - Individual dimension scores
   * @returns {number} Overall health score
   */
  calculateOverallScore(scores) {
    const weights = {
      infrastructure: 0.3,
      database: 0.3,
      application: 0.25,
      business: 0.15
    };

    const overallScore = 
      (scores.infrastructure * weights.infrastructure) +
      (scores.database * weights.database) +
      (scores.application * weights.application) +
      (scores.business * weights.business);

    return Math.round(overallScore);
  }

  /**
   * Get health status based on score
   * @param {number} score - Health score (0-100)
   * @returns {string} Status string
   */
  getHealthStatus(score) {
    if (score >= 90) return 'healthy';
    if (score >= 70) return 'degraded';
    if (score >= 50) return 'warning';
    return 'critical';
  }

  /**
   * Get Mongoose connection state as string
   * @param {number} state - Mongoose readyState
   * @returns {string} State description
   */
  getMongooseStateString(state) {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    return states[state] || 'unknown';
  }

  /**
   * Check for health alerts based on score changes
   * @param {Object} healthData - Current health data
   */
  checkHealthAlerts(healthData) {
    const overallScore = healthData.overall.score;

    // Check for critical health
    if (overallScore < 50 && (!this.lastHealthData || this.lastHealthData.overall.score >= 50)) {
      this.addAlert({
        type: 'CRITICAL_HEALTH',
        severity: 'critical',
        message: `System health critical: ${overallScore}%`,
        timestamp: Date.now(),
        data: healthData
      });
    }

    // Check for warning health
    if (overallScore < 70 && overallScore >= 50 && (!this.lastHealthData || this.lastHealthData.overall.score >= 70)) {
      this.addAlert({
        type: 'WARNING_HEALTH',
        severity: 'warning',
        message: `System health degraded: ${overallScore}%`,
        timestamp: Date.now(),
        data: healthData
      });
    }

    // Check for rapid degradation
    if (this.lastHealthData && (this.lastHealthData.overall.score - overallScore) >= 20) {
      this.addAlert({
        type: 'RAPID_DEGRADATION',
        severity: 'critical',
        message: `Rapid health degradation detected: ${this.lastHealthData.overall.score}% → ${overallScore}%`,
        timestamp: Date.now(),
        data: healthData
      });
    }

    // Check for recovery
    if (overallScore >= 70 && this.lastHealthData && this.lastHealthData.overall.score < 70) {
      this.addAlert({
        type: 'HEALTH_RECOVERY',
        severity: 'info',
        message: `System health recovered: ${overallScore}%`,
        timestamp: Date.now(),
        data: healthData
      });
    }
  }

  /**
   * Add alert to history
   * @param {Object} alert - Alert data
   */
  addAlert(alert) {
    this.alertHistory.unshift(alert);
    // Keep only last 50 alerts
    if (this.alertHistory.length > 50) {
      this.alertHistory = this.alertHistory.slice(0, 50);
    }
  }

  /**
   * Get recent alerts
   * @param {number} limit - Number of alerts to return
   * @returns {Array} Recent alerts
   */
  getRecentAlerts(limit = 10) {
    return this.alertHistory.slice(0, limit);
  }

  /**
   * Get fallback health data when calculation fails
   * @returns {Object} Fallback health data
   */
  getFallbackHealthData() {
    return {
      timestamp: Date.now(),
      overall: {
        score: 50,
        status: 'unknown'
      },
      dimensions: {
        infrastructure: { score: 50, status: 'unknown', metrics: {} },
        database: { score: 50, status: 'unknown', metrics: {} },
        application: { score: 50, status: 'unknown', metrics: {} },
        business: { score: 50, status: 'unknown', metrics: {} }
      }
    };
  }
}

// Export singleton instance
export default new HealthCalculatorService();
