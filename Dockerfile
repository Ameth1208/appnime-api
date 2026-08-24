# ── Stage 1: Dependencies ──────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++ && \
    npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ && \
    npm install -g pnpm@9
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ── Stage 3: Production ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat curl

WORKDIR /app

# Copy only what's needed for production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets ./assets

# Create storage directory for uploads
RUN mkdir -p /app/storage && chown -R node:node /app/storage

# Generate Prisma client for the production image
RUN npx prisma generate

EXPOSE 4000
ENV NODE_ENV=production

# Aplica schema changes antes de arrancar el server
CMD ["sh", "-c", "npx prisma db push --accept-data-loss --url=\"$DATABASE_URL\" && node dist/main.js"]



