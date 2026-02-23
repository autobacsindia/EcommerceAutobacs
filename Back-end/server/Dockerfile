# Dockerfile for Autobacs Backend (Express.js)
# Multi-stage build for optimal production deployment

# Build stage
FROM node:18-alpine AS builder

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
FROM node:18-alpine AS runner

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app ./

# Change ownership to non-root user
RUN chown -R nextjs:nodejs /app
USER nextjs

# Create logs directory
RUN mkdir -p /app/logs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Environment variables (set during deployment)
ENV NODE_ENV=production
ENV PORT=5000

# Start application
CMD ["node", "server.js"]