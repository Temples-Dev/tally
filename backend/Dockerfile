# Build stage — shared workspace context from repo root.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile
COPY backend ./backend
RUN pnpm --filter @tally/backend build && CI=true pnpm install --prod --frozen-lockfile

# Production stage — non-root, API command by default; worker overrides CMD.
FROM node:22-alpine AS production
RUN corepack enable && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/backend ./backend
WORKDIR /app/backend
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
