FROM node:22-alpine AS builder
WORKDIR /app

# Install turbo at the range the repo declares: `turbo prune`'s output
# layout is tied to the turbo major, so an unpinned global install could
# drift from the local one.
COPY package.json ./
RUN npm install -g "turbo@$(node -p "require('./package.json').devDependencies.turbo")"

# Prune the workspace to only include the nova package and its dependencies
COPY . .
RUN turbo prune --scope=nova --docker

# Installer stage
FROM node:22-alpine AS installer
WORKDIR /app

# Install dependencies
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm ci

# Build the project (production mode so bundles ship optimized dependency code)
ENV NODE_ENV=production
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN npx turbo run build --filter=nova...

# Runner stage
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=installer /app .

EXPOSE 8000

# A deployed server runs in production mode: an outgoing wire message the
# Avro schema cannot carry is dropped with a warning (and the same policy
# is announced to the bundle it serves) instead of thrown as in
# development. The installer stage's ENV does not reach this stage.
ENV NODE_ENV=production

WORKDIR /app/packages/nova
CMD ["npm", "run", "start"]
