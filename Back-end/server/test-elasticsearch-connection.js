import dotenv from 'dotenv';
import { Client } from '@elastic/elasticsearch';

dotenv.config();

/**
 * Diagnostic tool to test Elasticsearch connectivity
 * This script helps troubleshoot connection issues
 */

console.log('=== Elasticsearch Connection Diagnostic Tool ===\n');

// Check if Elasticsearch is enabled
const enabled = process.env.ELASTICSEARCH_ENABLED === 'true';
console.log(`1. Elasticsearch Enabled: ${enabled ? '✓ YES' : '✗ NO'}`);

if (!enabled) {
  console.log('\n⚠ Elasticsearch is disabled in .env file');
  console.log('To enable: Set ELASTICSEARCH_ENABLED=true\n');
  process.exit(0);
}

// Display configuration
const node = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
const username = process.env.ELASTICSEARCH_USERNAME || 'elastic';
const password = process.env.ELASTICSEARCH_PASSWORD || 'changeme';
const retryTimeout = parseInt(process.env.ELASTICSEARCH_RETRY_TIMEOUT || '5000');

console.log('\n2. Configuration:');
console.log(`   Node URL: ${node}`);
console.log(`   Username: ${username}`);
console.log(`   Password: ${'*'.repeat(password.length)}`);
console.log(`   Timeout: ${retryTimeout}ms`);

// Test connection
console.log('\n3. Testing Connection...');

const client = new Client({
  node: node,
  auth: {
    username: username,
    password: password
  },
  requestTimeout: retryTimeout,
  maxRetries: 3
});

async function testConnection() {
  try {
    // Test basic connection
    console.log('   → Attempting to connect...');
    const info = await client.info();
    
    if (info.statusCode === 200) {
      console.log('   ✓ Connection successful!\n');
      
      // Display cluster information
      console.log('4. Cluster Information:');
      console.log(`   Cluster Name: ${info.cluster_name}`);
      console.log(`   Cluster UUID: ${info.cluster_uuid}`);
      console.log(`   Version: ${info.version.number}`);
      console.log(`   Lucene Version: ${info.version.lucene_version}`);
      
      // Test cluster health
      console.log('\n5. Checking Cluster Health...');
      const health = await client.cluster.health();
      console.log(`   Status: ${health.status}`);
      console.log(`   Nodes: ${health.number_of_nodes}`);
      console.log(`   Data Nodes: ${health.number_of_data_nodes}`);
      console.log(`   Active Shards: ${health.active_shards}`);
      
      // Check if products index exists
      console.log('\n6. Checking Products Index...');
      const indexExists = await client.indices.exists({ index: 'products' });
      
      if (indexExists) {
        console.log('   ✓ Products index exists');
        
        // Get index stats
        const stats = await client.indices.stats({ index: 'products' });
        const indexStats = stats.indices.products;
        const docCount = indexStats.total.docs.count;
        const sizeInBytes = indexStats.total.store.size_in_bytes;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
        
        console.log(`   Documents: ${docCount}`);
        console.log(`   Size: ${sizeInMB} MB`);
      } else {
        console.log('   ⚠ Products index does not exist');
        console.log('   To create: Run "npm run reindex-products"');
      }
      
      console.log('\n✓ Elasticsearch is ready to use!');
      console.log('================================================\n');
      
    } else {
      console.log(`   ✗ Unexpected status code: ${info.statusCode}\n`);
      process.exit(1);
    }
    
  } catch (error) {
    console.log('   ✗ Connection failed\n');
    
    console.log('4. Error Details:');
    console.log(`   Type: ${error.name}`);
    console.log(`   Message: ${error.message}`);
    
    if (error.meta) {
      console.log(`   Status Code: ${error.meta.statusCode || 'N/A'}`);
    }
    
    console.log('\n5. Troubleshooting Steps:');
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('   → Elasticsearch is not running or not accessible');
      console.log('   → Check if Elasticsearch service is started');
      console.log('   → Verify the node URL is correct');
    } else if (error.message.includes('Unauthorized') || error.message.includes('401')) {
      console.log('   → Authentication failed');
      console.log('   → Check username and password in .env file');
    } else if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
      console.log('   → Connection timeout');
      console.log('   → Check network connectivity');
      console.log('   → Try increasing ELASTICSEARCH_RETRY_TIMEOUT');
    } else if (error.message.includes('ENOTFOUND')) {
      console.log('   → Host not found');
      console.log('   → Check the ELASTICSEARCH_NODE URL in .env file');
    } else {
      console.log('   → Check Elasticsearch logs for more details');
      console.log('   → Ensure Elasticsearch is properly configured');
    }
    
    console.log('\n6. Common Solutions:');
    console.log('   • Start Elasticsearch: sudo systemctl start elasticsearch');
    console.log('   • Check status: curl http://localhost:9200');
    console.log('   • View logs: tail -f /var/log/elasticsearch/elasticsearch.log');
    console.log('   • Or disable: Set ELASTICSEARCH_ENABLED=false in .env');
    
    console.log('\n================================================\n');
    
    process.exit(1);
  } finally {
    // Close the client connection
    await client.close();
  }
}

// Run the test
testConnection();
