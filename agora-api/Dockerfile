FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src

RUN chown -R node:node /app
USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
