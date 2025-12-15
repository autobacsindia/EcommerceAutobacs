import cron from 'node-cron';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

// Import configuration
import { IMPORT_CONFIG } from './import-config.js';

// Schedule file path
const SCHEDULE_FILE = path.join(process.cwd(), 'scheduled-imports.json');

/**
 * Load scheduled imports from file
 */
function loadScheduledImports() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = fs.readFileSync(SCHEDULE_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.warn('⚠️  Could not load scheduled imports:', error.message);
    return [];
  }
}

/**
 * Save scheduled imports to file
 */
function saveScheduledImports(schedules) {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedules, null, 2));
    console.log('💾 Scheduled imports saved');
  } catch (error) {
    console.error('❌ Failed to save scheduled imports:', error.message);
  }
}

/**
 * Create a new scheduled import
 */
function createScheduledImport(schedule, name = 'Daily Import') {
  const schedules = loadScheduledImports();
  
  // Check if schedule already exists
  const existing = schedules.find(s => s.schedule === schedule);
  if (existing) {
    console.log(`⚠️  Schedule already exists: ${schedule}`);
    return existing;
  }
  
  // Create new schedule
  const newSchedule = {
    id: Date.now().toString(),
    name: name,
    schedule: schedule,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastRun: null,
    nextRun: null
  };
  
  schedules.push(newSchedule);
  saveScheduledImports(schedules);
  
  console.log(`✅ Created scheduled import: ${name} (${schedule})`);
  return newSchedule;
}

/**
 * Remove a scheduled import
 */
function removeScheduledImport(scheduleId) {
  const schedules = loadScheduledImports();
  const filtered = schedules.filter(s => s.id !== scheduleId);
  
  if (filtered.length === schedules.length) {
    console.log(`⚠️  Schedule not found: ${scheduleId}`);
    return false;
  }
  
  saveScheduledImports(filtered);
  console.log(`🗑️  Removed scheduled import: ${scheduleId}`);
  return true;
}

/**
 * List all scheduled imports
 */
function listScheduledImports() {
  const schedules = loadScheduledImports();
  
  if (schedules.length === 0) {
    console.log('📭 No scheduled imports found');
    return;
  }
  
  console.log('📅 Scheduled Imports:');
  schedules.forEach((schedule, index) => {
    console.log(`${index + 1}. ${schedule.name}`);
    console.log(`   ID: ${schedule.id}`);
    console.log(`   Schedule: ${schedule.schedule}`);
    console.log(`   Enabled: ${schedule.enabled ? '✅' : '❌'}`);
    console.log(`   Created: ${schedule.createdAt}`);
    console.log(`   Last Run: ${schedule.lastRun || 'Never'}`);
    console.log(`   Next Run: ${schedule.nextRun || 'Pending'}`);
    console.log('');
  });
}

/**
 * Run the import process
 */
function runImport() {
  console.log('🚀 Running scheduled import...');
  
  // Execute the incremental import script
  const importProcess = exec('node incremental-product-import.js', (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Import failed:', error.message);
      return;
    }
    
    if (stderr) {
      console.error('⚠️  Import warnings:', stderr);
    }
    
    console.log('✅ Import completed successfully');
    console.log(stdout);
  });
  
  // Log output in real-time
  importProcess.stdout.on('data', (data) => {
    process.stdout.write(data);
  });
  
  importProcess.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
}

/**
 * Start the scheduler
 */
function startScheduler() {
  console.log('⏰ Starting import scheduler...');
  
  const schedules = loadScheduledImports();
  const activeSchedules = schedules.filter(s => s.enabled);
  
  if (activeSchedules.length === 0) {
    console.log('📭 No active scheduled imports found');
    return;
  }
  
  activeSchedules.forEach(schedule => {
    try {
      // Validate cron expression
      if (!cron.validate(schedule.schedule)) {
        console.error(`❌ Invalid cron schedule: ${schedule.schedule}`);
        return;
      }
      
      // Schedule the import
      cron.schedule(schedule.schedule, () => {
        console.log(`⏰ Triggering scheduled import: ${schedule.name}`);
        schedule.lastRun = new Date().toISOString();
        saveScheduledImports(schedules);
        runImport();
      });
      
      console.log(`✅ Scheduled import active: ${schedule.name} (${schedule.schedule})`);
    } catch (error) {
      console.error(`❌ Failed to schedule import ${schedule.name}:`, error.message);
    }
  });
}

/**
 * Setup default schedule
 */
function setupDefaultSchedule() {
  const defaultSchedule = IMPORT_CONFIG.DEFAULT_SCHEDULE || '0 2 * * *'; // Daily at 2:00 AM
  createScheduledImport(defaultSchedule, 'Default Daily Import');
  console.log(`🔧 Default schedule created: ${defaultSchedule}`);
}

// Command line interface
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('🔧 Usage:');
  console.log('   node setup-scheduled-import.js list          - List all scheduled imports');
  console.log('   node setup-scheduled-import.js create       - Create default scheduled import');
  console.log('   node setup-scheduled-import.js start        - Start the scheduler');
  console.log('   node setup-scheduled-import.js run          - Run import immediately');
  console.log('   node setup-scheduled-import.js help         - Show this help');
  process.exit(0);
}

switch (args[0]) {
  case 'list':
    listScheduledImports();
    break;
    
  case 'create':
    setupDefaultSchedule();
    break;
    
  case 'start':
    startScheduler();
    // Keep the process running
    setInterval(() => {
      // Keep alive
    }, 60000);
    break;
    
  case 'run':
    runImport();
    break;
    
  case 'help':
  default:
    console.log('🔧 Usage:');
    console.log('   node setup-scheduled-import.js list          - List all scheduled imports');
    console.log('   node setup-scheduled-import.js create       - Create default scheduled import');
    console.log('   node setup-scheduled-import.js start        - Start the scheduler');
    console.log('   node setup-scheduled-import.js run          - Run import immediately');
    console.log('   node setup-scheduled-import.js help         - Show this help');
    break;
}

export {
  createScheduledImport,
  removeScheduledImport,
  listScheduledImports,
  runImport,
  startScheduler,
  setupDefaultSchedule
};

export default {
  createScheduledImport,
  removeScheduledImport,
  listScheduledImports,
  runImport,
  startScheduler,
  setupDefaultSchedule
};