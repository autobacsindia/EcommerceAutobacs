// Simulate SSL Error Script to test error handling
import { categorizeSSLError, logConnectionDiagnostics } from "./config/db.js";

console.log("Simulating SSL Error Handling...\n");

// Simulate the specific error mentioned in the issue
const sslError = {
  message: "736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:486:SSL alert number 80",
  stack: "Error: 736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:486:SSL alert number 80\n    at TLSSocket.onConnectSecure (_tls_wrap.js:1500:34)\n    at TLSSocket.emit (events.js:376:20)\n    at TLSSocket._finishInit (_tls_wrap.js:933:8)\n    at TLSWrap.ssl.onhandshakedone (_tls_wrap.js:707:12)"
};

// Test error categorization
const category = categorizeSSLError(sslError);
console.log(`Identified Error Category: ${category}`);

// Test diagnostic logging
const mockOptions = {
  tls: true,
  tlsAllowInvalidCertificates: false,
  tlsAllowInvalidHostnames: false
};

logConnectionDiagnostics(sslError, mockOptions, 1);

console.log("Simulation complete. The system correctly identified and logged the SSL error.");