# Scheduled Imports Documentation

## Overview
This document explains the scheduled import functionality implemented for the Autobacs e-commerce platform, specifically focusing on the automated re-import of failed products.

## Scheduled Tasks

### Failed Product Import
- **Schedule**: Daily at 11:10 AM
- **Purpose**: Automatically re-attempt import of products that failed in previous import jobs
- **Implementation**: Uses `node-cron` to schedule the job
- **Timezone**: Asia/Kolkata (IST)

## How It Works

### Automatic Scheduling
When the server starts, it automatically initializes all scheduled tasks:
1. Connects to the database
2. Sets up cron jobs using `node-cron`
3. Schedules the failed product import job for daily execution at 11:10 AM

### Failed Product Identification
The system identifies failed products by:
1. Querying the `ImportJob` collection for recent jobs (last 7 days) with failed products
2. Filtering for jobs with status 'completed' and failedProducts > 0
3. Processing each job to attempt re-import of failed products

### Re-import Process
When the scheduled job runs:
1. Creates a new import job record with source 'scheduled-failed'
2. Identifies recent import jobs with failed products
3. Attempts to re-import those failed products
4. Updates the job record with results
5. Logs the outcome

## API Endpoints

### Get Scheduled Tasks
```
GET /scheduled-tasks
```
Returns a list of all scheduled tasks.

### Cancel Scheduled Task
```
POST /scheduled-tasks/cancel/:taskName
```
Cancels a scheduled task by name.

### Manually Run Scheduled Task
```
POST /scheduled-tasks/run/:taskName
```
Manually executes a scheduled task by name.

## Implementation Details

### Cron Expression
The cron expression `10 11 * * *` means:
- Minute: 10
- Hour: 11 (11 AM)
- Day of month: * (every day)
- Month: * (every month)
- Day of week: * (every day of week)

### Database Enhancements
The `ImportJob` model was enhanced with:
- `isReimport` field to identify re-import jobs
- `originalJobId` field to reference original jobs
- Added 'scheduled-failed' to the source enum
- Made `initiatedBy` optional to support system-initiated jobs

## Testing

### Test Scripts
Two test scripts are available:
1. `test-cron-setup.js` - Verifies cron job scheduling
2. `test-failed-import.js` - Tests the failed product import functionality

## Monitoring

### Logging
The system logs:
- Initialization of cron jobs
- Execution of scheduled tasks
- Results of failed product imports
- Any errors encountered

## Maintenance

### Adding New Scheduled Tasks
To add new scheduled tasks:
1. Add a new method in `CronService`
2. Call it in `initializeCronJobs()`
3. Add appropriate routes in `scheduledTasks.js`
4. Update documentation

### Modifying Schedule Times
To change the schedule time:
1. Modify the cron expression in `CronService.scheduleFailedProductImport()`
2. Update documentation