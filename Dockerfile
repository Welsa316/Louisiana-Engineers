# Build the web app and the server bundle, then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY server/migrations ./server/migrations
EXPOSE 8787
USER node
CMD ["node", "server/dist/index.js"]
