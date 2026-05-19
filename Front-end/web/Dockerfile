# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Declare build args BEFORE COPY so a changed arg value busts the Docker layer
# cache and forces a fresh build — avoids stale env vars in cached layers.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NODE_ENV=production

# Fail the build immediately if the required arg is missing rather than
# building successfully and silently routing all API calls to nowhere.
RUN test -n "$NEXT_PUBLIC_API_URL" || \
    (echo "ERROR: NEXT_PUBLIC_API_URL build arg is required. Set it in Railway Dashboard → Service → Settings → Build → Build Arguments." && exit 1)

# Expose args as env vars for next build
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NODE_ENV=${NODE_ENV}
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies (cached layer — only busted when package files change)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

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
