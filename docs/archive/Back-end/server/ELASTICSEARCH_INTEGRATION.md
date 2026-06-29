# Elasticsearch Integration Guide

## Overview
This document explains how to set up and use Elasticsearch integration for enhanced search capabilities in the Autobacs India e-commerce platform.

## Prerequisites
1. Elasticsearch 8.x installed and running
2. Node.js environment set up
3. MongoDB database with product data

## Installation
Elasticsearch support is already included in the project dependencies. If you need to reinstall:

```bash
npm install @elastic/elasticsearch
```

## Configuration
Set the following environment variables in your `.env` file:

```env
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme
```

Adjust these values according to your Elasticsearch setup.

## Setup Process
1. Make sure Elasticsearch is running
2. Run the reindex script to create the index and index all products:

```bash
npm run reindex-products
```

This will:
- Create the products index with proper mapping
- Index all active products from MongoDB
- Set up the search analytics index

## Features

### Enhanced Search
The search endpoint (`/products`) now supports:
- Full-text search with relevance scoring
- Faceted filtering by category, brand, price range, rating, and availability
- Aggregation results for building filter UI components

### Search Suggestions
The suggestions endpoint (`/products/suggestions`) provides:
- Autocomplete functionality for search queries
- Suggestions based on product names and brands
- Fuzzy matching for typo tolerance

### Search Analytics
The analytics endpoint (`/products/analytics`) provides:
- Popular search terms
- Search volume over time
- Insights for improving search experience

## How It Works
1. The system first tries to connect to Elasticsearch
2. If Elasticsearch is available, it uses Elasticsearch for search operations
3. If Elasticsearch is not available, it falls back to MongoDB queries
4. Product changes are automatically synced to Elasticsearch when available

## Testing
To test the Elasticsearch integration:

```bash
npm run test-elasticsearch
```

This will verify:
- Connection to Elasticsearch
- Index creation
- Search functionality
- Suggestions
- Analytics logging and retrieval

## Maintenance
- Regularly reindex products if you notice search inconsistencies
- Monitor Elasticsearch logs for errors
- Adjust the mapping as needed when adding new product attributes

## Troubleshooting
If you encounter issues:
1. Verify Elasticsearch is running and accessible
2. Check the connection settings in your `.env` file
3. Ensure the Elasticsearch user has the necessary permissions
4. Check the application logs for error messages

### Common Issues and Solutions

#### Connection Refused Error
**Symptom:** `ConnectionError: connect ECONNREFUSED`

**Causes:**
- Elasticsearch is not running
- Elasticsearch is running on a different port
- Firewall is blocking the connection

**Solutions:**
1. Check if Elasticsearch is running:
   ```bash
   curl http://localhost:9200
   ```
2. Verify the port in your `.env` file matches Elasticsearch configuration
3. Check firewall settings and allow connections to port 9200

#### Authentication Failed
**Symptom:** `401 Unauthorized` or authentication errors

**Causes:**
- Incorrect username or password
- Elasticsearch security is configured differently

**Solutions:**
1. Verify credentials in `.env` file:
   ```env
   ELASTICSEARCH_USERNAME=elastic
   ELASTICSEARCH_PASSWORD=your_actual_password
   ```
2. Reset Elasticsearch password if needed
3. Check Elasticsearch security configuration

#### Timeout Errors
**Symptom:** Connection timeout or request timeout

**Causes:**
- Network latency
- Elasticsearch is overloaded
- Timeout setting too low

**Solutions:**
1. Increase timeout in `.env`:
   ```env
   ELASTICSEARCH_RETRY_TIMEOUT=10000
   ```
2. Check Elasticsearch cluster health
3. Optimize Elasticsearch configuration

#### Application Works Without Elasticsearch
**Symptom:** No error but search features are limited

**Status:** This is expected behavior!

**Explanation:**
The application uses MongoDB as a fallback when Elasticsearch is unavailable. This ensures continuous operation but with reduced search capabilities.

**To Enable Elasticsearch:**
1. Set `ELASTICSEARCH_ENABLED=true` in `.env`
2. Ensure Elasticsearch is running
3. Run the diagnostic tool: `npm run test-elasticsearch-connection`
4. Restart the application

### Diagnostic Tool

Use the built-in diagnostic tool to troubleshoot connection issues:

```bash
npm run test-elasticsearch-connection
```

This tool will:
- Check if Elasticsearch is enabled
- Verify configuration settings
- Test the connection
- Display cluster information
- Check index status
- Provide specific troubleshooting advice

### Disabling Elasticsearch

If you want to disable Elasticsearch and use only MongoDB:

1. Update `.env` file:
   ```env
   ELASTICSEARCH_ENABLED=false
   ```
2. Restart the application

The application will operate normally using MongoDB for all search operations.

### Feature Comparison

| Feature | MongoDB Only | With Elasticsearch |
|---------|-------------|-------------------|
| Basic search | ✓ | ✓ |
| Text matching | Limited | Advanced |
| Fuzzy search | ✗ | ✓ |
| Search suggestions | Basic | Advanced |
| Faceted filtering | ✗ | ✓ |
| Search analytics | ✗ | ✓ |
| Spelling corrections | ✗ | ✓ |
| Relevance ranking | Basic | Advanced |
| Performance | Good | Excellent |

### Configuration Reference

#### Environment Variables

```env
# Enable or disable Elasticsearch
ELASTICSEARCH_ENABLED=false

# Elasticsearch server URL
ELASTICSEARCH_NODE=http://localhost:9200

# Authentication credentials
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=changeme

# Connection timeout in milliseconds
ELASTICSEARCH_RETRY_TIMEOUT=5000

# Logging level (error, warn, info, debug)
ELASTICSEARCH_LOG_LEVEL=warn
```

#### For Production

```env
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_NODE=https://your-elasticsearch-cluster.com:9200
ELASTICSEARCH_USERNAME=api_user
ELASTICSEARCH_PASSWORD=strong_secure_password
ELASTICSEARCH_RETRY_TIMEOUT=10000
```

### Getting Help

If you continue to experience issues:

1. Run the diagnostic tool and save the output
2. Check the application logs at startup
3. Review Elasticsearch logs
4. Consult the Elasticsearch documentation
5. Consider disabling Elasticsearch temporarily if blocking development