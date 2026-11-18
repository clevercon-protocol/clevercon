# One image for all three backend services (api, workers, indexer). Each Railway
# service builds from this Dockerfile and overrides the start command (see
# deploy/DEPLOY.md). Debian (not Alpine) so Prisma's engine + openssl work.
# Pulled from the AWS ECR public mirror of the Docker Official Images (identical
# to docker.io/library/node) to dodge Docker Hub's anonymous pull rate limit,
# which 429s shared CI builders like Railway's.
FROM public.ecr.aws/docker/library/node:20-bookworm-slim

WORKDIR /app

# Prisma needs openssl at build + runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install workspace deps. The repo-root postinstall runs `prisma generate` +
# builds @clevercon/db, so the Prisma client is ready after this step.
COPY . .
RUN npm ci

# Compile the NestJS API to dist (api runs compiled; workers + indexer run via tsx).
RUN npm run build -w @clevercon/api

# Build the agent SDK to dist so the reference provider (which imports
# @clevercon/agent-sdk/provider) resolves it at runtime; the SDK's package
# exports point at dist for npm consumers.
RUN npm run build -w @clevercon/agent-sdk

ENV NODE_ENV=production

# Default command = API. Railway's workers/indexer services override this with:
#   workers:  node --import tsx services/workers/src/index.ts
#   indexer:  node --import tsx services/indexer/src/index.ts
CMD ["node", "services/api/dist/src/main.js"]
