# Music bot for Render: Node + yt-dlp + ffmpeg
FROM node:20-bookworm-slim

# Install ffmpeg and yt-dlp (needed for YouTube/Instagram/TikTok downloads)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && pip3 install --no-cache-dir yt-dlp \
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
