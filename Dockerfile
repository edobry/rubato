FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV TLS=false
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/ws ./src/ws
COPY package.json package-lock.json tsconfig.server.json ./
RUN npm ci --omit=dev && npm install tsx
EXPOSE 5173
CMD ["npx", "tsx", "server/index.ts"]
