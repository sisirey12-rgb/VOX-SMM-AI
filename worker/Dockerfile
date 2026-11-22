FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY worker/package*.json ./worker/
RUN npm ci --prefix worker --omit=dev
COPY server/ ./server/
COPY worker/index.ts ./worker/
USER node
CMD ["node","worker/index.ts"]
