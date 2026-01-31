# Deploy Music Bot to Render

This guide walks you through deploying the Telegram music bot to [Render](https://render.com) as a **Web Service**. The bot already listens on `PORT` and exposes a `/health` endpoint, so it works with Render out of the box.

---

## Render form – correct values

Use these when creating the Web Service (repo **husanboy259/songs**):

| Field | Value |
|-------|--------|
| **Name** | `songs` (or e.g. `music-bot`) |
| **Language / Runtime** | **Docker** (not Node – Node has no yt-dlp/ffmpeg, bot will crash) |
| **Branch** | `main` |
| **Region** | Oregon (US West) or your choice |
| **Root Directory** | Leave **empty** (bot is at repo root) |
| **Build Command** | Leave empty for Docker (Render uses Dockerfile) |
| **Start Command** | Leave empty for Docker (Dockerfile has `CMD`) |
| **Instance Type** | Free (or paid if you prefer) |

**Environment variables (required):**

| Key | Value |
|-----|--------|
| **BOT_TOKEN** | Your Telegram bot token from @BotFather |
| **ADMIN_ID** | Your Telegram user ID (optional; from @userinfobot) |

Then click **Deploy web service**.

---

## What you need

- A [Render](https://render.com) account (free tier is fine)
- Your repo on GitHub (e.g. `husanboy259/songs`)
- **BOT_TOKEN** (or **TELEGRAM_BOT_TOKEN**) from [@BotFather](https://t.me/BotFather)
- **ADMIN_ID** (optional) – your Telegram user ID for admin commands

---

## Option A: Deploy with Docker (recommended – downloads work)

Docker installs **yt-dlp** and **ffmpeg** so YouTube, Instagram, and TikTok downloads work.

### 1. Create a Web Service on Render

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in.
2. Click **New +** → **Web Service**.
3. Connect your GitHub account if needed, then select the repo (e.g. **husanboy259/songs**).
4. Configure:
   - **Name:** `music-bot` (or any name).
   - **Region:** Choose one close to you.
   - **Branch:** `main`.
   - **Root Directory:** Leave empty if the bot code is at the repo root. If the bot is in a subfolder (e.g. `rvbot`), set **Root Directory** to `rvbot`.
   - **Runtime:** **Docker**.
   - **Instance Type:** Free (or paid if you prefer).

### 2. Environment variables

In the same screen, open **Environment** and add:

| Key | Value | Required |
|-----|--------|----------|
| **BOT_TOKEN** | Your Telegram bot token from @BotFather | Yes |
| **ADMIN_ID** | Your Telegram user ID (e.g. from @userinfobot) | Optional |

You can use **TELEGRAM_BOT_TOKEN** instead of **BOT_TOKEN** if you prefer; the bot supports both.

### 3. Deploy

Click **Create Web Service**. Render will:

1. Clone your repo.
2. Build the Docker image (installs Node, ffmpeg, yt-dlp).
3. Start the container with `node bot.js`.
4. Expose the service and set **PORT** automatically.

Wait for the build to finish. When the service is **Live**, the bot is running. Open your bot on Telegram and send `/start`.

### 4. Health check

- Your service URL will be like: `https://music-bot-xxxx.onrender.com`
- Health: `https://music-bot-xxxx.onrender.com/health`  
  You should see: `{"status":"ok","bot":"running",...}`

---

## Option B: Deploy without Docker (Native)

Uses Render’s Node environment. **yt-dlp** and **ffmpeg** are not installed by default, so **downloads (YouTube/Instagram/TikTok) will not work** until you add a build step that installs them (e.g. a custom build script). Prefer **Option A (Docker)** if you want downloads to work.

### 1. Create Web Service

1. **New +** → **Web Service** → connect repo.
2. **Runtime:** **Node** (not Docker).
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Root Directory:** Leave empty or set to `rvbot` if the bot lives in that folder.

### 2. Environment

Add **BOT_TOKEN** and optionally **ADMIN_ID** as in Option A.

### 3. Deploy

Click **Create Web Service**. The bot will start, but link downloads will fail until yt-dlp/ffmpeg are available (use Docker for that).

---

## Summary

| Step | Action |
|------|--------|
| 1 | Render → New → Web Service → connect GitHub repo |
| 2 | Choose **Docker** (recommended) or Node |
| 3 | Set **Root Directory** to `rvbot` if the bot is in that folder |
| 4 | Add env: **BOT_TOKEN**, **ADMIN_ID** (optional) |
| 5 | Create Web Service and wait for deploy |
| 6 | Test in Telegram: `/start` and send a link |

---

## Troubleshooting

### Build fails (Docker)

- Ensure **Root Directory** matches where `Dockerfile` and `bot.js` are (e.g. `rvbot` if they’re inside `rvbot/`).
- Check the **Logs** tab for the exact error.

### "BOT_TOKEN or TELEGRAM_BOT_TOKEN not set"

- In Render: **Environment** → add **BOT_TOKEN** (or **TELEGRAM_BOT_TOKEN**) and redeploy.

### Bot doesn’t respond

- Check **Logs** in the Render dashboard for errors.
- Confirm the service is **Live** and the health URL returns `status: "ok"`.
- Make sure the token is correct and has no extra spaces.

### Downloads (YouTube/Instagram/TikTok) don’t work

- Use **Docker** (Option A); the provided Dockerfile installs yt-dlp and ffmpeg.
- On **Node** (Option B), downloads will fail unless you install yt-dlp and ffmpeg in the build (Docker is simpler).

---

## Render free tier notes

- The service may **spin down** after ~15 minutes of no traffic; the first request after that can be slow (cold start).
- The bot uses **polling**, so it stays running as long as the Web Service is up; health checks help avoid spin-down if Render uses them for your plan.
- For 24/7 without cold starts, consider a paid instance or keep the VPS deployment (GitHub Actions).
