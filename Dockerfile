ARG BUILD_HASH=unknown

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
ARG BUILD_HASH=unknown
WORKDIR /app
ENV NODE_ENV=production
ENV TLS=false
ENV BUILD_HASH=$BUILD_HASH
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/ws ./src/ws
COPY package.json package-lock.json tsconfig.server.json ./
RUN npm ci --omit=dev --ignore-scripts && npm install tsx
EXPOSE 5173
CMD ["npx", "tsx", "server/index.ts"]
