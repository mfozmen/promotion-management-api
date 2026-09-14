# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the only lifecycle script here is husky's `prepare`, which has no
# .git to install into and fails the build.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# The migrator reads the SQL at run time, so the image carries the files themselves, not
# only the code that applies them. Same path as on the host: the entrypoint resolves the
# folder relative to /app.
COPY src/shared/db/migrations ./src/shared/db/migrations
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3100
CMD ["node", "dist/server.js"]
