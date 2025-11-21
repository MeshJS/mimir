# syntax=docker/dockerfile:1.7

FROM node:20-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=optional

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig.json ./
COPY mimir.config.example.json ./mimir.config.example.json
COPY src ./src
COPY scripts ./scripts

RUN chown -R node:node /app
USER node

EXPOSE 3000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "server"]
