# Music bot for Render: Node + yt-dlp + ffmpeg
FROM node:20-bookworm-slim

# Install ffmpeg and yt-dlp via apt only (no pip - Debian 12 blocks system pip)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    yt-dlp \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY bot.js ./

# Render sets PORT; bot listens on 0.0.0.0:PORT
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "bot.js"]
