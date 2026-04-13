#!/usr/bin/env node

/**
 * Load Test Report Tracker
 * 
 * Stores historical load test results for comparison
 * Tracks:
 * - RPS vs latency trends
 * - Error rate over time
 * - Breaking point evolution
 * - SLO compliance
 * 
 * Usage:
 *   node track-load-test.js --file report.json --tag "v1.2.0"
 *   node track-load-test.js --compare report1.json report2.json
 *   node track-load-test.js --history
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_DIR = path.join(__dirname, 'reports');
const HISTORY_FILE = path.join(REPORTS_DIR, 'history.json');

// ── CLI Arguments ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args[0]?.replace('--', '');
const reportFile = args.find(a => a.startsWith('--file='))?.split('=')[1];
const tag = args.find(a => a.startsWith('--tag='))?.split('=')[1] || 'untagged';

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Initialize reports directory
 */
function initReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    console.log(`[Tracker] Created reports directory: ${REPORTS_DIR}`);
  }
}

/**
 * Load history
 */
function loadHistory() {
  if (fs.existsSync(HISTORY_FILE)) {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  }
  return { runs: [] };
}

/**
 * Save history
 */
function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Extract metrics from Artillery report
 */
function extractMetrics(report) {
  const aggregated = report.aggregate;
  if (!aggregated) {
    throw new Error('Invalid report format');
  }

  return {
    timestamp: new Date().toISOString(),
    tag: tag,
    
    // Latency metrics
    p50: aggregated.rtd?.p50 || 0,
    p95: aggregated.rtd?.p95 || 0,
    p99: aggregated.rtd?.p99 || 0,
    min: aggregated.rtd?.min || 0,
    max: aggregated.rtd?.max || 0,
    
    // Request metrics
    totalRequests: aggregated.codes?.['200'] || 0,
    totalErrors: Object.entries(aggregated.codes || {})
      .filter(([code]) => code.startsWith('4') || code.startsWith('5'))
      .reduce((sum, [, count]) => sum + count, 0),
    
    // Throughput
    rps: aggregated.rps?.mean || 0,
    
    // Error rate
    errorRate: 0, // Calculated below
    
    // SLO compliance
    sloCompliance: {
      p95Under500ms: (aggregated.rtd?.p95 || 0) < 500,
      errorRateUnder1Percent: true, // Calculated below
      availability99_9: true // Calculated below
    }
  };
}

/**
 * Track new test run
 */
function trackRun(reportPath) {
  console.log(`[Tracker] Processing report: ${reportPath}`);
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const metrics = extractMetrics(report);
  
  // Calculate error rate
  const totalRequests = metrics.totalRequests + metrics.totalErrors;
  metrics.errorRate = totalRequests > 0 
    ? (metrics.totalErrors / totalRequests) * 100 
    : 0;
  
  // Update SLO compliance
  metrics.sloCompliance.errorRateUnder1Percent = metrics.errorRate < 1;
  metrics.sloCompliance.availability99_9 = metrics.errorRate < 0.1;
  
  // Save individual report
  const date = new Date().toISOString().split('T')[0];
  const runId = `${date}-${Date.now()}`;
  const reportCopyPath = path.join(REPORTS_DIR, `${runId}.json`);
  fs.writeFileSync(reportCopyPath, JSON.stringify(report, null, 2));
  
  // Update history
  const history = loadHistory();
  history.runs.push({
    id: runId,
    tag: metrics.tag,
    timestamp: metrics.timestamp,
    summary: {
      p50: metrics.p50,
      p95: metrics.p95,
      p99: metrics.p99,
      rps: metrics.rps,
      errorRate: metrics.errorRate,
      totalRequests,
      totalErrors: metrics.totalErrors
    },
    sloCompliance: metrics.sloCompliance,
    reportFile: `${runId}.json`
  });
  
  saveHistory(history);
  
  console.log('\n[Tracker] ✅ Test run tracked successfully!');
  console.log(`[Tracker] Run ID: ${runId}`);
  console.log(`[Tracker] Tag: ${metrics.tag}`);
  console.log('\n[Metrics Summary]');
  console.log(`  p50: ${metrics.p50}ms`);
  console.log(`  p95: ${metrics.p95}ms`);
  console.log(`  p99: ${metrics.p99}ms`);
  console.log(`  RPS: ${metrics.rps.toFixed(2)}`);
  console.log(`  Error Rate: ${metrics.errorRate.toFixed(2)}%`);
  console.log(`  Total Requests: ${totalRequests}`);
  console.log(`  Total Errors: ${metrics.totalErrors}`);
  
  console.log('\n[SLO Compliance]');
  console.log(`  p95 < 500ms: ${metrics.sloCompliance.p95Under500ms ? '✅' : '❌'}`);
  console.log(`  Error Rate < 1%: ${metrics.sloCompliance.errorRateUnder1Percent ? '✅' : '❌'}`);
  console.log(`  Availability 99.9%: ${metrics.sloCompliance.availability99_9 ? '✅' : '❌'}`);
  
  return runId;
}

/**
 * Compare two test runs
 */
function compareRuns(file1, file2) {
  console.log(`[Tracker] Comparing ${file1} vs ${file2}`);
  
  const report1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
  const report2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
  
  const metrics1 = extractMetrics(report1);
  const metrics2 = extractMetrics(report2);
  
  console.log('\n[Comparison]');
  console.log(`  p50: ${metrics1.p50}ms → ${metrics2.p50}ms (${((metrics2.p50 - metrics1.p50) / metrics1.p50 * 100).toFixed(1)}%)`);
  console.log(`  p95: ${metrics1.p95}ms → ${metrics2.p95}ms (${((metrics2.p95 - metrics1.p95) / metrics1.p95 * 100).toFixed(1)}%)`);
  console.log(`  p99: ${metrics1.p99}ms → ${metrics2.p99}ms (${((metrics2.p99 - metrics1.p99) / metrics1.p99 * 100).toFixed(1)}%)`);
  console.log(`  RPS: ${metrics1.rps.toFixed(2)} → ${metrics2.rps.toFixed(2)} (${((metrics2.rps - metrics1.rps) / metrics1.rps * 100).toFixed(1)}%)`);
  console.log(`  Error Rate: ${metrics1.errorRate.toFixed(2)}% → ${metrics2.errorRate.toFixed(2)}%`);
}

/**
 * Show history
 */
function showHistory() {
  const history = loadHistory();
  
  if (history.runs.length === 0) {
    console.log('[Tracker] No test runs found');
    return;
  }
  
  console.log(`\n[Load Test History] (${history.runs.length} runs)\n`);
  console.log('Date       | Tag        | p50   | p95   | p99   | RPS   | Err%  | SLO');
  console.log('-----------|------------|-------|-------|-------|-------|-------|-----');
  
  history.runs.forEach(run => {
    const date = run.timestamp.split('T')[0];
    const slo = run.sloCompliance.p95Under500ms && run.sloCompliance.errorRateUnder1Percent
      ? '✅'
      : '❌';
    
    console.log(
      `${date} | ${run.tag.padEnd(10)} | ${run.summary.p50.toString().padEnd(5)} | ${run.summary.p95.toString().padEnd(5)} | ${run.summary.p99.toString().padEnd(5)} | ${run.summary.rps.toFixed(2).padEnd(5)} | ${run.summary.errorRate.toFixed(2).padEnd(5)} | ${slo}`
    );
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

initReportsDir();

switch (mode) {
  case 'file':
    if (!reportFile) {
      console.error('Error: --file=<path> required');
      process.exit(1);
    }
    trackRun(reportFile);
    break;
  
  case 'compare':
    const files = args.filter(a => !a.startsWith('--'));
    if (files.length !== 2) {
      console.error('Error: Provide exactly 2 report files to compare');
      process.exit(1);
    }
    compareRuns(files[0], files[1]);
    break;
  
  case 'history':
    showHistory();
    break;
  
  default:
    console.log('Usage:');
    console.log('  node track-load-test.js --file=<report.json> --tag=<version>');
    console.log('  node track-load-test.js --compare <report1.json> <report2.json>');
    console.log('  node track-load-test.js --history');
    break;
}
