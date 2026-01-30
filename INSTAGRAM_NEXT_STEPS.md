# Instagram "No video formats found" – Next steps

When the bot fails with **No video formats found**, it's usually due to yt-dlp’s Instagram extractor or Instagram’s changes, not the bot itself. The bot now **fails fast** (no long retries) and shows a clear error.

## Image-only posts

**yt-dlp’s Instagram extractor does not support image-only posts** (or carousels of only images). It only provides URLs when a post has at least one video.

**Optional: Instaloader fallback** — The bot can use [Instaloader](https://instaloader.github.io/) when yt-dlp fails (including image-only and some “No video formats found” cases). Install with:

```bash
pip install instaloader
```

For **public** posts, Instaloader often works without extra setup. For private posts, you’d need to configure an Instaloader session (separate from `cookies.txt`). If Instaloader is not installed, the bot skips it and shows the usual error.

## 1. Update yt-dlp

You’re using `python -m yt_dlp`, so update with:

```bash
python -m pip install -U yt-dlp
```

For latest dev/nightly (sometimes fixes new Instagram issues):

```bash
python -m pip install -U --pre yt-dlp
```

Check version:

```bash
python -m yt_dlp --version
```

## 2. Re-export Instagram cookies

- Install a “Get cookies.txt LOCALLY” (or similar) extension in Chrome/Edge.
- Log in to [instagram.com](https://instagram.com) in that browser.
- Export cookies for `instagram.com` and save as `cookies.txt` in the `rvbot` folder (same folder as `bot.js`).
- Restart the bot.

## 3. Try another Instagram post

- Test with a **different, public** post (e.g. single photo, single video, or carousel).
- If only one post fails, it’s likely that post or its format; if many fail, it’s more likely yt-dlp or cookies.

## 4. Report to yt-dlp (if it keeps failing)

If it still fails on several public posts after updating and refreshing cookies:

1. Open: https://github.com/yt-dlp/yt-dlp/issues
2. Search for “Instagram” and “No video formats found” to see existing issues.
3. If nothing matches, open a new issue with:
   - The Instagram URL that fails
   - Your yt-dlp version: `python -m yt_dlp --version`
   - The exact error: `No video formats found`
   - That you use `--cookies` with a valid `cookies.txt`

## 5. Run the bot from the correct folder

`package.json` is in `rvbot`. Start the bot with:

```bash
cd rvbot
npm start
```

## 6. Optional: Instaloader for image-only and some “No video formats” cases

If yt-dlp fails with **No video formats found** or on **image-only** posts, the bot tries **Instaloader** as a fallback when it’s installed:

```bash
pip install instaloader
```

This can succeed for many public image-only posts and some posts where yt-dlp returns “No video formats found”. If Instaloader isn’t installed or fails, the bot falls back to the usual error message.

---

**Summary:** Update yt-dlp and cookies first, then test other posts. Optionally install Instaloader for image-only and some “No video formats” failures. If it still fails on several, report to yt-dlp with the URL and error.
