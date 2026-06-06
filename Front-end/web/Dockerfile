# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Declare build args BEFORE COPY so a changed arg value busts the Docker layer
# cache and forces a fresh build — avoids stale env vars in cached layers.
ARG NEXT_PUBLIC_API_URL=https://ecommerceautobacs-production-8ff6.up.railway.app
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NODE_ENV=production

# Expose args as env vars for next build
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NODE_ENV=${NODE_ENV}
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies (cached layer — only busted when package files change)
# NODE_ENV overridden to development so devDependencies (e.g. @next/bundle-analyzer)
# are installed — they're needed at build time but won't be in the final runner image.
COPY package.json package-lock.json ./
RUN NODE_ENV=development npm ci --legacy-peer-deps

# Copy source (cache busted by arg changes above, or when source files change)
COPY . .

# Build Next.js app
RUN npm run build

# Stage 2: Run
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="::"
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

CMD ["node", "server.js"]
