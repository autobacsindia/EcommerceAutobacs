/**
 * WordPress Debug Utilities
 * 
 * Utility functions to help debug WordPress API integration issues
 */

export const wordpressDebug = {
  /**
   * Check if WordPress environment variables are configured
   */
  checkEnvironmentConfig: () => {
    const config = {
      siteUrl: process.env.NEXT_PUBLIC_WORDPRESS_SITE_URL,
      apiVersion: process.env.NEXT_PUBLIC_WORDPRESS_API_VERSION,
      consumerKey: process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY,
      consumerSecret: process.env.NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET
    };
    
    const isConfigured = !!(config.siteUrl && config.consumerKey && config.consumerSecret);
    
    return {
      ...config,
      isConfigured,
      missing: [
        !config.siteUrl && 'NEXT_PUBLIC_WORDPRESS_SITE_URL',
        !config.apiVersion && 'NEXT_PUBLIC_WORDPRESS_API_VERSION',
        !config.consumerKey && 'NEXT_PUBLIC_WORDPRESS_CONSUMER_KEY',
        !config.consumerSecret && 'NEXT_PUBLIC_WORDPRESS_CONSUMER_SECRET'
      ].filter(Boolean) as string[]
    };
  },
  
  /**
   * Log detailed debug information about WordPress API configuration
   */
  logConfig: () => {
    const config = wordpressDebug.checkEnvironmentConfig();
    
    console.group('WordPress API Configuration Debug');
    console.log('Site URL:', config.siteUrl || 'NOT SET');
    console.log('API Version:', config.apiVersion || 'NOT SET');
    console.log('Consumer Key Present:', !!config.consumerKey);
    console.log('Consumer Secret Present:', !!config.consumerSecret);
    console.log('Fully Configured:', config.isConfigured);
    
    if (config.missing.length > 0) {
      console.log('Missing Configuration:', config.missing.join(', '));
    }
    
    console.groupEnd();
    
    return config;
  },
  
  /**
   * Test basic connectivity to WordPress site
   */
  testConnectivity: async (siteUrl: string) => {
    try {
      const response = await fetch(siteUrl, { 
        method: 'HEAD',
        mode: 'cors'
      });
      
      return {
        success: response.ok,
        status: response.status,
        statusText: response.statusText
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  },
  
  /**
   * Validate WordPress REST API endpoints
   */
  validateEndpoints: (siteUrl: string) => {
    const baseUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
    
    return {
      restBase: `${baseUrl}/wp-json`,
      vehicles: `${baseUrl}/wp-json/wp/v2/vehicle`,
      products: `${baseUrl}/wp-json/wc/v3/products`
    };
  }
};

export default wordpressDebug;