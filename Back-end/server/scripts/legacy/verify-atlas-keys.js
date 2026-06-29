/**
 * MongoDB Atlas API Key Verification Script
 * 
 * Tests if your new API keys are working correctly.
 * 
 * Usage:
 * 1. Update .env file with NEW keys
 * 2. Run: node verify-atlas-keys.js
 * 3. Check output for success/errors
 */

import dotenv from 'dotenv';
dotenv.config();

import https from 'https';

const PUBLIC_KEY = process.env.MONGODB_ATLAS_PUBLIC_API_KEY;
const PRIVATE_KEY = process.env.MONGODB_ATLAS_PRIVATE_API_KEY;
const PROJECT_ID = process.env.MONGODB_ATLAS_PROJECT_ID;
const CLUSTER_NAME = process.env.MONGODB_ATLAS_CLUSTER_NAME;

console.log('🔍 MongoDB Atlas API Key Verification\n');
console.log('═══════════════════════════════════════\n');

// Check if keys are configured
if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.error('❌ ERROR: API keys not configured!');
  console.error('\nPlease set these environment variables:');
  console.error('  MONGODB_ATLAS_PUBLIC_API_KEY=<your_public_key>');
  console.error('  MONGODB_ATLAS_PRIVATE_API_KEY=<your_private_key>');
  console.error('\nIn Railway: Go to Project > Variables and add these.');
  process.exit(1);
}

// Mask keys for display
const maskKey = (key) => {
  if (!key) return 'NOT SET';
  return key.substring(0, 4) + '...' + key.substring(key.length - 4);
};

console.log('📋 Configuration:');
console.log(`   Public Key:  ${maskKey(PUBLIC_KEY)}`);
console.log(`   Private Key: ${maskKey(PRIVATE_KEY)}`);
console.log(`   Project ID:  ${PROJECT_ID || 'NOT SET'}`);
console.log(`   Cluster:     ${CLUSTER_NAME || 'NOT SET'}`);
console.log('');

// Test 1: Basic authentication
console.log('🧪 Test 1: API Authentication');
console.log('─────────────────────────────');

const auth = Buffer.from(`${PUBLIC_KEY}:${PRIVATE_KEY}`).toString('base64');

const options = {
  hostname: 'cloud.mongodb.com',
  port: 443,
  path: `/api/atlas/v2/orgs`,
  method: 'GET',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (res.statusCode === 200) {
        console.log('✅ SUCCESS: API keys are valid!');
        console.log(`   Status: ${res.statusCode}`);
        console.log(`   Organizations found: ${response.totalCount || 0}`);
        console.log('');
        
        // Test 2: Project access
        console.log('🧪 Test 2: Project Access');
        console.log('─────────────────────────');
        
        if (!PROJECT_ID) {
          console.warn('⚠️  WARNING: MONGODB_ATLAS_PROJECT_ID not set');
          console.warn('   Cannot verify project access');
          console.log('');
        } else {
          const projectOptions = {
            hostname: 'cloud.mongodb.com',
            port: 443,
            path: `/api/atlas/v2/groups/${PROJECT_ID}`,
            method: 'GET',
            headers: {
              'Authorization': `Basic ${auth}`,
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          };
          
          const projectReq = https.request(projectOptions, (projectRes) => {
            let projectData = '';
            
            projectRes.on('data', (chunk) => {
              projectData += chunk;
            });
            
            projectRes.on('end', () => {
              try {
                const projectResponse = JSON.parse(projectData);
                
                if (projectRes.statusCode === 200) {
                  console.log('✅ SUCCESS: Project access verified!');
                  console.log(`   Project ID: ${PROJECT_ID}`);
                  console.log(`   Project Name: ${projectResponse.name || 'Unknown'}`);
                  console.log('');
                  
                  // Test 3: Cluster access
                  console.log('🧪 Test 3: Cluster Access');
                  console.log('────────────────────────');
                  
                  if (!CLUSTER_NAME) {
                    console.warn('⚠️  WARNING: MONGODB_ATLAS_CLUSTER_NAME not set');
                    console.warn('   Cannot verify cluster access');
                    console.log('');
                  } else {
                    const clusterOptions = {
                      hostname: 'cloud.mongodb.com',
                      port: 443,
                      path: `/api/atlas/v2/groups/${PROJECT_ID}/clusters/${CLUSTER_NAME}`,
                      method: 'GET',
                      headers: {
                        'Authorization': `Basic ${auth}`,
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                      }
                    };
                    
                    const clusterReq = https.request(clusterOptions, (clusterRes) => {
                      let clusterData = '';
                      
                      clusterRes.on('data', (chunk) => {
                        clusterData += chunk;
                      });
                      
                      clusterRes.on('end', () => {
                        try {
                          const clusterResponse = JSON.parse(clusterData);
                          
                          if (clusterRes.statusCode === 200) {
                            console.log('✅ SUCCESS: Cluster access verified!');
                            console.log(`   Cluster Name: ${CLUSTER_NAME}`);
                            console.log(`   Cluster State: ${clusterResponse.stateName || 'Unknown'}`);
                            console.log(`   MongoDB Version: ${clusterResponse.mongoDBVersion || 'Unknown'}`);
                            console.log('');
                            
                            // Final summary
                            console.log('═══════════════════════════════════════');
                            console.log('✅ ALL TESTS PASSED!');
                            console.log('═══════════════════════════════════════');
                            console.log('');
                            console.log('Your new MongoDB Atlas API keys are working correctly.');
                            console.log('You can safely delete the old keys.');
                            console.log('');
                            console.log('Next steps:');
                            console.log('1. ✅ Update Railway environment variables');
                            console.log('2. ✅ Delete old API keys from MongoDB Atlas');
                            console.log('3. ✅ Test your application');
                            console.log('4. ✅ Monitor logs for any authentication errors');
                            
                          } else {
                            console.error(`❌ FAILED: Cluster access denied`);
                            console.error(`   Status: ${clusterRes.statusCode}`);
                            console.error(`   Error: ${clusterResponse.detail || clusterResponse.error || 'Unknown'}`);
                            console.log('');
                            console.log('⚠️  Your API keys work, but cluster access may be misconfigured.');
                            console.log('   Check that your API key has Project Owner or Project Data Access Admin role.');
                          }
                        } catch (e) {
                          console.error('❌ FAILED: Could not parse cluster response');
                          console.error(`   Error: ${e.message}`);
                        }
                      });
                    });
                    
                    clusterReq.on('error', (e) => {
                      console.error('❌ FAILED: Network error');
                      console.error(`   Error: ${e.message}`);
                    });
                    
                    clusterReq.end();
                  }
                  
                } else {
                  console.error(`❌ FAILED: Project access denied`);
                  console.error(`   Status: ${projectRes.statusCode}`);
                  console.error(`   Error: ${projectResponse.detail || projectResponse.error || 'Unknown'}`);
                  console.log('');
                  console.log('⚠️  Your API keys work, but project access may be misconfigured.');
                  console.log('   Verify the PROJECT_ID is correct and API key has access to this project.');
                }
              } catch (e) {
                console.error('❌ FAILED: Could not parse project response');
                console.error(`   Error: ${e.message}`);
              }
            });
          });
          
          projectReq.on('error', (e) => {
            console.error('❌ FAILED: Network error');
            console.error(`   Error: ${e.message}`);
          });
          
          projectReq.end();
        }
        
      } else {
        console.error(`❌ FAILED: API authentication failed`);
        console.error(`   Status: ${res.statusCode}`);
        console.error(`   Error: ${response.detail || response.error || 'Unknown'}`);
        console.log('');
        console.log('Possible issues:');
        console.log('  - API keys are incorrect');
        console.log('  - API keys have been revoked');
        console.log('  - IP address not whitelisted in MongoDB Atlas');
        console.log('');
        console.log('To fix:');
        console.log('  1. Verify you copied the keys correctly');
        console.log('  2. Check MongoDB Atlas > Security > API Keys');
        console.log('  3. Ensure your IP is whitelisted (Network Access)');
      }
    } catch (e) {
      console.error('❌ FAILED: Could not parse response');
      console.error(`   Error: ${e.message}`);
    }
  });
});

req.on('error', (e) => {
  console.error('❌ FAILED: Network error');
  console.error(`   Error: ${e.message}`);
  console.log('');
  console.log('Possible issues:');
  console.log('  - DNS resolution failed');
  console.log('  - Network connectivity issue');
  console.log('  - Firewall blocking connection');
});

req.end();
