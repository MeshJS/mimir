# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci --omit=optional && \
    npm run build && \
    npm prune --omit=dev --omit=optional && \
    # Remove unnecessary files from node_modules
    find node_modules -type f \( -name "*.md" -o -name "*.ts" -o -name "*.map" \) -delete && \
    find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "docs" \) -exec rm -rf {} + 2>/dev/null || true

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
COPY --from=builder /app/src/supabase/setup.sql ./src/supabase/setup.sql
COPY .env.example ./
COPY scripts ./scripts

# Create non-root user and switch to it
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3001
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node", "dist/server/start.js"]

