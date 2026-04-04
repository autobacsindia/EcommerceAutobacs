# Dockerfile for Autobacs Backend (Express.js)
# Multi-stage build for optimal production deployment
# BUILD v2.1 - Fixed Redis command timeout (50ms → 2000ms)

# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies including dev dependencies for build
RUN npm ci

# Copy application source
COPY . .

# Create production build (if needed for any build steps)
# RUN npm run build

# Production stage
FROM node:20-alpine AS runner

# Create app directory
WORKDIR /app

# Install curl for health check
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app ./

# Create logs directory and set proper permissions BEFORE changing ownership
RUN mkdir -p /app/logs && chown -R nextjs:nodejs /app

USER nextjs

# Run on dynamic port specified by Railway (process.env.PORT)
ENV NODE_ENV=production
ENV PORT=8080

# Start application
CMD ["node", "server.js"]
