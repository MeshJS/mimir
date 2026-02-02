# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

# Install Python and build tools needed for tree-sitter native modules
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN npm ci --omit=optional
RUN PRISMA_SKIP_DATABASE_URL_CHECK=true npx prisma generate
RUN npm run build || (echo "Build failed!" && exit 1)
RUN ls -la dist/ || (echo "dist directory not found after build" && exit 1)
RUN npm prune --omit=dev --omit=optional

# Clean up build tools to reduce image size (they're no longer needed after npm install)
RUN apk del python3 make g++

RUN find node_modules -type f \( -name "*.md" -o -name "*.ts" -o -name "*.map" \) -delete 2>/dev/null || true
RUN find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "docs" \) -exec rm -rf {} + 2>/dev/null || true

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install only postgresql-client and clean up in same layer
RUN apk add --no-cache postgresql-client && \
    rm -rf /var/cache/apk/* /tmp/*

# Copy only production dependencies and built code
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY .env.example ./
COPY scripts ./scripts

# Make entrypoint script executable
RUN chmod +x ./scripts/docker-entrypoint.sh

# Create non-root user and switch to it
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "dist/server/start.js"]
