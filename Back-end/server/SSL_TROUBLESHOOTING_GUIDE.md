# MongoDB SSL Connection Troubleshooting Guide

## Overview

This guide provides detailed instructions for diagnosing and resolving SSL/TLS connection issues with MongoDB, particularly addressing the error:
```
736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:..\..\third_party\boringssl\src\ssl\tls_record.cc:486:SSL alert number 80
```

## Common SSL Error Types

### 1. TLSV1_ALERT_INTERNAL_ERROR (Alert Number 80)
- **Cause**: Server-side SSL configuration issues or internal errors during SSL handshake
- **Solutions**:
  - Check MongoDB server SSL certificate validity
  - Verify network connectivity during SSL handshake
  - Try disabling TLS temporarily for testing
  - Contact MongoDB Atlas support if using Atlas

### 2. Certificate Validation Errors
- **Symptoms**: CERTIFICATE_VERIFY_FAILED, self signed certificate, unable to get local issuer certificate
- **Solutions**:
  - Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true` for development
  - Install proper CA certificates on the client machine
  - Use custom CA file with `MONGO_TLS_CA_FILE` option

### 3. Hostname Mismatch Errors
- **Symptoms**: hostname/IP doesn't match certificate, IP address mismatch
- **Solutions**:
  - Set `MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true` for development
  - Ensure connection string uses correct hostname that matches certificate
  - Update DNS records to match certificate SAN entries

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_TLS` | `false` | Enable/disable TLS connections |
| `MONGO_TLS_ALLOW_INVALID_CERTIFICATES` | `true` | Allow self-signed or invalid certificates |
| `MONGO_TLS_ALLOW_INVALID_HOSTNAMES` | `false` | Skip hostname validation |
| `MONGO_TLS_CA_FILE` | unset | Path to custom CA certificate file |
| `MONGO_TLS_CERTIFICATE_KEY_FILE` | unset | Path to client certificate/key file |

## Troubleshooting Steps

### Step 1: Verify Basic Connectivity
```bash
# Test basic network connectivity
ping your-mongodb-host.com
telnet your-mongodb-host.com 27017
```

### Step 2: Check Current Configuration
```bash
# View current environment variables
echo $MONGO_TLS
echo $MONGO_TLS_ALLOW_INVALID_CERTIFICATES
```

### Step 3: Enable Detailed Logging
The enhanced connection module automatically logs detailed diagnostics for SSL errors. Check your application logs for entries like:
```
=== SSL Connection Diagnostics (Attempt 1) ===
Timestamp: 2025-12-19T10:30:45.123Z
Error Category: INTERNAL_SSL_ERROR
Error Message: 736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR...
TLS Enabled: true
Allow Invalid Certificates: false
Allow Invalid Hostnames: false
=====================================
```

### Step 4: Apply Fallback Configurations

#### For Development Environments:
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true
```

#### For Production Environments:
Ensure proper certificates are installed and validated:
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=false
MONGO_TLS_CA_FILE=/path/to/ca-certificate.pem
```

## Testing Different Scenarios

### Test 1: Disable TLS Completely
```env
MONGO_TLS=false
```
This bypasses SSL entirely and helps determine if the issue is SSL-specific.

### Test 2: Allow Invalid Certificates
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true
```
This allows self-signed or expired certificates for development.

### Test 3: Allow Invalid Hostnames
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true
```
This skips hostname validation but maintains certificate validation.

## MongoDB Atlas Specific Solutions

### Solution 1: Check IP Whitelist
Ensure your IP address is whitelisted in the Atlas console:
1. Go to Atlas Dashboard
2. Select your cluster
3. Go to Network Access
4. Add your current IP address

### Solution 2: Use Correct Connection String
Ensure you're using the correct connection string format from Atlas:
```
mongodb+srv://username:password@cluster0.xxx.mongodb.net/database
```

### Solution 3: Check Certificate Validity
Atlas certificates are regularly rotated. Ensure your system trusts the current certificates.

## Fallback Connection Strategies

The enhanced connection module implements intelligent fallback strategies:

1. **Attempt 1**: Standard SSL connection with full validation
2. **Attempt 2**: If certificate error, try with `tlsAllowInvalidCertificates=true`
3. **Attempt 3**: If hostname error, try with `tlsAllowInvalidHostnames=true`
4. **Attempt 4**: If still failing, log detailed diagnostics and fail gracefully

## Security Best Practices

### Development vs Production
- **Development**: It's acceptable to use `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
- **Production**: Always use valid certificates and disable insecure options

### Certificate Management
- Regularly update CA certificate bundles
- Monitor certificate expiration dates
- Use automated certificate renewal where possible

### Audit Logging
The system logs when insecure SSL options are used:
```
⚠ Warning: Insecure SSL options detected
- tlsAllowInvalidCertificates: true
- This should only be used in development environments
```

## Advanced Debugging

### Enable MongoDB Driver Debug Logging
Set environment variable:
```bash
export MONGODB_DRIVER_DEBUG=1
```

### Use OpenSSL to Test Connection
```bash
openssl s_client -connect your-mongodb-host.com:27017
```

### Check Certificate Chain
```bash
echo | openssl s_client -showcerts -connect your-mongodb-host.com:27017 2>/dev/null | openssl x509 -text
```

## Common Resolution Patterns

### Pattern 1: Corporate Firewall/Proxy
If behind a corporate firewall:
1. Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
2. Configure proxy settings if required
3. Work with IT to whitelist MongoDB endpoints

### Pattern 2: Self-Signed Certificates in Development
For local MongoDB instances with self-signed certificates:
1. Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
2. Ensure `MONGO_TLS=true` to maintain encryption

### Pattern 3: DNS/Mismatched Hostnames
When connecting via IP instead of hostname:
1. Set `MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true`
2. Or update connection string to use certificate-matching hostname

## Monitoring and Metrics

The system tracks these metrics automatically:
- SSL connection success rate
- Frequency of SSL error types
- Fallback mechanism usage
- Average connection time with SSL vs non-SSL

Alerts are triggered when:
- SSL failure rate > 5%
- New SSL error types are encountered
- Repeated failures for the same configuration occur

## When to Contact Support

Contact MongoDB support or your system administrator when:
1. All fallback strategies have been exhausted
2. The error persists in production with valid certificates
3. You suspect server-side configuration issues
4. You encounter new, undocumented SSL error patterns

Provide these details when seeking help:
- Full error message and stack trace
- Connection configuration (without credentials)
- Diagnostic logs from the enhanced connection module
- Network environment details# MongoDB SSL Connection Troubleshooting Guide

## Overview

This guide provides detailed instructions for diagnosing and resolving SSL/TLS connection issues with MongoDB, particularly addressing the error:
```
736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR:..\..\third_party\boringssl\src\ssl\tls_record.cc:486:SSL alert number 80
```

## Common SSL Error Types

### 1. TLSV1_ALERT_INTERNAL_ERROR (Alert Number 80)
- **Cause**: Server-side SSL configuration issues or internal errors during SSL handshake
- **Solutions**:
  - Check MongoDB server SSL certificate validity
  - Verify network connectivity during SSL handshake
  - Try disabling TLS temporarily for testing
  - Contact MongoDB Atlas support if using Atlas

### 2. Certificate Validation Errors
- **Symptoms**: CERTIFICATE_VERIFY_FAILED, self signed certificate, unable to get local issuer certificate
- **Solutions**:
  - Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true` for development
  - Install proper CA certificates on the client machine
  - Use custom CA file with `MONGO_TLS_CA_FILE` option

### 3. Hostname Mismatch Errors
- **Symptoms**: hostname/IP doesn't match certificate, IP address mismatch
- **Solutions**:
  - Set `MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true` for development
  - Ensure connection string uses correct hostname that matches certificate
  - Update DNS records to match certificate SAN entries

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_TLS` | `false` | Enable/disable TLS connections |
| `MONGO_TLS_ALLOW_INVALID_CERTIFICATES` | `true` | Allow self-signed or invalid certificates |
| `MONGO_TLS_ALLOW_INVALID_HOSTNAMES` | `false` | Skip hostname validation |
| `MONGO_TLS_CA_FILE` | unset | Path to custom CA certificate file |
| `MONGO_TLS_CERTIFICATE_KEY_FILE` | unset | Path to client certificate/key file |

## Troubleshooting Steps

### Step 1: Verify Basic Connectivity
```bash
# Test basic network connectivity
ping your-mongodb-host.com
telnet your-mongodb-host.com 27017
```

### Step 2: Check Current Configuration
```bash
# View current environment variables
echo $MONGO_TLS
echo $MONGO_TLS_ALLOW_INVALID_CERTIFICATES
```

### Step 3: Enable Detailed Logging
The enhanced connection module automatically logs detailed diagnostics for SSL errors. Check your application logs for entries like:
```
=== SSL Connection Diagnostics (Attempt 1) ===
Timestamp: 2025-12-19T10:30:45.123Z
Error Category: INTERNAL_SSL_ERROR
Error Message: 736128:error:10000438:SSL routines:OPENSSL_internal:TLSV1_ALERT_INTERNAL_ERROR...
TLS Enabled: true
Allow Invalid Certificates: false
Allow Invalid Hostnames: false
=====================================
```

### Step 4: Apply Fallback Configurations

#### For Development Environments:
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true
```

#### For Production Environments:
Ensure proper certificates are installed and validated:
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=false
MONGO_TLS_CA_FILE=/path/to/ca-certificate.pem
```

## Testing Different Scenarios

### Test 1: Disable TLS Completely
```env
MONGO_TLS=false
```
This bypasses SSL entirely and helps determine if the issue is SSL-specific.

### Test 2: Allow Invalid Certificates
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true
```
This allows self-signed or expired certificates for development.

### Test 3: Allow Invalid Hostnames
```env
MONGO_TLS=true
MONGO_TLS_ALLOW_INVALID_CERTIFICATES=false
MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true
```
This skips hostname validation but maintains certificate validation.

## MongoDB Atlas Specific Solutions

### Solution 1: Check IP Whitelist
Ensure your IP address is whitelisted in the Atlas console:
1. Go to Atlas Dashboard
2. Select your cluster
3. Go to Network Access
4. Add your current IP address

### Solution 2: Use Correct Connection String
Ensure you're using the correct connection string format from Atlas:
```
mongodb+srv://username:password@cluster0.xxx.mongodb.net/database
```

### Solution 3: Check Certificate Validity
Atlas certificates are regularly rotated. Ensure your system trusts the current certificates.

## Fallback Connection Strategies

The enhanced connection module implements intelligent fallback strategies:

1. **Attempt 1**: Standard SSL connection with full validation
2. **Attempt 2**: If certificate error, try with `tlsAllowInvalidCertificates=true`
3. **Attempt 3**: If hostname error, try with `tlsAllowInvalidHostnames=true`
4. **Attempt 4**: If still failing, log detailed diagnostics and fail gracefully

## Security Best Practices

### Development vs Production
- **Development**: It's acceptable to use `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
- **Production**: Always use valid certificates and disable insecure options

### Certificate Management
- Regularly update CA certificate bundles
- Monitor certificate expiration dates
- Use automated certificate renewal where possible

### Audit Logging
The system logs when insecure SSL options are used:
```
⚠ Warning: Insecure SSL options detected
- tlsAllowInvalidCertificates: true
- This should only be used in development environments
```

## Advanced Debugging

### Enable MongoDB Driver Debug Logging
Set environment variable:
```bash
export MONGODB_DRIVER_DEBUG=1
```

### Use OpenSSL to Test Connection
```bash
openssl s_client -connect your-mongodb-host.com:27017
```

### Check Certificate Chain
```bash
echo | openssl s_client -showcerts -connect your-mongodb-host.com:27017 2>/dev/null | openssl x509 -text
```

## Common Resolution Patterns

### Pattern 1: Corporate Firewall/Proxy
If behind a corporate firewall:
1. Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
2. Configure proxy settings if required
3. Work with IT to whitelist MongoDB endpoints

### Pattern 2: Self-Signed Certificates in Development
For local MongoDB instances with self-signed certificates:
1. Set `MONGO_TLS_ALLOW_INVALID_CERTIFICATES=true`
2. Ensure `MONGO_TLS=true` to maintain encryption

### Pattern 3: DNS/Mismatched Hostnames
When connecting via IP instead of hostname:
1. Set `MONGO_TLS_ALLOW_INVALID_HOSTNAMES=true`
2. Or update connection string to use certificate-matching hostname

## Monitoring and Metrics

The system tracks these metrics automatically:
- SSL connection success rate
- Frequency of SSL error types
- Fallback mechanism usage
- Average connection time with SSL vs non-SSL

Alerts are triggered when:
- SSL failure rate > 5%
- New SSL error types are encountered
- Repeated failures for the same configuration occur

## When to Contact Support

Contact MongoDB support or your system administrator when:
1. All fallback strategies have been exhausted
2. The error persists in production with valid certificates
3. You suspect server-side configuration issues
4. You encounter new, undocumented SSL error patterns

Provide these details when seeking help:
- Full error message and stack trace
- Connection configuration (without credentials)
- Diagnostic logs from the enhanced connection module
- Network environment details