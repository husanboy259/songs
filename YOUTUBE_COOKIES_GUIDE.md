# How to Export YouTube Cookies for RVBot

YouTube is blocking bot requests. To fix this, you need to export cookies from your browser.

## Method 1: Using Browser Extension (Easiest - Recommended)

1. **Install "Get cookies.txt LOCALLY" extension:**
   - Chrome: https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
   - Edge: https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/pdgbckjfkgjpfhcmebpebdkffjbnjknf
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/get-cookies-txt-locally/

2. **Go to https://www.youtube.com** and make sure you're logged in

3. **Export cookies:**
   - Click the extension icon in your browser toolbar
   - Select "youtube.com" from the dropdown
   - Click "Export" button
   - Save the file

4. **Rename and place the file:**
   - Rename the downloaded file to `youtube_cookies.txt`
   - Move it to the bot folder: `c:\Users\Lenovo\OneDrive\Desktop\my-web-sites\music bot\rvbot\youtube_cookies.txt`

5. **Restart the bot:**
   ```bash
   npm start
   ```

## Method 2: Using yt-dlp Command (Alternative)

If you have yt-dlp installed on your computer:

1. **Export cookies using yt-dlp:**
   ```bash
   yt-dlp --cookies-from-browser chrome --cookies youtube_cookies.txt "https://www.youtube.com"
   ```
   
   Or for Edge:
   ```bash
   yt-dlp --cookies-from-browser edge --cookies youtube_cookies.txt "https://www.youtube.com"
   ```

2. **Move the file to bot folder:**
   - The command will create `youtube_cookies.txt` in your current directory
   - Move it to: `c:\Users\Lenovo\OneDrive\Desktop\my-web-sites\music bot\rvbot\youtube_cookies.txt`

3. **Restart the bot**

## Method 3: Manual Export (Advanced)

1. **Open browser DevTools:**
   - Press `F12` or right-click → Inspect
   - Go to **Application** tab (Chrome/Edge) or **Storage** tab (Firefox)

2. **Navigate to Cookies:**
   - Chrome/Edge: Application → Storage → Cookies → `https://www.youtube.com`
   - Firefox: Storage → Cookies → `https://www.youtube.com`

3. **Export cookies:**
   - Copy all cookie values
   - Format them in Netscape cookie format:
     ```
     # Netscape HTTP Cookie File
     .youtube.com	TRUE	/	FALSE	1735689600	cookie_name	cookie_value
     ```
   - Save as `youtube_cookies.txt`

4. **Place in bot folder:**
   - Save to: `c:\Users\Lenovo\OneDrive\Desktop\my-web-sites\music bot\rvbot\youtube_cookies.txt`

## Important Notes

- ✅ **Cookies expire** - You may need to re-export them every few weeks/months
- ✅ **Keep cookies secure** - They contain your YouTube session
- ✅ **Don't share cookies** - Never commit `youtube_cookies.txt` to git (already in .gitignore)
- ✅ **Must be logged in** - Make sure you're logged into YouTube when exporting
- ✅ **File location** - The file must be named exactly `youtube_cookies.txt` and placed in the bot's root folder

## Troubleshooting

- **Still getting blocked?** Try exporting cookies again - they may have expired
- **File not found?** Make sure the file is in the correct location and named exactly `youtube_cookies.txt`
- **Download still fails?** Try using the "best" format option instead of format selection
