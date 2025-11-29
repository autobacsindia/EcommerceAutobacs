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
2. Run the setup script to create the index and index all products:

```bash
npm run setup-elasticsearch
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