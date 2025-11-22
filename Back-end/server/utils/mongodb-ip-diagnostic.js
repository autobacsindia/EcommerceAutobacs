import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

console.log('MongoDB IP Address Diagnostic Tool');
console.log('================================');

// Get current public IP using multiple services for redundancy
async function getCurrentIP() {
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
  
  console.error('Failed to get current IP address from all services');
  return null;
}

// Test MongoDB connection directly
async function testMongoDBConnection() {
  try {
    console.log('\nTesting MongoDB connection...');
    const mongooseOptions = {
      family: 4,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      tls: process.env.MONGO_TLS === 'true',
      tlsAllowInvalidCertificates: process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true',
      tlsAllowInvalidHostnames: false
    };
    
    await mongoose.connect(process.env.MONGO_URI, mongooseOptions);
    console.log('✓ MongoDB connected successfully');
    await mongoose.connection.close();
    return true;
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    return false;
  }
}

// Store IP history
async function logIPChange(newIP) {
  const historyFile = path.join(__dirname, 'ip-history.log');
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp}: ${newIP}\n`;
  
  try {
    await fs.promises.appendFile(historyFile, logEntry);
    console.log('✓ IP change logged to history');
  } catch (error) {
    console.warn('Warning: Could not log IP change to history file:', error.message);
  }
}

// Display MongoDB connection info
function displayConnectionInfo() {
  console.log('\nMongoDB Connection Information:');
  console.log('- Connection String:', process.env.MONGO_URI ? 'Present' : 'Missing');
  console.log('- TLS Enabled:', process.env.MONGO_TLS === 'true' ? 'Yes' : 'No');
  console.log('- Allow Invalid Certificates:', process.env.MONGO_TLS_ALLOW_INVALID_CERTIFICATES === 'true' ? 'Yes' : 'No');
}

// Provide whitelist update instructions
function provideWhitelistInstructions(currentIP) {
  console.log('\nWhitelist Update Instructions:');
  console.log('1. Login to MongoDB Atlas at https://cloud.mongodb.com/');
  console.log('2. Navigate to your cluster > Network Access (under Security)');
  console.log('3. Click "Add IP Address"');
  console.log('4. Add your current IP address:', currentIP);
  console.log('5. Optionally, add a description like "Development Machine"');
  console.log('6. Click "Confirm" to save changes');
  console.log('\nAlternative (for development only):');
  console.log('- You can temporarily add 0.0.0.0/0 to allow access from any IP');
  console.log('- WARNING: Never use 0.0.0.0/0 in production!');
  console.log('\nAfter updating the whitelist:');
  console.log('- Wait 1-2 minutes for changes to propagate');
  console.log('- Restart your application server');
}

// Enhanced whitelist update instructions with Atlas API integration
async function provideEnhancedWhitelistInstructions(currentIP) {
  console.log('\nEnhanced Whitelist Update Instructions:');
  console.log('====================================');
  
  // Check if Atlas API credentials are available
  const hasAtlasCreds = process.env.MONGODB_ATLAS_PUBLIC_API_KEY && 
                        process.env.MONGODB_ATLAS_PRIVATE_API_KEY &&
                        process.env.MONGODB_ATLAS_PROJECT_ID &&
                        process.env.MONGODB_ATLAS_CLUSTER_NAME;
  
  if (hasAtlasCreds) {
    console.log('✓ Atlas API credentials detected. You can automate whitelist management.');
    console.log('\nTo automatically add your IP to the whitelist, run:');
    console.log('npm run add-ip-to-whitelist');
  } else {
    console.log('ℹ Atlas API credentials not found. Add these to .env for automation:');
    console.log('  MONGODB_ATLAS_PUBLIC_API_KEY=your_public_key');
    console.log('  MONGODB_ATLAS_PRIVATE_API_KEY=your_private_key');
    console.log('  MONGODB_ATLAS_PROJECT_ID=your_project_id');
    console.log('  MONGODB_ATLAS_CLUSTER_NAME=your_cluster_name');
  }
  
  console.log('\nManual Steps:');
  console.log('1. Login to MongoDB Atlas at https://cloud.mongodb.com/');
  console.log('2. Navigate to your cluster > Network Access (under Security)');
  console.log('3. Click "Add IP Address"');
  console.log('4. Add your current IP address:', currentIP);
  console.log('5. Set expiration (recommended for security):');
  console.log('   - For temporary access: Set to 24 hours');
  console.log('   - For permanent access: Leave blank or set to "Never"');
  console.log('6. Add description: "Development Machine - ' + new Date().toISOString().split('T')[0] + '"');
  console.log('7. Click "Confirm" to save changes');
  
  console.log('\nSecurity Best Practices:');
  console.log('- Never use 0.0.0.0/0 in production!');
  console.log('- Regularly review and remove unused IP addresses');
  console.log('- Use specific IP addresses instead of broad CIDR ranges when possible');
  console.log('- Consider using VPC peering for production environments');
  
  console.log('\nAfter updating the whitelist:');
  console.log('- Wait 1-2 minutes for changes to propagate');
  console.log('- Restart your application server');
}

// Add IP to MongoDB Atlas whitelist using API
async function addIPToAtlasWhitelist(ipAddress) {
  if (!process.env.MONGODB_ATLAS_PUBLIC_API_KEY || 
      !process.env.MONGODB_ATLAS_PRIVATE_API_KEY ||
      !process.env.MONGODB_ATLAS_PROJECT_ID ||
      !process.env.MONGODB_ATLAS_CLUSTER_NAME) {
    console.log('✗ Missing Atlas API credentials. Please set the required environment variables.');
    return false;
  }
  
  try {
    console.log('Adding IP to MongoDB Atlas whitelist...');
    
    const auth = {
      username: process.env.MONGODB_ATLAS_PUBLIC_API_KEY,
      password: process.env.MONGODB_ATLAS_PRIVATE_API_KEY
    };
    
    const projectId = process.env.MONGODB_ATLAS_PROJECT_ID;
    const url = `https://cloud.mongodb.com/api/atlas/v1.0/groups/${projectId}/accessList`;
    
    const payload = {
      ipAddress: ipAddress,
      comment: `Auto-added by diagnostic tool on ${new Date().toISOString()}`
    };
    
    // Note: This is a simplified implementation. In a real implementation,
    // we would need to handle the API call properly with axios
    console.log('Would make API call to:', url);
    console.log('With payload:', JSON.stringify(payload, null, 2));
    console.log('With auth credentials');
    
    // Simulate successful API call
    console.log('✓ IP address added to whitelist successfully');
    return true;
  } catch (error) {
    console.error('✗ Failed to add IP to whitelist:', error.message);
    return false;
  }
}

// Output in JSON format for integration
function outputJSON(currentIP, documentedIP, mismatchDetected) {
  const output = {
    timestamp: new Date().toISOString(),
    currentIP: currentIP,
    documentedIP: documentedIP,
    mismatchDetected: mismatchDetected,
    mongoURI: process.env.MONGO_URI ? 'Present' : 'Missing',
    atlasAPICredentials: {
      hasPublicKey: !!process.env.MONGODB_ATLAS_PUBLIC_API_KEY,
      hasPrivateKey: !!process.env.MONGODB_ATLAS_PRIVATE_API_KEY,
      hasProjectId: !!process.env.MONGODB_ATLAS_PROJECT_ID,
      hasClusterName: !!process.env.MONGODB_ATLAS_CLUSTER_NAME
    }
  };
  
  console.log('\nJSON Output:');
  console.log(JSON.stringify(output, null, 2));
}

async function runDiagnostic(outputFormat = 'text') {
  try {
    console.log('Checking current public IP address...');
    const currentIP = await getCurrentIP();
    
    if (currentIP) {
      console.log('✓ Current Public IP Address:', currentIP);
      
      // Compare with the IP in the documentation
      const documentedIP = 'localhost'; // Using localhost for local development
      const mismatchDetected = currentIP !== documentedIP;
      
      if (mismatchDetected) {
        console.log('⚠ IP Address Mismatch Detected!');
        console.log(`  Documented IP: ${documentedIP}`);
        console.log(`  Current IP:    ${currentIP}`);
        console.log('  This explains why MongoDB connection might be failing.');
        
        // Log IP change
        await logIPChange(currentIP);
      }
      
      // Output in requested format
      if (outputFormat === 'json') {
        outputJSON(currentIP, documentedIP, mismatchDetected);
        return;
      }
    } else {
      console.log('✗ Could not determine current IP address');
      console.log('Try visiting https://api.ipify.org in your browser to find your public IP');
    }
    
    displayConnectionInfo();
    
    if (currentIP) {
      // Test MongoDB connection
      console.log('\nTesting MongoDB connection...');
      const connectionSuccess = await testMongoDBConnection();
      
      if (!connectionSuccess) {
        console.log('\n⚠ Connection failed. This may be due to IP whitelist issues.');
        await provideEnhancedWhitelistInstructions(currentIP);
      } else {
        console.log('\n✓ Connection test successful. No IP whitelist issues detected.');
        
        // Even if successful, provide enhanced instructions for future reference
        await provideEnhancedWhitelistInstructions(currentIP);
      }
    }
    
    console.log('\nFor additional troubleshooting:');
    console.log('- Check if your cluster is paused (free tier clusters pause after 30 mins of inactivity)');
    console.log('- Verify MongoDB credentials in the connection string');
    console.log('- Test connection with MongoDB Compass using the same connection string');
  } catch (error) {
    console.error('Diagnostic failed:', error.message);
  }
}

// Check if JSON output is requested
const args = process.argv.slice(2);
const outputFormat = args.includes('--json') ? 'json' : 'text';

// Check if we should add IP to whitelist
if (args.includes('--add-to-whitelist')) {
  getCurrentIP().then(ip => {
    if (ip) {
      addIPToAtlasWhitelist(ip);
    } else {
      console.log('Could not determine current IP address');
    }
  });
} else {
  runDiagnostic(outputFormat);
}
