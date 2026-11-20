# ---- deps + build (also used by the one-off "seed" service) ----
FROM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4100
ENTRYPOINT ["/sbin/tini", "--"]
# Each container serves REST + WebSockets. Run several; Redis keeps them in sync.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
