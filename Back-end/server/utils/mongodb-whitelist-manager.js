import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class MongoDBWhitelistManager {
  constructor() {
    this.publicKey = process.env.MONGODB_ATLAS_PUBLIC_API_KEY;
    this.privateKey = process.env.MONGODB_ATLAS_PRIVATE_API_KEY;
    this.projectId = process.env.MONGODB_ATLAS_PROJECT_ID;
    this.clusterName = process.env.MONGODB_ATLAS_CLUSTER_NAME;
    
    // Validate required configuration
    if (!this.publicKey || !this.privateKey || !this.projectId || !this.clusterName) {
      throw new Error('Missing required MongoDB Atlas configuration. Please set all MONGODB_ATLAS_* environment variables.');
    }
    
    this.baseUrl = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${this.projectId}`;
    this.auth = {
      username: this.publicKey,
      password: this.privateKey
    };
  }
  
  /**
   * Get current public IP address
   */
  async getCurrentIP() {
    const services = [
      'https://api.ipify.org',
      'https://icanhazip.com',
      'https://ident.me'
    ];
    
    for (const service of services) {
      try {
        const response = await axios.get(service, { timeout: 5000 });
        const ip = response.data.trim();
        // Validate IP format
        if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
          return ip;
        }
      } catch (error) {
        console.warn(`Failed to get IP from ${service}:`, error.message);
      }
    }
    
    throw new Error('Failed to get current IP address from all services');
  }
  
  /**
   * Add an IP address to the whitelist
   */
  async addIP(ipAddress, description = 'Added by whitelist manager', ttlHours = 24) {
    try {
      const url = `${this.baseUrl}/accessList`;
      
      // Calculate expiration date if ttl is specified
      let expiresAt = undefined;
      if (ttlHours && ttlHours > 0) {
        const expirationDate = new Date();
        expirationDate.setHours(expirationDate.getHours() + ttlHours);
        expiresAt = expirationDate.toISOString();
      }
      
      const payload = {
        ipAddress: ipAddress,
        comment: description
      };
      
      if (expiresAt) {
        payload.deleteAfterDate = expiresAt;
      }
      
      const response = await axios.post(url, payload, {
        auth: this.auth,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`✓ IP address ${ipAddress} added to whitelist successfully`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.data && error.response.data.detail) {
        throw new Error(`Failed to add IP to whitelist: ${error.response.data.detail}`);
      }
      throw new Error(`Failed to add IP to whitelist: ${error.message}`);
    }
  }
  
  /**
   * Remove an IP address from the whitelist
   */
  async removeIP(ipAddress) {
    try {
      const url = `${this.baseUrl}/accessList/${encodeURIComponent(ipAddress)}`;
      
      const response = await axios.delete(url, {
        auth: this.auth
      });
      
      console.log(`✓ IP address ${ipAddress} removed from whitelist successfully`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error(`IP address ${ipAddress} not found in whitelist`);
      }
      if (error.response && error.response.data && error.response.data.detail) {
        throw new Error(`Failed to remove IP from whitelist: ${error.response.data.detail}`);
      }
      throw new Error(`Failed to remove IP from whitelist: ${error.message}`);
    }
  }
  
  /**
   * List all IP addresses in the whitelist
   */
  async listIPs() {
    try {
      const url = `${this.baseUrl}/accessList`;
      
      const response = await axios.get(url, {
        auth: this.auth
      });
      
      return response.data;
    } catch (error) {
      if (error.response && error.response.data && error.response.data.detail) {
        throw new Error(`Failed to list whitelist: ${error.response.data.detail}`);
      }
      throw new Error(`Failed to list whitelist: ${error.message}`);
    }
  }
  
  /**
   * Add current IP with automatic expiration
   */
  async addCurrentIP(description = 'Development machine', ttlHours = 24) {
    try {
      const currentIP = await this.getCurrentIP();
      const fullDescription = `${description} - Added on ${new Date().toISOString().split('T')[0]}`;
      return await this.addIP(currentIP, fullDescription, ttlHours);
    } catch (error) {
      throw new Error(`Failed to add current IP to whitelist: ${error.message}`);
    }
  }
  
  /**
   * Check if an IP is already in the whitelist
   */
  async isIPWhitelisted(ipAddress) {
    try {
      const whitelist = await this.listIPs();
      return whitelist.results.some(entry => entry.ipAddress === ipAddress);
    } catch (error) {
      throw new Error(`Failed to check whitelist: ${error.message}`);
    }
  }
}

export default MongoDBWhitelistManager;