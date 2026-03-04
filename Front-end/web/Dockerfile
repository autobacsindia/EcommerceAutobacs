# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
# Install all dependencies (including devDependencies) for the build step
RUN npm ci

# Copy source
COPY . .

# Build Next.js app
# The build script uses tailwindcss, postcss, autoprefixer which are now in dependencies
RUN npm run build
# Debug: List standalone directory structure to verify paths
RUN ls -la /app/.next/standalone

# Stage 2: Run
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
# Remove PORT env var to allow Railway to set it dynamically
# ENV PORT 3000
# Ensure hostname is set for Railway
ENV HOSTNAME "0.0.0.0"

# Copy standalone output from builder
COPY --from=builder /app/.next/standalone/server.js ./server.js
COPY --from=builder /app/.next/standalone/package.json ./package.json
COPY --from=builder /app/.next/standalone/.next ./.next
COPY --from=builder /app/.next/standalone/node_modules ./node_modules
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Expose port
EXPOSE 3000

# Start command
# We use node directly to avoid npm start which might look for different paths
CMD ["node", "server.js"]
