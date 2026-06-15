# Dockerfile for Autobacs Backend (Express.js)
# Stage 1: Install prod-only dependencies
FROM node:20-alpine AS deps

ARG BUILD_ID=dev
WORKDIR /app

COPY package*.json ./
RUN echo "BUILD_ID=${BUILD_ID}" && npm ci --omit=dev && npm cache clean --force

# Stage 2: Production image
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache curl

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy prod-only node_modules from deps stage (no dev bloat)
COPY --from=deps /app/node_modules ./node_modules

# Copy app source (node_modules excluded via .dockerignore)
COPY . .

# Create logs directory and set ownership in one layer
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

USER nodejs

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8080}/health || exit 1

CMD ["node", "server.js"]
