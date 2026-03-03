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

# Stage 2: Run
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
ENV PORT 3000
# Ensure hostname is set for Railway
ENV HOSTNAME "0.0.0.0"

# Copy standalone output from builder
# Next.js 13+ standalone build creates server.js at .next/standalone/server.js
# But when copying, we need to preserve the structure or adjust the CMD
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Expose port
EXPOSE 3000

# Start command
# Standalone build might put server.js in a subdirectory if not configured otherwise
# Let's try finding where server.js is or use the standard path
CMD ["node", "server.js"]
