require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Start HTTP server IMMEDIATELY for Render/Railway port detection
// This must be done before any other code that might fail
console.log(`[${new Date().toISOString()}] 🚀 Starting MusicBot...`);
const PORT = process.env.PORT || 3000;
console.log(`[${new Date().toISOString()}] Using PORT: ${PORT}`);
let botRunning = false;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      bot: botRunning ? 'running' : 'starting',
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('MusicBot is running! Send /start to your bot on Telegram.');
  }
});

// Start server immediately - don't wait for anything
console.log(`[${new Date().toISOString()}] Starting HTTP server on port ${PORT}...`);
try {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[${new Date().toISOString()}] ✅ HTTP server listening on 0.0.0.0:${PORT}`);
    console.log(`[${new Date().toISOString()}] Health check: http://0.0.0.0:${PORT}/health`);

    // Start the bot AFTER the server is listening
    // This ensures Render can detect the port before the bot starts
    setTimeout(() => {
      if (typeof launchBotWithRetry === 'function') {
        launchBotWithRetry().then(() => {
          botRunning = true;
          console.log(`[${new Date().toISOString()}] Bot startup completed`);
        }).catch((err) => {
          console.error(`[${new Date().toISOString()}] Bot startup failed:`, err);
          // Don't exit - keep the HTTP server running so Render knows the service is up
        });
      } else {
        console.error(`[${new Date().toISOString()}] launchBotWithRetry function not found`);
      }
    }, 1000); // Small delay to ensure server is fully ready
  });
} catch (err) {
  console.error(`[${new Date().toISOString()}] ❌ Failed to start HTTP server:`, err);
  process.exit(1);
}

server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] ❌ HTTP server error:`, err);
  process.exit(1);
});

// Create a custom HTTPS agent with longer timeout and keep-alive
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  timeout: 120000, // 120 seconds timeout
  // Connection timeout
  connectTimeout: 30000, // 30 seconds to establish connection
  // Allow self-signed certificates if needed (for corporate proxies)
  rejectUnauthorized: true
});

// Get bot token from environment (support both BOT_TOKEN and TELEGRAM_BOT_TOKEN)
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error(`[${new Date().toISOString()}] ERROR: BOT_TOKEN or TELEGRAM_BOT_TOKEN not set in environment variables`);
  process.exit(1);
}

// Configure bot with timeout and retry settings
const bot = new Telegraf(BOT_TOKEN, {
  // Telegraf handler timeout (default 90s); 5 min so /tiktoksetup and long downloads don't hit it
  handlerTimeout: 300000,
  telegram: {
    // Set timeout for API requests (300 seconds - 5 minutes for large file uploads)
    timeout: 300000,
    // Retry configuration
    retryAfter: 3000, // Wait 3 seconds before retry
    // Maximum number of retries
    maxRetries: 5, // Increased retries
    // Use custom HTTPS agent for better connection handling
    agent: httpsAgent,
    apiRoot: 'https://api.telegram.org',
    // Additional options
    webhookReply: false // Use polling, not webhooks
  }
});

// Admin ID from environment variable (can be ADMIN_ID or id)
const ADMIN_ID = parseInt(process.env.ADMIN_ID || process.env.id) || null;

if (!ADMIN_ID) {
  console.warn(`[${new Date().toISOString()}] Warning: ADMIN_ID or id not set in .env file`);
}

// User tracking
const usersFilePath = path.join(__dirname, 'users.json');

// Load users from file
function loadUsers() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const data = fs.readFileSync(usersFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error loading users:`, error);
  }
  return { users: [], newUsersToday: 0, lastResetDate: new Date().toDateString() };
}

// Save users to file
function saveUsers(usersData) {
  try {
    fs.writeFileSync(usersFilePath, JSON.stringify(usersData, null, 2), 'utf8');
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error saving users:`, error);
  }
}

// Add or update user
// Returns: 'admin', 'new', or 'existing'
function addUser(userId, username, firstName, lastName) {
  // Check if user is admin
  if (ADMIN_ID && userId === ADMIN_ID) {
    const usersData = loadUsers();
    const today = new Date().toDateString();

    // Reset daily counter if it's a new day
    if (usersData.lastResetDate !== today) {
      usersData.newUsersToday = 0;
      usersData.lastResetDate = today;
    }

    // Update admin info if needed
    const existingUser = usersData.users.find(u => u.id === userId);
    if (existingUser) {
      existingUser.username = username || existingUser.username;
      existingUser.firstName = firstName || existingUser.firstName;
      existingUser.lastName = lastName || existingUser.lastName;
      saveUsers(usersData);
    } else {
      // Admin not in users list yet, add them
      usersData.users.push({
        id: userId,
        username: username || null,
        firstName: firstName || null,
        lastName: lastName || null,
        firstSeen: new Date().toISOString()
      });
      saveUsers(usersData);
    }

    return 'admin';
  }

  const usersData = loadUsers();
  const today = new Date().toDateString();

  // Reset daily counter if it's a new day
  if (usersData.lastResetDate !== today) {
    usersData.newUsersToday = 0;
    usersData.lastResetDate = today;
  }

  // Check if user already exists
  const existingUser = usersData.users.find(u => u.id === userId);
  if (!existingUser) {
    // New user
    usersData.users.push({
      id: userId,
      username: username || null,
      firstName: firstName || null,
      lastName: lastName || null,
      firstSeen: new Date().toISOString()
    });
    usersData.newUsersToday++;
    saveUsers(usersData);
    return 'new';
  }

  // Update existing user info
  existingUser.username = username || existingUser.username;
  existingUser.firstName = firstName || existingUser.firstName;
  existingUser.lastName = lastName || existingUser.lastName;
  saveUsers(usersData);
  return 'existing';
}

// Get statistics
function getStats() {
  const usersData = loadUsers();
  return {
    totalUsers: usersData.users.length,
    newUsersToday: usersData.newUsersToday
  };
}

// Try to find yt-dlp executable
function findYtDlpPath() {
  const { execSync, execFileSync } = require('child_process');

  // First, check virtualenv bin directory (for Render and other venv environments)
  if (process.env.VIRTUAL_ENV) {
    const venvBin = path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp');
    if (fs.existsSync(venvBin)) {
      try {
        execSync(`"${venvBin}" --version`, { stdio: 'ignore' });
        console.log(`[${new Date().toISOString()}] Found yt-dlp in virtualenv: ${venvBin}`);
        return venvBin;
      } catch (e) {
        // File exists but not executable, continue
      }
    }
  }

  // On Windows: if use_python_ytdlp exists, skip bin/ to prefer python -m yt_dlp (avoids OpenSSL bug in standalone exe)
  const usePythonYtDlpFlag = process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'use_python_ytdlp'));
  if (!usePythonYtDlpFlag) {
    // Second, check bin directory in project root (for Render builds; on Windows also bin/yt-dlp.exe)
    const projectBinDir = path.join(__dirname, 'bin');
    const binNames = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];
    for (const name of binNames) {
      const ytDlpInBin = path.join(projectBinDir, name);
      if (fs.existsSync(ytDlpInBin)) {
        try {
          if (process.platform !== 'win32') {
            try { fs.chmodSync(ytDlpInBin, 0o755); } catch (_) {}
          }
          // execFileSync runs the binary directly (no shell) and 15s timeout for slow first-run (e.g. AV scan)
          execFileSync(ytDlpInBin, ['--version'], { stdio: 'ignore', timeout: 15000 });
          console.log(`[${new Date().toISOString()}] Found yt-dlp in bin directory: ${ytDlpInBin}`);
          return ytDlpInBin;
        } catch (e) {
          console.log(`[${new Date().toISOString()}] yt-dlp exists at ${ytDlpInBin} but execution failed: ${e.message}`);
        }
      }
    }
  }

  // Try to find yt-dlp in PATH and get full path
  try {
    // On Linux/Mac, use 'which' to get full path
    if (process.platform !== 'win32') {
      try {
        const fullPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
        if (fullPath && fs.existsSync(fullPath)) {
          console.log(`[${new Date().toISOString()}] Found yt-dlp at: ${fullPath}`);
          return fullPath;
        }
      } catch (e) {
        // which failed, continue
      }
    }

    // Try executing yt-dlp directly to see if it's in PATH
    try {
      execSync('yt-dlp --version', { stdio: 'ignore' });
      // If it works, try to get the full path
      if (process.platform !== 'win32') {
        try {
          const fullPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
          if (fullPath) return fullPath;
        } catch (e) { }
      }
      console.log(`[${new Date().toISOString()}] Found yt-dlp in PATH: yt-dlp`);
      return 'yt-dlp';
    } catch (e) {
      // Not in PATH
    }
  } catch (e) {
    // Continue to other methods
  }

  // Common Windows locations
  const possiblePaths = [
    'yt-dlp.exe',
    // Python 3.13 paths
    path.join(process.env.APPDATA || '', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'Scripts', 'yt-dlp.exe'),
    'C:\\Python313\\Scripts\\yt-dlp.exe',
    // Python 3.14 paths (for future compatibility)
    path.join(process.env.APPDATA || '', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python314', 'Scripts', 'yt-dlp.exe'),
    'C:\\Python314\\Scripts\\yt-dlp.exe',
  ];

  for (const ytDlpPath of possiblePaths) {
    try {
      if (fs.existsSync(ytDlpPath)) {
        console.log(`[${new Date().toISOString()}] Found yt-dlp at: ${ytDlpPath}`);
        return ytDlpPath;
      }
    } catch (e) {
      // Continue to next path
    }
  }

  // Fallback: try python -m yt_dlp or python3 -m yt_dlp
  try {
    execSync('python3 -m yt_dlp --version', { stdio: 'ignore' });
    console.log(`[${new Date().toISOString()}] Using python3 -m yt_dlp`);
    return 'python3';
  } catch (e) {
    // python3 not found, try python
    try {
      execSync('python -m yt_dlp --version', { stdio: 'ignore' });
      console.log(`[${new Date().toISOString()}] Using python -m yt_dlp`);
      return 'python';
    } catch (e2) {
      // Not found
    }
  }

  return null;
}

// Add common installation paths to PATH (for Render and other cloud platforms)
// IMPORTANT: Do this BEFORE calling findYtDlpPath() so it can find yt-dlp in these locations
if (process.env.HOME) {
  const localBin = path.join(process.env.HOME, '.local', 'bin');
  if (fs.existsSync(localBin) && !process.env.PATH.includes(localBin)) {
    process.env.PATH = `${localBin}:${process.env.PATH}`;
  }
}

// Add virtualenv bin directory to PATH (for Render and other platforms using venv)
if (process.env.VIRTUAL_ENV) {
  const venvBin = path.join(process.env.VIRTUAL_ENV, 'bin');
  if (fs.existsSync(venvBin) && !process.env.PATH.includes(venvBin)) {
    process.env.PATH = `${venvBin}:${process.env.PATH}`;
    console.log(`[${new Date().toISOString()}] Added virtualenv bin to PATH: ${venvBin}`);
  }
}

// Add bin directory in project root (for Render builds)
const projectBinDir = path.join(__dirname, 'bin');
if (fs.existsSync(projectBinDir) && !process.env.PATH.includes(projectBinDir)) {
  process.env.PATH = `${projectBinDir}:${process.env.PATH}`;
  // Also check for yt-dlp in this directory
  const ytDlpInBin = path.join(projectBinDir, 'yt-dlp');
  if (fs.existsSync(ytDlpInBin)) {
    console.log(`[${new Date().toISOString()}] Found yt-dlp in bin directory: ${ytDlpInBin}`);
  }
}

// Add Deno to PATH (required for YouTube challenge solving)
// Deno is needed by yt-dlp to solve YouTube's JavaScript challenges
if (process.platform === 'win32') {
  // Common Windows Deno installation paths
  const denoPaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe'),
    path.join(process.env.APPDATA || '', 'deno', 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'deno', 'bin'),
    'C:\\Users\\' + (process.env.USERNAME || process.env.USER) + '\\.deno\\bin'
  ];
  
  for (const denoPath of denoPaths) {
    if (fs.existsSync(denoPath)) {
      const denoExe = path.join(denoPath, 'deno.exe');
      if (fs.existsSync(denoExe)) {
        const pathSeparator = process.platform === 'win32' ? ';' : ':';
        if (!process.env.PATH.includes(denoPath)) {
          process.env.PATH = `${denoPath}${pathSeparator}${process.env.PATH}`;
          console.log(`[${new Date().toISOString()}] ✅ Added Deno to PATH: ${denoPath}`);
        }
        break;
      }
    }
  }
  
  // Also try to find Deno using 'where' command (Windows)
  try {
    const { execSync } = require('child_process');
    const denoPath = execSync('where.exe deno', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0];
    if (denoPath && fs.existsSync(denoPath)) {
      const denoDir = path.dirname(denoPath);
      const pathSeparator = process.platform === 'win32' ? ';' : ':';
      if (!process.env.PATH.includes(denoDir)) {
        process.env.PATH = `${denoDir}${pathSeparator}${process.env.PATH}`;
        console.log(`[${new Date().toISOString()}] ✅ Added Deno to PATH (found via 'where'): ${denoDir}`);
      }
    }
  } catch (e) {
    // Deno not found via 'where', continue
  }
} else {
  // Linux/Mac: Try common Deno installation paths
  const denoPaths = [
    path.join(process.env.HOME || '', '.deno', 'bin'),
    path.join(process.env.HOME || '', '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ];
  
  for (const denoPath of denoPaths) {
    if (fs.existsSync(denoPath)) {
      const denoExe = path.join(denoPath, 'deno');
      if (fs.existsSync(denoExe)) {
        if (!process.env.PATH.includes(denoPath)) {
          process.env.PATH = `${denoPath}:${process.env.PATH}`;
          console.log(`[${new Date().toISOString()}] ✅ Added Deno to PATH: ${denoPath}`);
        }
        break;
      }
    }
  }
}

// Debug: Log environment info
console.log(`[${new Date().toISOString()}] Current working directory: ${process.cwd()}`);
console.log(`[${new Date().toISOString()}] __dirname: ${__dirname}`);
console.log(`[${new Date().toISOString()}] VIRTUAL_ENV: ${process.env.VIRTUAL_ENV || 'not set'}`);
console.log(`[${new Date().toISOString()}] PATH: ${process.env.PATH}`);

// Check if bin directory exists
const debugBinDir = path.join(__dirname, 'bin');
console.log(`[${new Date().toISOString()}] Checking bin directory: ${debugBinDir}`);
if (fs.existsSync(debugBinDir)) {
  const files = fs.readdirSync(debugBinDir);
  console.log(`[${new Date().toISOString()}] Files in bin directory: ${files.join(', ')}`);
  const toCheck = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];
  const found = toCheck.find(n => fs.existsSync(path.join(debugBinDir, n)));
  if (found) {
    const p = path.join(debugBinDir, found);
    const stats = fs.statSync(p);
    console.log(`[${new Date().toISOString()}] yt-dlp file exists: ${p}, size: ${stats.size}`);
  } else {
    console.log(`[${new Date().toISOString()}] yt-dlp not found in bin (looked for: ${toCheck.join(', ')})`);
  }
} else {
  console.log(`[${new Date().toISOString()}] bin directory does NOT exist: ${debugBinDir}`);
}

const ytDlpPath = findYtDlpPath();
if (!ytDlpPath) {
  console.error(`[${new Date().toISOString()}] yt-dlp not found. Please install it: pip install yt-dlp`);
  console.error(`[${new Date().toISOString()}] On Render: The build script should install it automatically.`);
  console.error(`[${new Date().toISOString()}] If this persists, check that Python and pip are available.`);
  console.error(`[${new Date().toISOString()}] Searched locations:`);
  console.error(`[${new Date().toISOString()}]   - Virtualenv: ${process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp') : 'N/A'}`);
  console.error(`[${new Date().toISOString()}]   - Project bin: ${debugBinDir}/yt-dlp`);
  console.error(`[${new Date().toISOString()}]   - PATH: ${process.env.PATH}`);
  process.exit(1);
}

// If we found python/python3, try to find the actual binary in virtualenv first
if ((ytDlpPath === 'python' || ytDlpPath === 'python3') && process.env.VIRTUAL_ENV) {
  const venvYtDlp = path.join(process.env.VIRTUAL_ENV, 'bin', 'yt-dlp');
  if (fs.existsSync(venvYtDlp)) {
    try {
      const { execSync } = require('child_process');
      execSync(`${venvYtDlp} --version`, { stdio: 'ignore', timeout: 5000 });
      console.log(`[${new Date().toISOString()}] Found yt-dlp binary in virtualenv: ${venvYtDlp}`);
      ytDlpPath = venvYtDlp;
    } catch (e) {
      // Keep python command as fallback
    }
  }
}

const finalYtDlpPath = ytDlpPath;
console.log(`[${new Date().toISOString()}] Using yt-dlp at: ${finalYtDlpPath}`);

// Verify Deno is accessible (for YouTube challenge solving)
try {
  const { execSync } = require('child_process');
  const denoVersion = execSync('deno --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  console.log(`[${new Date().toISOString()}] ✅ Deno is accessible: ${denoVersion.split('\n')[0]}`);
  console.log(`[${new Date().toISOString()}] ✅ YouTube challenge solving should work with Deno!`);
} catch (e) {
  console.warn(`[${new Date().toISOString()}] ⚠️ Deno not found in PATH. YouTube challenge solving may fail.`);
  console.warn(`[${new Date().toISOString()}] Install Deno: winget install DenoLand.Deno (Windows) or visit https://deno.land`);
}

// Verify FFmpeg is accessible (for video/audio merging)
try {
  const { execSync } = require('child_process');
  const ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
  const versionLine = ffmpegVersion.split('\n')[0];
  console.log(`[${new Date().toISOString()}] ✅ FFmpeg is accessible: ${versionLine}`);
  console.log(`[${new Date().toISOString()}] ✅ Video/audio merging should work with FFmpeg!`);
} catch (e) {
  console.warn(`[${new Date().toISOString()}] ⚠️ FFmpeg not found in PATH. Video/audio merging may fail.`);
  console.warn(`[${new Date().toISOString()}] Install FFmpeg: winget install Gyan.FFmpeg (Windows) or visit https://ffmpeg.org`);
  console.warn(`[${new Date().toISOString()}] Note: yt-dlp includes FFmpeg binaries, but they may not be in PATH.`);
}

// Create yt-dlp-wrap instance
// Note: yt-dlp-wrap expects a binary path, not a python command
// If we have python command, we'll need to handle it differently
const isPythonCommand = finalYtDlpPath === 'python' || finalYtDlpPath === 'python3';
let ytDlpWrap;

if (isPythonCommand) {
  // If using python -m yt_dlp, we need to create a custom wrapper
  // because yt-dlp-wrap doesn't support python -m format directly
  const { spawn } = require('child_process');
  
  // Create a custom wrapper that uses python -m yt_dlp
  ytDlpWrap = {
    execPromise: async (args) => {
      // Prepend '-m yt_dlp' to the args when using python
      const pythonArgs = ['-m', 'yt_dlp', ...args];
      const logStr = pythonArgs.map(a => (typeof a === 'string' && (a.includes(' ') || a.includes('"'))) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a)).join(' ');
      console.log(`[${new Date().toISOString()}] Executing: ${finalYtDlpPath} ${logStr}`);
      
      return new Promise((resolve, reject) => {
        const child = spawn(finalYtDlpPath, pythonArgs, {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          windowsHide: true
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Command timeout after 10 minutes'));
        }, 600000); // 10 minutes
        
        child.on('close', (code) => {
          clearTimeout(timeout);
          
          if (code !== 0) {
            const error = new Error(`Command failed with exit code ${code}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          } else {
            // Sometimes yt-dlp outputs to stderr even on success
            resolve(stdout || stderr || '');
          }
        });
        
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    },
    getBinaryPath: () => `${finalYtDlpPath} -m yt_dlp`
  };
  
  console.log(`[${new Date().toISOString()}] Using ${finalYtDlpPath} -m yt_dlp wrapper`);
} else {
  // Normal binary path
  ytDlpWrap = new YTDlpWrap(finalYtDlpPath, {
    timeout: 600000 // 10 minutes timeout for yt-dlp operations
  });
}

// Check if curl_cffi/impersonation is available (for TikTok); only then use --impersonate chrome
let tiktokImpersonateAvailable = false;
try {
  const { execSync } = require('child_process');
  const listCmd = isPythonCommand
    ? `${finalYtDlpPath} -m yt_dlp --list-impersonate-targets`
    : `"${finalYtDlpPath}" --list-impersonate-targets`;
  const out = execSync(listCmd, { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (out && (out.includes('chrome') || out.includes('chromium'))) tiktokImpersonateAvailable = true;
} catch (_) { /* curl_cffi not installed or yt-dlp too old */ }
console.log(`[${new Date().toISOString()}] TikTok impersonation (curl_cffi): ${tiktokImpersonateAvailable ? 'available' : 'not available'}`);

// Store user states for YouTube format selection
const userStates = new Map();

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to download Instagram media (images and videos)
async function downloadInstagramMedia(ctx, messageText) {
  console.log(`[${new Date().toISOString()}] User ${ctx.from.id} sent message: ${messageText}`);

  // Validate Instagram URL
  const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;

  if (!instagramUrlPattern.test(messageText)) {
    console.log(`[${new Date().toISOString()}] Invalid Instagram URL format: ${messageText}`);
    await safeReply(ctx, 'Please send a valid Instagram link. Example: https://www.instagram.com/p/...');
    return;
  }

  console.log(`[${new Date().toISOString()}] Valid Instagram URL received: ${messageText}`);

  // Send processing message
  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  // Generic URL detection (if not YT/Insta) - defined early but used in handler
  // We'll handle this in the main handler logic, but let's check here if we need specific generic logic inside this function
  // Actually, this function is specific to Instagram. We need a separate function for Generic.

  try {
    // Check if yt-dlp binary exists (skip check if it's a command name in PATH)
    const binaryPath = ytDlpWrap.getBinaryPath();
    const isCommandName = !binaryPath.includes('/') && !binaryPath.includes('\\') && !binaryPath.endsWith('.exe');
    if (!isCommandName && !fs.existsSync(binaryPath)) {
      console.error(`[${new Date().toISOString()}] yt-dlp binary not found at: ${binaryPath}`);
      throw new Error(`yt-dlp binary not found at ${binaryPath}. Please install yt-dlp.`);
    }

    // First, get media info to determine if it's an image or video
    // Don't use --no-playlist here - we need to detect carousel posts
    const infoArgs = [
      messageText,
      '--print-json'
      // Removed --no-playlist to allow carousel detection
    ];

    // Add cookies file if it exists and validate it
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    let hasValidCookies = false;
    if (fs.existsSync(cookiesPath)) {
      try {
        const cookieStats = fs.statSync(cookiesPath);
        const cookieContent = fs.readFileSync(cookiesPath, 'utf8');
        // Check if cookies file has content and looks valid
        if (cookieStats.size > 100 && cookieContent.includes('instagram.com')) {
          infoArgs.push('--cookies', cookiesPath);
          hasValidCookies = true;
          console.log(`[${new Date().toISOString()}] Using Instagram cookies file: ${cookiesPath} (${(cookieStats.size / 1024).toFixed(2)} KB)`);
        } else {
          console.warn(`[${new Date().toISOString()}] Instagram cookies file exists but appears invalid or too small`);
        }
      } catch (e) {
        console.warn(`[${new Date().toISOString()}] Error reading cookies file:`, e.message);
      }
    } else {
      console.log(`[${new Date().toISOString()}] No Instagram cookies file found. Some posts may require authentication.`);
    }

    // Don't use extractor args - let yt-dlp auto-detect (works better for carousel posts)
    // infoArgs.push('--extractor-args', 'instagram:skip_login=false');
    
    // Add user-agent for better compatibility (Instagram mobile user agent works better)
    infoArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');

    console.log(`[${new Date().toISOString()}] Getting media info...`);
    let mediaInfo;
    try {
      const infoOutput = await ytDlpWrap.execPromise(infoArgs);
      // Try to parse JSON - it might be in stdout or mixed with other output
      try {
        mediaInfo = JSON.parse(infoOutput);
      } catch (parseError) {
        // Try to extract JSON from the output (might have other text before/after)
        const jsonMatch = infoOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          mediaInfo = JSON.parse(jsonMatch[0]);
        } else {
          throw parseError;
        }
      }
    } catch (error) {
      // If JSON parsing fails, try to extract from stderr or use fallback
      console.log(`[${new Date().toISOString()}] Could not parse JSON, trying alternative method...`);
      // Continue with download and detect from file extension
      mediaInfo = null;
    }

    // Determine media type (for logging purposes)
    let isImage = false;
    if (mediaInfo) {
      // Check if it's an image based on format or ext
      const ext = mediaInfo.ext || '';
      const format = mediaInfo.format || '';
      isImage = /jpg|jpeg|png|webp/i.test(ext) || /image/i.test(format);

      // Also check entries for carousel posts
      if (mediaInfo.entries && mediaInfo.entries.length > 0) {
        const firstEntry = mediaInfo.entries[0];
        const entryExt = firstEntry.ext || '';
        isImage = /jpg|jpeg|png|webp/i.test(entryExt);
      }
    }

    // Generate unique filename - let yt-dlp determine the extension
    const timestamp = Date.now();
    // Use %(ext)s to let yt-dlp determine the file extension automatically
    // For carousel posts, use %(playlist_index)s to handle multiple files
    // If playlist_index is empty (single item), it will just be media_TIMESTAMP.ext
    const outputPath = path.join(tempDir, `media_${timestamp}%(playlist_index)s.%(ext)s`);

    console.log(`[${new Date().toISOString()}] Starting download...`);
    console.log(`[${new Date().toISOString()}] URL: ${messageText}`);
    console.log(`[${new Date().toISOString()}] Media type: ${isImage ? 'image' : 'video (or unknown)'}`);
    console.log(`[${new Date().toISOString()}] Output path template: ${outputPath}`);

    // Check if it's a carousel post (multiple items)
    let isCarousel = false;
    if (mediaInfo && mediaInfo.entries && mediaInfo.entries.length > 1) {
      isCarousel = true;
      console.log(`[${new Date().toISOString()}] Detected carousel post with ${mediaInfo.entries.length} items`);
    }

    // Download media using yt-dlp
    // -f best: works for both video and image formats when the extractor provides them
    const ytDlpArgs = [
      messageText,
      '-f', 'best',
      '-o', outputPath
    ];

    // Note: yt-dlp doesn't support --recode-image
    // Images will be downloaded in their original format
    // We can convert to PNG after download if needed

    // Add cookies file if it exists and is valid
    if (hasValidCookies) {
      ytDlpArgs.push('--cookies', cookiesPath);
    }

    // Don't use extractor args for carousel posts - let yt-dlp auto-detect
    // ytDlpArgs.push('--extractor-args', 'instagram:skip_login=false');
    
    // Add user-agent for better compatibility (Instagram mobile user agent works better)
    ytDlpArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');

    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);

    let stdout;
    let noVideoFormatsFound = false; // When true, skip retries/strategies (yt-dlp extractor limitation)
    let imageOnlyNotSupported = false; // "There is no video in this post" = image-only; yt-dlp doesn't provide image URLs
    try {
      stdout = await ytDlpWrap.execPromise(ytDlpArgs);
    } catch (firstError) {
      const errorMessage = firstError.message || '';
      const stderr = firstError.stderr || '';
      const combinedError = errorMessage + stderr;

      // "There is no video in this post" = image-only. yt-dlp's Instagram extractor does not support image-only posts.
      if (combinedError.includes('There is no video in this post')) {
        imageOnlyNotSupported = true;
        stdout = '';
        console.warn(`[${new Date().toISOString()}] Image-only post: yt-dlp Instagram extractor does not support these.`);
      } else if (combinedError.includes('No video formats found')) {
        noVideoFormatsFound = true;
        stdout = 'Downloading 0 items';
        console.warn(`[${new Date().toISOString()}] No video formats found (yt-dlp/Instagram limitation). Skipping retries.`);
      } else if (combinedError.includes('There is no image in this post')) {
        // Rare: retry with auto-detection
        console.log(`[${new Date().toISOString()}] Format mismatch detected, retrying with auto-detection...`);
        try {
          const retryArgs = [messageText, '-f', 'best', '-o', outputPath];
          if (hasValidCookies) retryArgs.push('--cookies', cookiesPath);
          retryArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
          stdout = await ytDlpWrap.execPromise(retryArgs);
        } catch (retryError) {
          const retryErrorMsg = (retryError.message || '') + (retryError.stderr || '');
          if (retryErrorMsg.includes('No video formats found')) { noVideoFormatsFound = true; stdout = 'Downloading 0 items'; } else { throw retryError; }
        }
      } else {
        throw firstError;
      }
    }

    if (imageOnlyNotSupported) {
      // Try Instaloader as fallback (it can download image-only posts)
      // Instaloader 4.x: target must be -SHORTCODE (e.g. -DT56joQDMJJ) so it's treated as a post, not a profile
      let instaOk = false;
      try {
        const shortcodeMatch = messageText.match(/\/p\/([A-Za-z0-9_-]+)/i);
        const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;
        if (shortcode) {
          const { spawn } = require('child_process');
          const instaDir = path.join(tempDir, `insta_img_${timestamp}`);
          fs.mkdirSync(instaDir, { recursive: true });
          const res = await new Promise((resolve, reject) => {
            const p = spawn('python', ['-m', 'instaloader', '--no-captions', '--quiet', '--', '-' + shortcode], { cwd: instaDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            const err = [];
            p.stderr.on('data', d => err.push(d));
            const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve({ ok: false }); }, 90000);
            p.on('close', c => { clearTimeout(t); resolve({ ok: c === 0, stderr: Buffer.concat(err).toString() }); });
            p.on('error', e => { clearTimeout(t); reject(e); });
          });
        if (res.ok) {
          const exts = /\.(jpg|jpeg|png|webp|mp4|mkv|webm|avi)$/i;
          function collect(d, acc) {
            try {
              for (const n of fs.readdirSync(d)) {
                const fp = path.join(d, n);
                if (fs.statSync(fp).isDirectory()) collect(fp, acc);
                else if (exts.test(n)) acc.push(fp);
              }
            } catch (_) {}
            return acc;
          }
          const list = collect(instaDir, []).sort();
          if (list.length > 0) {
            for (let i = 0; i < list.length; i++) fs.copyFileSync(list[i], path.join(tempDir, `media_${timestamp}_${i + 1}${path.extname(list[i])}`));
            instaOk = true;
            console.log(`[${new Date().toISOString()}] Instaloader fallback (image-only) succeeded: ${list.length} file(s)`);
          }
          try { fs.rmSync(instaDir, { recursive: true, force: true }); } catch (_) {}
        }
        }
      } catch (_) {}
      if (!instaOk) {
        const err = '⚠️ This is an image-only post.\n\nyt-dlp\'s Instagram extractor does not support downloading image-only posts. Please try a post that contains a video (or both image and video).\n\n💡 Optional: `pip install instaloader` for image-only fallback.';
        if (processingMsg && processingMsg.message_id) {
          try {
            await safeTelegramCall(ctx.telegram.editMessageText.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id, null, err);
          } catch (e) { await safeReply(ctx, err); }
        } else { await safeReply(ctx, err); }
        return;
      }
    }

    console.log(`[${new Date().toISOString()}] yt-dlp stdout:`, stdout);
    console.log(`[${new Date().toISOString()}] Download completed, checking file...`);

    // First, check if any files were actually downloaded
    let files = fs.readdirSync(tempDir);
    let basePattern = `media_${timestamp}`;
    let downloadedFiles = files.filter(file => 
      file.startsWith(basePattern) && 
      /\.(jpg|jpeg|png|webp|mp4|mkv|webm|avi)$/i.test(file)
    );

    // If no files were downloaded, check if it's a carousel issue or "No video formats found" error
    const needsCarouselHandling = downloadedFiles.length === 0 && stdout && (
      stdout.includes('Downloading 0 items') || 
      (stdout.includes('Finished downloading playlist') && stdout.includes('Downloading 0')) ||
      stdout.includes('No video formats found')
    );

    if (needsCarouselHandling) {
      let downloadSucceeded = false;
      if (noVideoFormatsFound) {
        console.warn(`[${new Date().toISOString()}] No video formats found. Skipping retries and strategies (yt-dlp/Instagram limitation).`);
      } else {
        console.warn(`[${new Date().toISOString()}] Carousel post detected but 0 items downloaded. Trying alternative method...`);
        if (!mediaInfo || !mediaInfo.entries || mediaInfo.entries.length === 0) {
          console.log(`[${new Date().toISOString()}] Attempting to get media info again for carousel items...`);
          try {
            const retryInfoArgs = [messageText, '--dump-json', '--flat-playlist'];
            if (hasValidCookies) retryInfoArgs.push('--cookies', cookiesPath);
            retryInfoArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
            const retryInfoOutput = await ytDlpWrap.execPromise(retryInfoArgs);
            try {
              const jsonMatch = retryInfoOutput.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                mediaInfo = JSON.parse(jsonMatch[0]);
                console.log(`[${new Date().toISOString()}] Successfully retrieved media info with ${mediaInfo.entries ? mediaInfo.entries.length : 0} entries`);
              }
            } catch (parseErr) {
              console.warn(`[${new Date().toISOString()}] Could not parse retry info JSON:`, parseErr.message);
            }
          } catch (infoError) {
            console.warn(`[${new Date().toISOString()}] Could not get retry media info:`, infoError.message);
            if (infoError.stderr) console.warn(`[${new Date().toISOString()}] stderr:`, infoError.stderr.substring(0, 500));
            if ((infoError.stderr || '').includes('No video formats found')) noVideoFormatsFound = true;
          }
        }
        if (!noVideoFormatsFound) {
      // Strategy 1: Try with explicit --yes-playlist flag and mobile user agent
      if (!downloadSucceeded) {
        try {
          console.log(`[${new Date().toISOString()}] Strategy 1: Retrying with --yes-playlist flag and mobile user agent...`);
          const playlistArgs = [
            messageText,
            '-o', outputPath,
            '--yes-playlist' // Explicitly enable playlist downloading
          ];
          
          // Note: yt-dlp doesn't support --recode-image
          // Images will be downloaded in their original format
          
          if (hasValidCookies) {
            playlistArgs.push('--cookies', cookiesPath);
          }
          
          // Don't use extractor args - let yt-dlp auto-detect
          playlistArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
          
          stdout = await ytDlpWrap.execPromise(playlistArgs);
          console.log(`[${new Date().toISOString()}] Strategy 1 stdout:`, stdout);
          
          // Check again if we got items
          if (!stdout || (!stdout.includes('Downloading 0 items') && !(stdout.includes('Finished downloading playlist') && stdout.includes('Downloading 0')))) {
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Strategy 1 succeeded - items downloaded`);
          } else {
            throw new Error('Still 0 items after strategy 1');
          }
        } catch (retryError) {
          console.warn(`[${new Date().toISOString()}] Strategy 1 failed:`, retryError.message);
          if (retryError.stderr) {
            const stderrPreview = retryError.stderr.substring(0, 300);
            if (stderrPreview.includes('No video formats found')) {
              console.warn(`[${new Date().toISOString()}] Instagram error: No video formats found`);
            }
          }
        }
      }
      
      // Strategy 2: Try with desktop user agent
      if (!downloadSucceeded) {
        try {
          console.log(`[${new Date().toISOString()}] Strategy 2: Retrying with desktop user agent...`);
          const desktopArgs = [
            messageText,
            '-o', outputPath,
            '--yes-playlist'
          ];
          
          // Note: yt-dlp doesn't support --recode-image
          // Images will be downloaded in their original format
          
          if (hasValidCookies) {
            desktopArgs.push('--cookies', cookiesPath);
          }
          
          // Don't use extractor args - let yt-dlp auto-detect
          desktopArgs.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          
          stdout = await ytDlpWrap.execPromise(desktopArgs);
          console.log(`[${new Date().toISOString()}] Strategy 2 stdout:`, stdout);
          
          if (!stdout || (!stdout.includes('Downloading 0 items') && !(stdout.includes('Finished downloading playlist') && stdout.includes('Downloading 0')))) {
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Strategy 2 succeeded - items downloaded`);
          } else {
            throw new Error('Still 0 items after strategy 2');
          }
        } catch (retryError) {
          console.warn(`[${new Date().toISOString()}] Strategy 2 failed:`, retryError.message);
          if (retryError.stderr) {
            const stderrPreview = retryError.stderr.substring(0, 300);
            if (stderrPreview.includes('No video formats found')) {
              console.warn(`[${new Date().toISOString()}] Instagram error: No video formats found`);
            }
          }
        }
      }
      
      // Strategy 3: Try without extractor args (let yt-dlp auto-detect)
      if (!downloadSucceeded) {
        try {
          console.log(`[${new Date().toISOString()}] Strategy 3: Retrying without extractor args...`);
          const noExtractorArgs = [
            messageText,
            '-o', outputPath,
            '--yes-playlist'
          ];
          
          // Note: yt-dlp doesn't support --recode-image
          // Images will be downloaded in their original format
          
          if (hasValidCookies) {
            noExtractorArgs.push('--cookies', cookiesPath);
          }
          
          noExtractorArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
          
          stdout = await ytDlpWrap.execPromise(noExtractorArgs);
          console.log(`[${new Date().toISOString()}] Strategy 3 stdout:`, stdout);
          
          if (!stdout || (!stdout.includes('Downloading 0 items') && !(stdout.includes('Finished downloading playlist') && stdout.includes('Downloading 0')))) {
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Strategy 3 succeeded - items downloaded`);
          } else {
            throw new Error('Still 0 items after strategy 3');
          }
        } catch (retryError) {
          console.warn(`[${new Date().toISOString()}] Strategy 3 failed:`, retryError.message);
          if (retryError.stderr) {
            const stderrPreview = retryError.stderr.substring(0, 300);
            if (stderrPreview.includes('No video formats found')) {
              console.warn(`[${new Date().toISOString()}] Instagram error: No video formats found`);
            }
          }
        }
      }

      // Strategy 4: Try listing formats to see what's available
      if (!downloadSucceeded) {
        try {
          console.log(`[${new Date().toISOString()}] Strategy 4: Trying to list available formats...`);
          const listFormatsArgs = [
            messageText,
            '--list-formats'
          ];
          
          if (hasValidCookies) {
            listFormatsArgs.push('--cookies', cookiesPath);
          }
          
          listFormatsArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
          
          const formatsOutput = await ytDlpWrap.execPromise(listFormatsArgs);
          console.log(`[${new Date().toISOString()}] Available formats:`, formatsOutput);
          
          // If we got formats, try downloading with best format
          if (formatsOutput && !formatsOutput.includes('No video formats found') && !formatsOutput.includes('ERROR')) {
            const downloadWithFormatArgs = [
              messageText,
              '-f', 'best',
              '-o', outputPath,
              '--yes-playlist'
            ];
            
            if (hasValidCookies) {
              downloadWithFormatArgs.push('--cookies', cookiesPath);
            }
            
            downloadWithFormatArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
            
            stdout = await ytDlpWrap.execPromise(downloadWithFormatArgs);
            if (stdout && !stdout.includes('Downloading 0 items')) {
              downloadSucceeded = true;
              console.log(`[${new Date().toISOString()}] Strategy 4 succeeded - items downloaded`);
            }
          }
        } catch (listError) {
          console.warn(`[${new Date().toISOString()}] Strategy 4 failed:`, listError.message);
          if (listError.stderr) {
            const stderrPreview = listError.stderr.substring(0, 500);
            console.warn(`[${new Date().toISOString()}] Strategy 4 stderr preview:`, stderrPreview);
            if (stderrPreview.includes('No video formats found')) {
              console.warn(`[${new Date().toISOString()}] Instagram error: No video formats found`);
            }
          }
        }
      }

      // Strategy 5: Try cookies from browser only when cookies.txt is missing or invalid.
      // (When cookies.txt exists, browser cookies usually give the same "No video formats found";
      // --cookies-from-browser chrome often fails on Windows with "Could not copy Chrome cookie database" if Chrome is open.)
      if (!downloadSucceeded && process.platform === 'win32' && !hasValidCookies) {
        try {
          console.log(`[${new Date().toISOString()}] Strategy 5: Trying with cookies from browser...`);
          const browserCookiesArgs = [
            messageText,
            '-o', outputPath,
            '--yes-playlist',
            '--cookies-from-browser', 'chrome' // Try Chrome first
          ];
          
          browserCookiesArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
          
          stdout = await ytDlpWrap.execPromise(browserCookiesArgs);
          if (stdout && !stdout.includes('Downloading 0 items') && !stdout.includes('No video formats found')) {
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Strategy 5 succeeded - items downloaded using browser cookies`);
          } else {
            // Try Edge if Chrome failed
            const edgeCookiesArgs = [
              messageText,
              '-o', outputPath,
              '--yes-playlist',
              '--cookies-from-browser', 'edge'
            ];
            
            edgeCookiesArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
            
            stdout = await ytDlpWrap.execPromise(edgeCookiesArgs);
            if (stdout && !stdout.includes('Downloading 0 items') && !stdout.includes('No video formats found')) {
              downloadSucceeded = true;
              console.log(`[${new Date().toISOString()}] Strategy 5 succeeded - items downloaded using Edge browser cookies`);
            }
          }
        } catch (browserError) {
          console.warn(`[${new Date().toISOString()}] Strategy 5 failed:`, browserError.message);
          if (browserError.stderr) {
            const stderrPreview = browserError.stderr.substring(0, 500);
            console.warn(`[${new Date().toISOString()}] Strategy 5 stderr preview:`, stderrPreview);
            if (stderrPreview.includes('No video formats found')) {
              console.warn(`[${new Date().toISOString()}] Instagram error: No video formats found (even with browser cookies)`);
            }
          }
        }
      }
        }
      }
      
      // If all strategies failed, try downloading individual items
      if (!downloadSucceeded) {
        
        // Try alternative: download each item individually if we have mediaInfo with entries
        if (mediaInfo && mediaInfo.entries && mediaInfo.entries.length > 0) {
          console.log(`[${new Date().toISOString()}] Attempting to download ${mediaInfo.entries.length} carousel items individually...`);
          
          let successCount = 0;
          for (let i = 0; i < mediaInfo.entries.length; i++) {
            const entry = mediaInfo.entries[i];
            const entryUrl = entry.url || entry.webpage_url || messageText;
            
            try {
              const itemOutputPath = path.join(tempDir, `media_${timestamp}_${i + 1}.%(ext)s`);
              const itemArgs = [
                entryUrl,
                '-o', itemOutputPath
              ];
              
              // Note: yt-dlp doesn't support --recode-image
              // Images will be downloaded in their original format
              
              if (hasValidCookies) {
                itemArgs.push('--cookies', cookiesPath);
              }
              
              // Don't use extractor args - let yt-dlp auto-detect
              itemArgs.push('--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
              
              await ytDlpWrap.execPromise(itemArgs);
              successCount++;
              console.log(`[${new Date().toISOString()}] Successfully downloaded carousel item ${i + 1}/${mediaInfo.entries.length}`);
            } catch (itemError) {
              console.warn(`[${new Date().toISOString()}] Failed to download carousel item ${i + 1}:`, itemError.message);
            }
          }
          
          if (successCount > 0) {
            // Continue with file processing below
            console.log(`[${new Date().toISOString()}] Successfully downloaded ${successCount} out of ${mediaInfo.entries.length} carousel items`);
          } else {
            // All individual downloads failed
            const errorMsg = hasValidCookies 
              ? '⚠️ This Instagram carousel post could not be downloaded.\n\nPossible reasons:\n• yt-dlp may need to be updated (`yt-dlp -U` or `python -m pip install -U yt-dlp`)\n• Image-only or image-carousel posts are not supported by yt-dlp\'s Instagram extractor\n• Some posts fail with "No video formats found" (yt-dlp/Instagram limitation)\n• The post is private or restricted\n• The post may have been deleted\n• Your cookies may have expired\n\n💡 Tips:\n1. Update yt-dlp: `yt-dlp -U` or `python -m pip install -U yt-dlp`\n2. Re-export Instagram cookies from your browser\n3. Try a post that contains a video\n4. Ensure the post is public and accessible'
              : '⚠️ This Instagram carousel post could not be downloaded.\n\nPossible reasons:\n• yt-dlp may need to be updated (`yt-dlp -U` or `python -m pip install -U yt-dlp`)\n• Image-only or image-carousel posts are not supported by yt-dlp\'s Instagram extractor\n• Some posts fail with "No video formats found" (yt-dlp/Instagram limitation)\n• The post requires login (Instagram cookies are needed)\n• The post is private or restricted\n• The post may have been deleted\n\n💡 Tips:\n1. Update yt-dlp: `yt-dlp -U` or `python -m pip install -U yt-dlp`\n2. Export Instagram cookies from your browser\n3. Try a post that contains a video\n\n📋 How to export cookies:\n1. Install "Get cookies.txt LOCALLY" browser extension\n2. Go to instagram.com and log in\n3. Export cookies for instagram.com\n4. Save as "cookies.txt" in the bot folder';
            
            if (processingMsg && processingMsg.message_id) {
              try {
                await safeTelegramCall(
                  ctx.telegram.editMessageText.bind(ctx.telegram),
                  300000,
                  ctx.chat.id,
                  processingMsg.message_id,
                  null,
                  errorMsg
                );
              } catch (err) {
                await safeReply(ctx, '⚠️ This Instagram carousel post could not be downloaded. The post may be private or require authentication.');
              }
            } else {
              await safeReply(ctx, errorMsg);
            }
            return;
          }
        } else {
          // No mediaInfo entries - try Instaloader as fallback (handles image-only and some "No video formats" cases)
          // Instaloader 4.x: target must be -SHORTCODE (e.g. -DT56joQDMJJ) so it's treated as a post, not a profile
          let instaSuccess = false;
          try {
            const shortcodeMatch = messageText.match(/\/p\/([A-Za-z0-9_-]+)/i);
            const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;
            if (shortcode) {
              const { spawn } = require('child_process');
              const instaDir = path.join(tempDir, `insta_${timestamp}`);
              fs.mkdirSync(instaDir, { recursive: true });
              const instaResult = await new Promise((resolve, reject) => {
                const proc = spawn('python', ['-m', 'instaloader', '--no-captions', '--quiet', '--', '-' + shortcode], {
                  cwd: instaDir,
                  stdio: ['ignore', 'pipe', 'pipe'],
                  windowsHide: true
                });
                const out = [], err = [];
                proc.stdout.on('data', d => out.push(d));
                proc.stderr.on('data', d => err.push(d));
                const t = setTimeout(() => {
                  try { proc.kill(); } catch (_) {}
                  resolve({ ok: false, reason: 'timeout' });
                }, 90000);
                proc.on('close', code => {
                  clearTimeout(t);
                  resolve({ ok: code === 0, code, stderr: Buffer.concat(err).toString() });
                });
                proc.on('error', e => { clearTimeout(t); reject(e); });
              });
            if (instaResult.ok) {
              const exts = /\.(jpg|jpeg|png|webp|mp4|mkv|webm|avi)$/i;
              function walk(d, acc) {
                let names;
                try { names = fs.readdirSync(d); } catch (_) { return acc; }
                for (const n of names) {
                  const p = path.join(d, n);
                  try {
                    if (fs.statSync(p).isDirectory()) walk(p, acc);
                    else if (exts.test(n)) acc.push(p);
                  } catch (_) {}
                }
                return acc;
              }
              const found = walk(instaDir, []).sort();
              if (found.length > 0) {
                for (let i = 0; i < found.length; i++) {
                  const ext = path.extname(found[i]);
                  fs.copyFileSync(found[i], path.join(tempDir, `media_${timestamp}_${i + 1}${ext}`));
                }
                instaSuccess = true;
                downloadSucceeded = true;
                console.log(`[${new Date().toISOString()}] Instaloader fallback succeeded: ${found.length} file(s)`);
              }
            } else {
              if (instaResult.stderr && (instaResult.stderr.includes('No module named') || instaResult.stderr.includes("'instaloader'"))) {
                console.log(`[${new Date().toISOString()}] Instaloader not installed (optional: pip install instaloader for image-only fallback)`);
              } else {
                console.warn(`[${new Date().toISOString()}] Instaloader fallback failed:`, instaResult.reason || (instaResult.stderr || '').slice(0, 200) || instaResult.code);
              }
            }
            try { fs.rmSync(instaDir, { recursive: true, force: true }); } catch (_) {}
            }
          } catch (e) {
            console.warn(`[${new Date().toISOString()}] Instaloader fallback error:`, e.message);
          }
          if (!instaSuccess) {
            const errorMsg = hasValidCookies
              ? '⚠️ This Instagram post could not be downloaded.\n\nPossible reasons:\n• yt-dlp may need to be updated (`yt-dlp -U` or `python -m pip install -U yt-dlp`)\n• Image-only posts are not supported by yt-dlp\'s Instagram extractor (use a post with a video)\n• Some posts fail with "No video formats found" (yt-dlp/Instagram limitation)\n• The post is private or restricted\n• The post may have been deleted\n• Your cookies may have expired\n\n💡 Tips:\n1. Update yt-dlp: `yt-dlp -U` or `python -m pip install -U yt-dlp`\n2. Re-export Instagram cookies from your browser\n3. Try a post that contains a video\n4. Ensure the post is public and accessible\n5. Optional: `pip install instaloader` for image-only fallback'
              : '⚠️ This Instagram post could not be downloaded.\n\nPossible reasons:\n• yt-dlp may need to be updated (`yt-dlp -U` or `python -m pip install -U yt-dlp`)\n• Image-only posts are not supported by yt-dlp\'s Instagram extractor (use a post with a video)\n• Some posts fail with "No video formats found" (yt-dlp/Instagram limitation)\n• The post requires login (Instagram cookies are needed)\n• The post is private or restricted\n• The post may have been deleted\n\n💡 Tips:\n1. Update yt-dlp: `yt-dlp -U` or `python -m pip install -U yt-dlp`\n2. Export Instagram cookies from your browser\n3. Try a post that contains a video\n4. Optional: `pip install instaloader` for image-only fallback\n\n📋 How to export cookies:\n1. Install "Get cookies.txt LOCALLY" browser extension\n2. Go to instagram.com and log in\n3. Export cookies for instagram.com\n4. Save as "cookies.txt" in the bot folder';
            
            if (processingMsg && processingMsg.message_id) {
              try {
                await safeTelegramCall(
                  ctx.telegram.editMessageText.bind(ctx.telegram),
                  300000,
                  ctx.chat.id,
                  processingMsg.message_id,
                  null,
                  errorMsg
                );
              } catch (err) {
                await safeReply(ctx, '⚠️ This Instagram post could not be downloaded. The post may be private or require authentication.');
              }
            } else {
              await safeReply(ctx, errorMsg);
            }
            return;
          }
        }
      }
    }

    // Re-check for downloaded files (in case carousel strategies downloaded them)
    files = fs.readdirSync(tempDir);
    basePattern = `media_${timestamp}`;
    downloadedFiles = files.filter(file => {
      // Match files starting with basePattern and having valid media extensions
      // Handles: media_TIMESTAMP.ext, media_TIMESTAMPNA.ext, media_TIMESTAMP_1.ext, etc.
      return file.startsWith(basePattern) && 
             /\.(jpg|jpeg|png|webp|mp4|mkv|webm|avi)$/i.test(file);
    }).sort((a, b) => {
      // Sort by playlist index if present (extract number from filename like _1, _2, etc.)
      const aMatch = a.match(/_(\d+)\./);
      const bMatch = b.match(/_(\d+)\./);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      // Files with "NA" or no index come first, then numbered files
      if (a.includes('NA') && bMatch) return -1;
      if (b.includes('NA') && aMatch) return 1;
      return a.localeCompare(b); // Alphabetical for same type
    });

    if (downloadedFiles.length === 0) {
      console.error(`[${new Date().toISOString()}] Media file was not created. Files in temp:`, files);
      throw new Error('Media file was not downloaded');
    }

    console.log(`[${new Date().toISOString()}] Found ${downloadedFiles.length} file(s) from Instagram post`);

    // Process each downloaded file
    let sentCount = 0;
    for (const downloadedFile of downloadedFiles) {
      const actualOutputPath = path.join(tempDir, downloadedFile);
      console.log(`[${new Date().toISOString()}] Processing file: ${actualOutputPath}`);

      // Detect actual file type from downloaded file
      let actualOutputPathFinal = actualOutputPath;
      const actualFileExtension = path.extname(actualOutputPathFinal).toLowerCase().replace('.', '');
      let actualIsImage = /jpg|jpeg|png|webp/i.test(actualFileExtension);

      // Convert images to PNG format if not already PNG
      if (actualIsImage && actualFileExtension !== 'png') {
        try {
          const { execSync } = require('child_process');
          const pngPath = actualOutputPathFinal.replace(/\.(jpg|jpeg|webp)$/i, '.png');
          console.log(`[${new Date().toISOString()}] Converting image to PNG: ${actualOutputPathFinal} -> ${pngPath}`);
          execSync(`ffmpeg -i "${actualOutputPathFinal}" -y "${pngPath}"`, { 
            encoding: 'utf8', 
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 30000 
          });
          if (fs.existsSync(pngPath)) {
            fs.unlinkSync(actualOutputPathFinal); // Delete original
            actualOutputPathFinal = pngPath;
            console.log(`[${new Date().toISOString()}] Image converted to PNG successfully`);
          }
        } catch (convertError) {
          console.warn(`[${new Date().toISOString()}] Could not convert image to PNG, using original:`, convertError.message);
        }
      }

      const stats = fs.statSync(actualOutputPathFinal);
      const fileSizeInMB = stats.size / (1024 * 1024);

      console.log(`[${new Date().toISOString()}] File ${sentCount + 1}/${downloadedFiles.length}: Size: ${fileSizeInMB.toFixed(2)} MB, Type: ${actualIsImage ? 'image' : 'video'}`);

      // Telegram has a 50MB file size limit for bots
      if (fileSizeInMB > 50) {
        console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), skipping...`);
        try {
          fs.unlinkSync(actualOutputPathFinal);
        } catch (err) {
          console.error(`[${new Date().toISOString()}] Error deleting large file:`, err);
        }
        continue;
      }

      console.log(`[${new Date().toISOString()}] Sending media to user (${sentCount + 1}/${downloadedFiles.length})...`);

      // Send media file based on type; use 5 min for carousels or large files to reduce timeouts
      const uploadTimeout = (downloadedFiles.length > 1 || fileSizeInMB > 5) ? 300000 : 180000;

      try {
        if (actualIsImage) {
          await safeTelegramCall(
            ctx.telegram.sendPhoto.bind(ctx.telegram),
            uploadTimeout,
            ctx.chat.id,
            { source: actualOutputPathFinal },
            {
              reply_to_message_id: sentCount === 0 ? ctx.message.message_id : undefined // Only reply to original message for first item
            }
          );
          console.log(`[${new Date().toISOString()}] Image ${sentCount + 1} sent successfully`);
        } else {
          await safeTelegramCall(
            ctx.telegram.sendVideo.bind(ctx.telegram),
            uploadTimeout,
            ctx.chat.id,
            { source: actualOutputPathFinal },
            {
              reply_to_message_id: sentCount === 0 ? ctx.message.message_id : undefined
            }
          );
          console.log(`[${new Date().toISOString()}] Video ${sentCount + 1} sent successfully`);
        }
        sentCount++;
      } catch (sendError) {
        console.error(`[${new Date().toISOString()}] Error sending file ${sentCount + 1}:`, sendError.message);
      }

      // Clean up temporary file after sending
      try {
        fs.unlinkSync(actualOutputPathFinal);
        console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPathFinal}`);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
      }
    }

    // Delete processing message
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    // Show success message
    if (sentCount > 0) {
      const mediaType = isCarousel ? `${sentCount} item(s)` : (downloadedFiles[0].match(/\.(jpg|jpeg|png|webp)$/i) ? 'Image' : 'Video');
      await safeReply(ctx, `✅ ${mediaType} downloaded successfully!\n\nSend another Instagram link to download more.`);
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media. All files were too large or failed to download.');
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading media:`);
    console.error(`[${new Date().toISOString()}] Error type:`, error.constructor.name);
    console.error(`[${new Date().toISOString()}] Error message:`, error.message);
    console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);

    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }

    // Try to delete processing message
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.'
        );
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error editing message:`, err);
        await safeReply(ctx, 'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media. Please check if the link is valid and the content is public.');
    }
  }
}

// Helper function to download TikTok videos
async function downloadTikTokVideo(ctx, tiktokUrl) {
  console.log(`[${new Date().toISOString()}] Downloading TikTok video from: ${tiktokUrl}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading TikTok video... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `tiktok_${timestamp}.mp4`);

    const ytDlpArgs = [
      tiktokUrl,
      '-o', outputPath,
      '--no-playlist',
      '--merge-output-format', 'mp4',
      '--socket-timeout', '90',
      '--retries', '10',
      '--extractor-retries', '5',
      '--retry-sleep', '2',
      '--legacy-server-connect',
      ...(tiktokImpersonateAvailable ? ['--impersonate', 'chrome'] : []),
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    console.log(`[${new Date().toISOString()}] Running yt-dlp for TikTok with args:`, ytDlpArgs);

    await ytDlpWrap.execPromise(ytDlpArgs);

    // Find the downloaded file
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`tiktok_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('TikTok video file was not downloaded');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] TikTok video downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
          await safeTelegramCall(
            ctx.telegram.editMessageText.bind(ctx.telegram),
            300000,
            ctx.chat.id,
            processingMsg.message_id,
            null,
            'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
          );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending TikTok video to user...`);
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000;

    await safeTelegramCall(
      ctx.telegram.sendVideo.bind(ctx.telegram),
      uploadTimeout,
      ctx.chat.id,
      { source: actualOutputPath },
      {
        reply_to_message_id: ctx.message.message_id
      }
    );

    console.log(`[${new Date().toISOString()}] TikTok video sent successfully`);

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    await safeReply(ctx, `✅ TikTok video downloaded successfully!\n\nSend another link to download more.`);

    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading TikTok video:`, error);
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    // yt-dlp-wrap puts stderr in error.message, not error.stderr; our spawn puts it in error.stderr
    const errTextRaw = (error.stderr || error.message || '').toLowerCase();
    const isOpenSSLInvalid = (errTextRaw.includes('invalid library') && errTextRaw.includes('openssl_internal')) || /error:00000000:invalid library/.test(errTextRaw);
    const isImpersonation = errTextRaw.includes('impersonat') || errTextRaw.includes('impersonate');
    const isConnection = errTextRaw.includes('connection') || errTextRaw.includes('timed out') || errTextRaw.includes('reset') || errTextRaw.includes('forcibly closed') || errTextRaw.includes('ssl') || errTextRaw.includes('unexpected_eof') || errTextRaw.includes('eof occurred');
    let errText = 'Sorry, I couldn\'t download the TikTok video. Please check if the link is valid and the content is public.';
    if (isOpenSSLInvalid) {
      errText = 'Sorry, I couldn\'t download the TikTok video.\n\nThis is a **curl_cffi/OpenSSL bug on Windows**. Try:\n\n';
      errText += '1. **Send /tiktoksetup** — installs Python+curl_cffi and switches to it (best fix).\n\n';
      errText += '2. **Or /tiktokcursor** — I\'ll show you Cursor terminal commands to run the same fix.\n\n';
      errText += '3. **Or /tiktokfix** — download standalone yt-dlp.exe to rvbot/bin (if /tiktoksetup didn\'t help).\n\n';
      errText += '4. **Or** download yt-dlp.exe from https://github.com/yt-dlp/yt-dlp/releases and put it in `rvbot/bin`.';
    } else if (isImpersonation || isConnection) {
      errText += '\n\n💡 To fix TikTok downloads:\n';
      errText += '1. Send /tiktoksetup in this chat (installs curl_cffi), then restart the bot\n';
      errText += '2. Or /tiktokcursor for Cursor terminal commands\n';
      errText += '3. Or run in a terminal: pip install "yt-dlp[default,curl-cffi]" and restart';
    }
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000,
          ctx.chat.id,
          processingMsg.message_id,
          null,
          errText
        );
      } catch (err) {
        await safeReply(ctx, errText);
      }
    } else {
      await safeReply(ctx, errText);
    }
  }
}

// Helper function to download generic media from any URL
async function downloadGenericMedia(ctx, url) {
  console.log(`[${new Date().toISOString()}] Downloading generic media from: ${url}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `generic_media_${timestamp}.%(ext)s`);

    const ytDlpArgs = [
      url,
      '-o', outputPath,
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    console.log(`[${new Date().toISOString()}] Running yt-dlp for generic URL with args:`, ytDlpArgs);

    await ytDlpWrap.execPromise(ytDlpArgs);

    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`generic_media_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('Media file was not downloaded for generic URL');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] Generic file downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
        );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending generic media to user...`);
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small

    const fileExtension = path.extname(actualOutputPath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendPhoto.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp4', '.webm', '.mkv', '.avi'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp3', '.ogg', '.wav', '.flac'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      // Fallback to document for unknown types
      await safeTelegramCall(
        ctx.telegram.sendDocument.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    await safeReply(ctx, `✅ Media downloaded successfully!\n\nSend another link to download more.`);

    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading generic media:`, error);
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.'
        );
      } catch (err) {
        await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
    }
  }
}


// Helper function to get YouTube formats and show them as buttons with Rich UI
async function showYouTubeFormats(ctx, youtubeUrl) {
  console.log(`[${new Date().toISOString()}] Getting YouTube formats for: ${youtubeUrl}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Getting video info... Please wait.');
  } catch (error) {
    processingMsg = null;
  }

  try {
    const youtubeCookiesPath = path.join(__dirname, 'youtube_cookies.txt');
    const hasCookies = fs.existsSync(youtubeCookiesPath);

    // Validate cookies file if it exists
    if (hasCookies) {
      try {
        const cookieStats = fs.statSync(youtubeCookiesPath);
        const cookieContent = fs.readFileSync(youtubeCookiesPath, 'utf8');
        const lines = cookieContent.split('\n');
        const cookieCount = lines.filter(line => 
          line.trim() && !line.trim().startsWith('#')
        ).length;
        
        if (cookieStats.size < 10000 || cookieCount < 50) {
          console.warn(`[${new Date().toISOString()}] ⚠️ Warning: YouTube cookies file may be incomplete (${(cookieStats.size / 1024).toFixed(2)} KB, ${cookieCount} cookies). This may cause format detection to fail.`);
        }
      } catch (e) {
        // Ignore validation errors
      }
    }

    // Get full video info AND formats in one go using JSON output
    const infoArgs = [
      youtubeUrl,
      '--dump-json', // Get all info as JSON
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--remote-components', 'ejs:github' // Enable challenge solver scripts for YouTube
    ];

    // Client selection based on cookies availability
    // When cookies are present, use web client (default) which supports cookies
    // When no cookies, use Android client to bypass bot detection
    if (hasCookies) {
      // Use default web client (don't specify client) - it supports cookies
      infoArgs.push('--cookies', youtubeCookiesPath);
    } else {
      // No cookies - use Android client to bypass bot detection
      infoArgs.push('--extractor-args', 'youtube:player_client=android');
    }

    console.log(`[${new Date().toISOString()}] Running yt-dlp to get video info...`);

    // Try to get video info with retry logic - fallback to Android client if web client fails
    let output;
    let infoSucceeded = false;
    let lastInfoError;

    try {
      // First attempt: Use configured client (web with cookies or Android without)
      output = await Promise.race([
        ytDlpWrap.execPromise(infoArgs),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 60000))
      ]);
      infoSucceeded = true;
    } catch (error) {
      lastInfoError = error;
      const errorMessage = error.message || '';
      const errorStderr = error.stderr || '';
      const isChallengeError = errorMessage.includes('challenge solving failed') || 
                                errorStderr.includes('challenge solving failed') ||
                                errorMessage.includes('Requested format is not available') ||
                                errorStderr.includes('Requested format is not available');

      // If challenge error and we're using cookies, try fallback to Android client
      if (isChallengeError && hasCookies) {
        console.log(`[${new Date().toISOString()}] Challenge error in format detection. Retrying with Android client (without cookies)...`);
        
        // Create new args with Android client (remove cookies, add Android client)
        const fallbackInfoArgs = infoArgs.filter(arg => arg !== '--cookies' && arg !== youtubeCookiesPath);
        // Find where to insert Android client args (before --dump-json)
        const dumpJsonIndex = fallbackInfoArgs.indexOf('--dump-json');
        if (dumpJsonIndex !== -1) {
          fallbackInfoArgs.splice(dumpJsonIndex, 0, '--extractor-args', 'youtube:player_client=android');
        } else {
          fallbackInfoArgs.push('--extractor-args', 'youtube:player_client=android');
        }

        try {
          console.log(`[${new Date().toISOString()}] Retrying format detection with Android client`);
          output = await Promise.race([
            ytDlpWrap.execPromise(fallbackInfoArgs),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 60000))
          ]);
          infoSucceeded = true;
          console.log(`[${new Date().toISOString()}] Fallback format detection succeeded with Android client`);
        } catch (fallbackError) {
          lastInfoError = fallbackError;
          console.error(`[${new Date().toISOString()}] Fallback format detection also failed:`, fallbackError.message);
        }
      }

      // If still failed, throw the error
      if (!infoSucceeded) {
        throw lastInfoError;
      }
    }

    const videoInfo = JSON.parse(output);
    const videoTitle = videoInfo.title || 'YouTube Video';
    const channelName = videoInfo.uploader || 'Unknown Channel';
    const thumbnail = videoInfo.thumbnail || '';
    const duration = videoInfo.duration_string || '??:??';

    // Process formats to find sizes
    // We want to map: Quality -> {size, format_id}
    const formatMap = new Map(); // quality -> {size, format_id}
    const allFormats = videoInfo.formats || [];

    // Helper to format bytes
    const formatBytes = (bytes) => {
      if (!bytes) return 'Unknown';
      const mb = bytes / (1024 * 1024);
      return `${mb.toFixed(1)}MB`;
    };

    // qualities we care about
    // Dynamic scan: Find all unique video qualities available
    // We want to group by "effective quality label" (e.g. 1080p, 720p)
    // and pick the best candidate for that quality.

    const qualityMap = new Map(); // label (e.g. "720p") -> { format object, height }

    for (const f of allFormats) {
      // Skip audio-only or invalid formats
      if (!f.height || f.vcodec === 'none') continue;

      const effectiveHeight = f.height;
      const qualityLabel = `${effectiveHeight}p`;

      // We prefer formats with filesize info
      const existing = qualityMap.get(qualityLabel);
      const hasSize = !!(f.filesize || f.filesize_approx);

      if (!existing) {
        qualityMap.set(qualityLabel, { format: f, height: effectiveHeight, hasSize });
      } else {
        // Update if this new one is "better" (has size info when old one didn't)
        if (!existing.hasSize && hasSize) {
          qualityMap.set(qualityLabel, { format: f, height: effectiveHeight, hasSize });
        }
      }
    }

    // Convert map to array and sort descending by height
    const sortedQualities = Array.from(qualityMap.values())
      .sort((a, b) => b.height - a.height);

    const displayFormats = [];

    for (const item of sortedQualities) {
      const quality = `${item.height}p`;
      const f = item.format;

      let sizeStr = 'Unknown';
      let size = f.filesize || f.filesize_approx;

      if (size) {
        if (f.acodec === 'none') {
          size = size * 1.1; // Add overhead estimate
        }
        sizeStr = formatBytes(size);
      }

      displayFormats.push({
        quality: quality,
        size: sizeStr,
        id: `bestvideo[height<=${item.height}]+bestaudio/best[height<=${item.height}]`
      });

      // Limit to top 6 distinct qualities to avoid clutter
      if (displayFormats.length >= 6) break;
    }

    // Fallback if no video formats found (shouldn't happen for valid video)
    if (displayFormats.length === 0) {
      displayFormats.push({ quality: 'Best', size: 'Unknown', id: 'best' });
    }// Construct Caption
    let caption = `📺 <b>${videoTitle}</b>\n`;
    caption += `👤 ${channelName}\n`;
    caption += `⏱ ${duration}\n\n`;
    caption += `<b>Available Formats:</b>\n`;

    const buttons = [];
    let currentRow = [];

    displayFormats.forEach((f) => {
      const icon = parseInt(f.quality) >= 720 ? '⚡' : '📹';
      caption += `${icon} <b>${f.quality}</b>: ${f.size}\n`;

      // Add button
      currentRow.push(Markup.button.text(`${icon} ${f.quality}`));
      if (currentRow.length === 2) {
        buttons.push(currentRow);
        currentRow = [];
      }
    });

    if (currentRow.length > 0) buttons.push(currentRow);

    // Add Audio Option
    caption += `\n🎧 <b>Audio (MP3)</b>: Available`;
    buttons.push([Markup.button.text('🎧 Audio Only (MP3)')]);

    // Add Thumbnail Option (PNG)
    caption += `\n🖼️ <b>Thumbnail (PNG)</b>: Available`;
    buttons.push([Markup.button.text('🖼️ Thumbnail (PNG)')]);

    // Store user state
    const formatMapping = {};
    displayFormats.forEach(f => {
      formatMapping[`${parseInt(f.quality) >= 720 ? '⚡' : '📹'} ${f.quality}`] = f.id;
    });
    formatMapping['🎧 Audio Only (MP3)'] = 'audio_mp3';
    formatMapping['🖼️ Thumbnail (PNG)'] = 'thumbnail_png';

    userStates.set(ctx.from.id, {
      type: 'youtube_format_selection',
      url: youtubeUrl,
      formats: formatMapping,
      title: videoTitle
    });

    // Delete processing message
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (e) { }

    // Send Photo with Caption and Buttons
    // Use channel logo if video thumb fails? just use thumb.
    if (thumbnail) {
      await ctx.replyWithPhoto(thumbnail, {
        caption: caption,
        parse_mode: 'HTML',
        ...Markup.keyboard(buttons).resize().oneTime()
      });
    } else {
      await ctx.reply(caption, {
        parse_mode: 'HTML',
        ...Markup.keyboard(buttons).resize().oneTime()
      });
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting YouTube formats:`, error);

    // Check if it's a bot detection error or DPAPI error
    const errorMessage = error.message || '';
    const errorStderr = error.stderr || '';
    const isBotDetection = errorMessage.includes('Sign in to confirm') ||
      errorMessage.includes('not a bot') ||
      errorStderr.includes('Sign in to confirm') ||
      errorStderr.includes('not a bot');
    const isDPAPIError = errorMessage.includes('Failed to decrypt with DPAPI') ||
      errorStderr.includes('Failed to decrypt with DPAPI');

    let errorMsg = 'Sorry, I couldn\'t get the available formats. ';
    if (isDPAPIError) {
      errorMsg += '❌ Cookie decryption failed. Please export YouTube cookies manually:\n\n';
      errorMsg += '1. Install browser extension: "Get cookies.txt LOCALLY"\n';
      errorMsg += '2. Go to youtube.com and export cookies\n';
      errorMsg += '3. Save as "youtube_cookies.txt" in the bot folder\n\n';
      errorMsg += 'Or try downloading without format selection.';
    } else if (isBotDetection) {
      errorMsg += '❌ YouTube is blocking requests.\n\n';
      
      // Check cookies file if it exists
      const youtubeCookiesPath = path.join(__dirname, 'youtube_cookies.txt');
      if (fs.existsSync(youtubeCookiesPath)) {
        try {
          const cookieStats = fs.statSync(youtubeCookiesPath);
          const cookieSizeKB = (cookieStats.size / 1024).toFixed(2);
          const cookieContent = fs.readFileSync(youtubeCookiesPath, 'utf8');
          const lines = cookieContent.split('\n');
          const cookieCount = lines.filter(line => 
            line.trim() && !line.trim().startsWith('#')
          ).length;
          
          if (cookieStats.size < 10000 || cookieCount < 50) {
            errorMsg += `⚠️ Your cookies file is too small (${cookieSizeKB} KB, ${cookieCount} cookies).\n`;
            errorMsg += 'A proper cookies file should be 100+ KB with 100+ cookies.\n\n';
          }
        } catch (e) {
          // Ignore
        }
      }
      
      errorMsg += '📋 Please re-export your YouTube cookies:\n';
      errorMsg += '1. Make sure you\'re logged into YouTube\n';
      errorMsg += '2. Use the browser extension to export ALL cookies\n';
      errorMsg += '3. The file should be 100+ KB (not just a few KB)\n';
      errorMsg += '4. Replace the youtube_cookies.txt file\n';
      errorMsg += '5. Try again\n\n';
      errorMsg += 'Or try downloading without format selection.';
    } else {
      errorMsg += 'Please check if the link is valid.';
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          errorMsg
        );
      } catch (err) {
        await safeReply(ctx, errorMsg);
      }
    } else {
      await safeReply(ctx, errorMsg);
    }

    // If bot detection, try direct download as fallback
    if (isBotDetection) {
      console.log(`[${new Date().toISOString()}] YouTube bot detection detected, attempting direct download...`);
      try {
        await downloadYouTubeVideo(ctx, 'best', youtubeUrl, 'YouTube Video');
      } catch (downloadError) {
        console.error(`[${new Date().toISOString()}] Direct download also failed:`, downloadError.message);
      }
    }
  }
}

// Helper function to download YouTube video with selected format
async function downloadYouTubeVideo(ctx, formatId, youtubeUrl, videoTitle) {
  console.log(`[${new Date().toISOString()}] Downloading YouTube video with format: ${formatId}`);

  const processingMsg = await ctx.reply('Downloading video... Please wait.');

  // Check for YouTube cookies (declare outside try block so it's accessible in catch)
  const youtubeCookiesPath = path.join(__dirname, 'youtube_cookies.txt');
  const hasCookies = fs.existsSync(youtubeCookiesPath);
  
  // Validate cookies file if it exists
  let cookieValidation = { valid: true, size: 0, lineCount: 0, message: '' };
  if (hasCookies) {
    try {
      const cookieStats = fs.statSync(youtubeCookiesPath);
      cookieValidation.size = cookieStats.size;
      
      // Count non-comment lines (actual cookies)
      const cookieContent = fs.readFileSync(youtubeCookiesPath, 'utf8');
      const lines = cookieContent.split('\n');
      cookieValidation.lineCount = lines.filter(line => 
        line.trim() && !line.trim().startsWith('#')
      ).length;
      
      // Check if file is too small or has too few cookies
      if (cookieStats.size < 10000) { // Less than 10KB is suspicious
        cookieValidation.valid = false;
        cookieValidation.message = `Cookies file is very small (${(cookieStats.size / 1024).toFixed(2)} KB, ${cookieValidation.lineCount} cookies). A proper cookies file should be 100+ KB with hundreds of cookies.`;
        console.warn(`[${new Date().toISOString()}] ⚠️ Warning: ${cookieValidation.message}`);
      } else if (cookieValidation.lineCount < 50) {
        cookieValidation.valid = false;
        cookieValidation.message = `Cookies file has too few cookies (${cookieValidation.lineCount} cookies). A proper cookies file should have 100+ cookies.`;
        console.warn(`[${new Date().toISOString()}] ⚠️ Warning: ${cookieValidation.message}`);
      } else if (cookieStats.size < 50000) {
        // Between 10KB and 50KB - might work but not ideal
        cookieValidation.message = `Cookies file is smaller than ideal (${(cookieStats.size / 1024).toFixed(2)} KB). For best results, export a complete cookies file (100+ KB).`;
        console.warn(`[${new Date().toISOString()}] ⚠️ Warning: ${cookieValidation.message}`);
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Error validating cookies file:`, e.message);
    }
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `youtube_${timestamp}.mp4`);

    // Use better format selector - if formatId is 'best', don't specify format and let yt-dlp auto-select
    const ytDlpArgs = [
      youtubeUrl,
      '-o', outputPath,
      '--no-playlist',
      '--no-mtime', // Don't set file modification time (avoids some FFmpeg issues)
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--remote-components', 'ejs:github' // Enable challenge solver scripts for YouTube
    ];

    // Client selection based on cookies availability
    // When cookies are present, use web client (default) which supports cookies
    // When no cookies, use Android client to bypass bot detection
    if (hasCookies) {
      // Use default web client (don't specify client) - it supports cookies
      ytDlpArgs.push('--cookies', youtubeCookiesPath);
      console.log(`[${new Date().toISOString()}] Using YouTube cookies file with web client: ${youtubeCookiesPath}`);
    } else {
      // No cookies - use Android client to bypass bot detection
      ytDlpArgs.push('--extractor-args', 'youtube:player_client=android');
      console.log(`[${new Date().toISOString()}] No YouTube cookies file found. Using Android client. YouTube may block requests.`);
    }

    // Thumbnail/Photo Logic (PNG format)
    if (formatId === 'thumbnail_png') {
      console.log(`[${new Date().toISOString()}] Thumbnail mode: ${videoTitle}`);
      
      // Get thumbnail URL from video info
      try {
        const infoArgs = [
          youtubeUrl,
          '--dump-json',
          '--no-playlist',
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--remote-components', 'ejs:github'
        ];
        
        if (hasCookies) {
          infoArgs.push('--cookies', youtubeCookiesPath);
        } else {
          infoArgs.push('--extractor-args', 'youtube:player_client=android');
        }
        
        const infoOutput = await ytDlpWrap.execPromise(infoArgs);
        const videoInfo = JSON.parse(infoOutput);
        const thumbnailUrl = videoInfo.thumbnail || (videoInfo.thumbnails && videoInfo.thumbnails.length > 0 ? videoInfo.thumbnails[videoInfo.thumbnails.length - 1].url : null);
        
        if (thumbnailUrl) {
          // Download thumbnail directly as PNG
          const https = require('https');
          const http = require('http');
          const urlModule = require('url');
          
          const thumbnailPath = outputPath.replace('.mp4', '.png');
          const parsedUrl = urlModule.parse(thumbnailUrl);
          const client = parsedUrl.protocol === 'https:' ? https : http;
          
          await new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(thumbnailPath);
            client.get(thumbnailUrl, (response) => {
              if (response.statusCode === 200) {
                response.pipe(fileStream);
                fileStream.on('finish', async () => {
                  fileStream.close();
                  console.log(`[${new Date().toISOString()}] Thumbnail downloaded: ${thumbnailPath}`);
                  
                  // Send thumbnail
                  const stats = fs.statSync(thumbnailPath);
                  const fileSizeInMB = stats.size / (1024 * 1024);
                  
                  if (fileSizeInMB > 50) {
                    fs.unlinkSync(thumbnailPath);
                    await safeTelegramCall(
                      ctx.telegram.editMessageText.bind(ctx.telegram),
                      300000,
                      ctx.chat.id,
                      processingMsg.message_id,
                      null,
                      'Thumbnail is too large (over 50MB).'
                    );
                    return;
                  }
                  
                  await safeTelegramCall(
                    ctx.telegram.sendPhoto.bind(ctx.telegram),
                    180000,
                    ctx.chat.id,
                    { source: thumbnailPath },
                    {
                      caption: `🖼️ ${videoTitle}`,
                      reply_to_message_id: ctx.message.message_id
                    }
                  );
                  
                  await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id);
                  await safeReply(ctx, `✅ Thumbnail downloaded successfully!\n\nSend another link to download more.`);
                  
                  try {
                    fs.unlinkSync(thumbnailPath);
                  } catch (err) {
                    console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
                  }
                  
                  userStates.delete(ctx.from.id);
                  resolve();
                });
              } else {
                reject(new Error(`Failed to download thumbnail: ${response.statusCode}`));
              }
            }).on('error', reject);
          });
          return; // Exit function after thumbnail download
        } else {
          throw new Error('Thumbnail URL not found');
        }
      } catch (thumbError) {
        console.error(`[${new Date().toISOString()}] Error downloading thumbnail:`, thumbError);
        throw thumbError;
      }
    }
    // Audio Only Logic
    else if (formatId === 'audio_mp3') {
      console.log(`[${new Date().toISOString()}] Audio mode: ${videoTitle}`);
      // Change extension to .mp3
      ytDlpArgs[2] = outputPath.replace('.mp4', '.%(ext)s');

      // Remove merge-output-format if it was added (it's not yet, but good to be explicit)
      // For audio, we don't want --merge-output-format mp4
      // The original code had it here: '--merge-output-format', 'mp4',
      // So we need to ensure it's not present for audio.
      // The current ytDlpArgs construction doesn't add it until later, so no removal needed here.

      // Add extract audio args
      ytDlpArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      // Video mode
      // Add format selector (if not 'best')
      if (formatId && formatId !== 'best') {
        ytDlpArgs.splice(1, 0, '-f', formatId);
      } else if (formatId === 'best') {
        // For 'best', ensure we get video with audio
        ytDlpArgs.splice(1, 0, '-f', 'bestvideo+bestaudio/best[acodec!=none]/best');
      }
      // Force MP4 container for better phone compatibility for video
      ytDlpArgs.push('--merge-output-format', 'mp4');
    }

    console.log(`[${new Date().toISOString()}] Running yt-dlp with args:`, ytDlpArgs);

    // Try download with retry logic - fallback to Android client if web client fails
    let stdout;
    let downloadSucceeded = false;
    let lastError;

    try {
      // First attempt: Use configured client (web with cookies or Android without)
      stdout = await Promise.race([
        ytDlpWrap.execPromise(ytDlpArgs),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
        )
      ]);
      downloadSucceeded = true;
      console.log(`[${new Date().toISOString()}] yt-dlp stdout:`, stdout);
    } catch (error) {
      lastError = error;
      const errorMessage = error.message || '';
      const errorStderr = error.stderr || '';
      const isChallengeError = errorMessage.includes('challenge solving failed') || 
                                errorStderr.includes('challenge solving failed') ||
                                errorMessage.includes('The downloaded file is empty') ||
                                errorStderr.includes('The downloaded file is empty');
      const isPostProcessingError = errorMessage.includes('Postprocessing') ||
                                     errorStderr.includes('Postprocessing') ||
                                     errorMessage.includes('Could not write header') ||
                                     errorStderr.includes('Could not write header') ||
                                     errorMessage.includes('could not find codec parameters') ||
                                     errorStderr.includes('could not find codec parameters');

      // If post-processing error, try with re-encoding (slower but more compatible)
      if (isPostProcessingError && formatId !== 'audio_mp3') {
        console.log(`[${new Date().toISOString()}] Post-processing error detected. Retrying with alternative strategies...`);
        
        // Check if it's a low quality format that often has codec issues
        const heightMatch = formatId && formatId.includes('height<=') ? formatId.match(/height<=(\d+)/) : null;
        const height = heightMatch ? parseInt(heightMatch[1]) : null;
        const isLowQuality = height && height <= 240;
        
        // Strategy 1: For low quality, skip re-encoding and try higher quality formats directly
        if (isLowQuality) {
          console.log(`[${new Date().toISOString()}] Low quality format (${height}p) detected. Trying higher quality formats...`);
          
          // Try 360p first with FFmpeg copy codecs (no re-encoding - faster and more compatible)
          const higherQualityArgs = [
            youtubeUrl,
            '-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]',
            '-o', outputPath,
            '--no-playlist',
            '--no-mtime',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--remote-components', 'ejs:github',
            '--merge-output-format', 'mp4',
            '--postprocessor-args', 'ffmpeg:-c copy' // Use copy codecs (no re-encoding)
          ];
          
          if (hasCookies) {
            higherQualityArgs.push('--cookies', youtubeCookiesPath);
          } else {
            higherQualityArgs.push('--extractor-args', 'youtube:player_client=android');
          }
          
          try {
            console.log(`[${new Date().toISOString()}] Retry 1: Trying 360p format with copy codecs (no re-encoding)...`);
            stdout = await ytDlpWrap.execPromise(higherQualityArgs);
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Download succeeded with 360p format`);
          } catch (higherError) {
            console.error(`[${new Date().toISOString()}] 360p format failed:`, higherError.message);
            
            // Try auto-select format with audio requirement (let yt-dlp choose and merge automatically)
            console.log(`[${new Date().toISOString()}] Retry 2: Using auto-select format with audio (let yt-dlp choose and merge)...`);
            const autoFormatArgs = [
              youtubeUrl,
              '-f', 'bestvideo+bestaudio/best[acodec!=none]/best', // Ensure audio is included
              '-o', outputPath,
              '--no-playlist',
              '--no-mtime',
              '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              '--remote-components', 'ejs:github',
              '--merge-output-format', 'mp4'
            ];
            
            if (hasCookies) {
              autoFormatArgs.push('--cookies', youtubeCookiesPath);
            } else {
              autoFormatArgs.push('--extractor-args', 'youtube:player_client=android');
            }
            
            try {
              stdout = await ytDlpWrap.execPromise(autoFormatArgs);
              downloadSucceeded = true;
              console.log(`[${new Date().toISOString()}] Download succeeded with auto-select format`);
            } catch (autoError) {
              console.error(`[${new Date().toISOString()}] Auto-select format also failed:`, autoError.message);
              
              // Strategy 3: Try without forcing MP4 merge (let yt-dlp use default container)
              console.log(`[${new Date().toISOString()}] Retry 3: Trying without forcing MP4 container...`);
              const noMergeArgs = [
                youtubeUrl,
                '-o', outputPath.replace('.mp4', '.%(ext)s'), // Let yt-dlp choose extension
                '--no-playlist',
                '--no-mtime',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--remote-components', 'ejs:github'
              ];
              
              if (hasCookies) {
                noMergeArgs.push('--cookies', youtubeCookiesPath);
              } else {
                noMergeArgs.push('--extractor-args', 'youtube:player_client=android');
              }
              
              // No --merge-output-format - let yt-dlp use whatever works
              
              try {
                stdout = await ytDlpWrap.execPromise(noMergeArgs);
                downloadSucceeded = true;
                console.log(`[${new Date().toISOString()}] Download succeeded without forcing MP4`);
              } catch (noMergeError) {
                console.error(`[${new Date().toISOString()}] No-merge format also failed:`, noMergeError.message);
                
                // Strategy 4: Try using a pre-merged format with audio (no post-processing needed)
                console.log(`[${new Date().toISOString()}] Retry 4: Trying pre-merged format with audio (no FFmpeg post-processing)...`);
                const preMergedArgs = [
                  youtubeUrl,
                  '-f', 'best[ext=mp4][acodec!=none]/best[height<=480][acodec!=none]/best[ext=mp4]/best[height<=480]', // Pre-merged MP4 with audio, or best quality up to 480p with audio
                  '-o', outputPath,
                  '--no-playlist',
                  '--no-mtime',
                  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  '--remote-components', 'ejs:github'
                ];
                
                if (hasCookies) {
                  preMergedArgs.push('--cookies', youtubeCookiesPath);
                } else {
                  preMergedArgs.push('--extractor-args', 'youtube:player_client=android');
                }
                
                // No --merge-output-format - we want pre-merged formats only
                
                try {
                  stdout = await ytDlpWrap.execPromise(preMergedArgs);
                  downloadSucceeded = true;
                  console.log(`[${new Date().toISOString()}] Download succeeded with pre-merged format`);
                } catch (preMergedError) {
                  console.error(`[${new Date().toISOString()}] Pre-merged format also failed:`, preMergedError.message);
                  
                  // Strategy 5: Try single-stream format with audio (worst quality, no merging)
                  console.log(`[${new Date().toISOString()}] Retry 5: Trying single-stream format with audio (worst quality, no merging)...`);
                  const singleStreamArgs = [
                    youtubeUrl,
                    '-f', 'worst[acodec!=none]/worst', // Single stream with audio, no merging needed
                    '-o', outputPath.replace('.mp4', '.%(ext)s'),
                    '--no-playlist',
                    '--no-mtime',
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--remote-components', 'ejs:github'
                  ];
                  
                  if (hasCookies) {
                    singleStreamArgs.push('--cookies', youtubeCookiesPath);
                  } else {
                    singleStreamArgs.push('--extractor-args', 'youtube:player_client=android');
                  }
                  
                  try {
                    stdout = await ytDlpWrap.execPromise(singleStreamArgs);
                    downloadSucceeded = true;
                    console.log(`[${new Date().toISOString()}] Download succeeded with single-stream format`);
                  } catch (singleError) {
                    console.error(`[${new Date().toISOString()}] Single-stream format also failed:`, singleError.message);
                    lastError = singleError;
                  }
                }
              }
            }
          }
        } else {
          // For higher quality formats, try re-encoding first
          const recodeArgs = [...ytDlpArgs];
          const mergeIndex = recodeArgs.indexOf('--merge-output-format');
          if (mergeIndex !== -1) {
            recodeArgs.splice(mergeIndex, 2);
          }
          recodeArgs.push('--recode-video', 'mp4');
          
          try {
            console.log(`[${new Date().toISOString()}] Retry 1: Using video re-encoding...`);
            stdout = await ytDlpWrap.execPromise(recodeArgs);
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Download succeeded with video re-encoding`);
          } catch (recodeError) {
            console.error(`[${new Date().toISOString()}] Re-encoding failed:`, recodeError.message);
            
            // Try auto-select format with audio requirement (let yt-dlp choose and merge automatically)
            console.log(`[${new Date().toISOString()}] Retry 2: Using auto-select format with audio (let yt-dlp choose and merge)...`);
            const autoFormatArgs = [
              youtubeUrl,
              '-f', 'bestvideo+bestaudio/best[acodec!=none]/best', // Ensure audio is included
              '-o', outputPath,
              '--no-playlist',
              '--no-mtime',
              '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              '--remote-components', 'ejs:github',
              '--merge-output-format', 'mp4'
            ];
            
            if (hasCookies) {
              autoFormatArgs.push('--cookies', youtubeCookiesPath);
            } else {
              autoFormatArgs.push('--extractor-args', 'youtube:player_client=android');
            }
            
            try {
              stdout = await ytDlpWrap.execPromise(autoFormatArgs);
              downloadSucceeded = true;
              console.log(`[${new Date().toISOString()}] Download succeeded with auto-select format`);
            } catch (autoError) {
              console.error(`[${new Date().toISOString()}] Auto-select format also failed:`, autoError.message);
              
              // Strategy 3: Try without forcing MP4 merge (let yt-dlp use default container)
              console.log(`[${new Date().toISOString()}] Retry 3: Trying without forcing MP4 container...`);
              const noMergeArgs = [
                youtubeUrl,
                '-o', outputPath.replace('.mp4', '.%(ext)s'), // Let yt-dlp choose extension
                '--no-playlist',
                '--no-mtime',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--remote-components', 'ejs:github'
              ];
              
              if (hasCookies) {
                noMergeArgs.push('--cookies', youtubeCookiesPath);
              } else {
                noMergeArgs.push('--extractor-args', 'youtube:player_client=android');
              }
              
              // No --merge-output-format - let yt-dlp use whatever works
              
              try {
                stdout = await ytDlpWrap.execPromise(noMergeArgs);
                downloadSucceeded = true;
                console.log(`[${new Date().toISOString()}] Download succeeded without forcing MP4`);
              } catch (noMergeError) {
                console.error(`[${new Date().toISOString()}] No-merge format also failed:`, noMergeError.message);
                
                // Strategy 3: Try using a pre-merged format with audio (no post-processing needed)
                console.log(`[${new Date().toISOString()}] Retry 3: Trying pre-merged format with audio (no FFmpeg post-processing)...`);
                const preMergedArgs = [
                  youtubeUrl,
                  '-f', 'best[ext=mp4][acodec!=none]/best[height<=480][acodec!=none]/best[ext=mp4]/best[height<=480]', // Pre-merged MP4 with audio, or best quality up to 480p with audio
                  '-o', outputPath,
                  '--no-playlist',
                  '--no-mtime',
                  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  '--remote-components', 'ejs:github'
                ];
                
                if (hasCookies) {
                  preMergedArgs.push('--cookies', youtubeCookiesPath);
                } else {
                  preMergedArgs.push('--extractor-args', 'youtube:player_client=android');
                }
                
                try {
                  stdout = await ytDlpWrap.execPromise(preMergedArgs);
                  downloadSucceeded = true;
                  console.log(`[${new Date().toISOString()}] Download succeeded with pre-merged format`);
                } catch (preMergedError) {
                  console.error(`[${new Date().toISOString()}] Pre-merged format also failed:`, preMergedError.message);
                  
                  // Strategy 4: Try single-stream format with audio (worst quality, no merging)
                  console.log(`[${new Date().toISOString()}] Retry 4: Trying single-stream format with audio (worst quality, no merging)...`);
                  const singleStreamArgs = [
                    youtubeUrl,
                    '-f', 'worst[acodec!=none]/worst', // Single stream with audio, no merging needed
                    '-o', outputPath.replace('.mp4', '.%(ext)s'),
                    '--no-playlist',
                    '--no-mtime',
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--remote-components', 'ejs:github'
                  ];
                  
                  if (hasCookies) {
                    singleStreamArgs.push('--cookies', youtubeCookiesPath);
                  } else {
                    singleStreamArgs.push('--extractor-args', 'youtube:player_client=android');
                  }
                  
                  try {
                    stdout = await ytDlpWrap.execPromise(singleStreamArgs);
                    downloadSucceeded = true;
                    console.log(`[${new Date().toISOString()}] Download succeeded with single-stream format`);
                  } catch (singleError) {
                    console.error(`[${new Date().toISOString()}] Single-stream format also failed:`, singleError.message);
                    lastError = singleError;
                  }
                }
              }
            }
          }
        }
        
        // If still failed, check if any files were downloaded (even if merging failed)
        if (!downloadSucceeded) {
          console.log(`[${new Date().toISOString()}] Checking for partial downloads in temp directory...`);
          try {
            const files = fs.readdirSync(tempDir);
            const partialFiles = files.filter(file => file.startsWith(`youtube_${timestamp}.`));
            if (partialFiles.length > 0) {
              console.log(`[${new Date().toISOString()}] Found partial files:`, partialFiles);
              // Try to use the largest file (likely the merged one or main video)
              const fileStats = partialFiles.map(file => {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                return { file, path: filePath, size: stats.size };
              });
              fileStats.sort((a, b) => b.size - a.size);
              
              // If we have a file larger than 1MB, it might be usable
              const largestFile = fileStats[0];
              if (largestFile.size > 1024 * 1024) { // > 1MB
                console.log(`[${new Date().toISOString()}] Found usable partial file: ${largestFile.file} (${(largestFile.size / 1024 / 1024).toFixed(2)} MB)`);
                console.log(`[${new Date().toISOString()}] Using partial download as fallback - file will be found in file detection step`);
                downloadSucceeded = true;
                // Don't update outputPath - let the file finding logic handle it
              }
            }
          } catch (checkError) {
            console.error(`[${new Date().toISOString()}] Error checking for partial files:`, checkError.message);
          }
        }
        
        // If still failed, keep lastError for challenge error handling
        if (!downloadSucceeded && !lastError) {
          lastError = error;
        }
      }

      // If challenge error and we're using cookies, try multiple fallback strategies
      if (!downloadSucceeded && isChallengeError && hasCookies) {
        // Strategy 1: Try ios client WITHOUT cookies (ios doesn't support cookies, but often bypasses challenges)
        console.log(`[${new Date().toISOString()}] Challenge error detected. Retrying with ios client (without cookies - ios doesn't support cookies)...`);
        
        // Build clean args without cookies for ios client
        const fallbackArgs1 = [
          youtubeUrl,
          '-o', outputPath,
          '--no-playlist',
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--extractor-args', 'youtube:player_client=ios',
          '--remote-components', 'ejs:github' // Enable challenge solver scripts for YouTube
        ];
        // Add format selector and merge format
        if (formatId && formatId !== 'best' && formatId !== 'audio_mp3') {
          fallbackArgs1.splice(1, 0, '-f', formatId);
        }
        if (formatId === 'audio_mp3') {
          fallbackArgs1[1] = outputPath.replace('.mp4', '.%(ext)s');
          fallbackArgs1.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
          fallbackArgs1.push('--merge-output-format', 'mp4');
        }

        try {
          console.log(`[${new Date().toISOString()}] Retry attempt 1: ios client without cookies`);
          stdout = await Promise.race([
            ytDlpWrap.execPromise(fallbackArgs1),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
            )
          ]);
          downloadSucceeded = true;
          console.log(`[${new Date().toISOString()}] Fallback download succeeded with ios client (no cookies)`);
        } catch (fallbackError1) {
          console.error(`[${new Date().toISOString()}] Fallback 1 failed:`, fallbackError1.message);
          
          // Strategy 2: Try web_embedded client WITH cookies
          console.log(`[${new Date().toISOString()}] Retrying with web_embedded client (with cookies)...`);
          const fallbackArgs2 = [...ytDlpArgs]; // Copy original args (already has cookies)
          const userAgentIndex2 = fallbackArgs2.indexOf('--user-agent');
          if (userAgentIndex2 !== -1) {
            // Remove any existing client args
            const clientIndex = fallbackArgs2.indexOf('youtube:player_client=');
            if (clientIndex !== -1) {
              fallbackArgs2.splice(clientIndex - 1, 2); // Remove --extractor-args and value
            }
            fallbackArgs2.splice(userAgentIndex2 + 2, 0, '--extractor-args', 'youtube:player_client=web_embedded');
          } else {
            fallbackArgs2.push('--extractor-args', 'youtube:player_client=web_embedded');
          }

          try {
            console.log(`[${new Date().toISOString()}] Retry attempt 2: web_embedded client with cookies`);
            stdout = await Promise.race([
              ytDlpWrap.execPromise(fallbackArgs2),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
              )
            ]);
            downloadSucceeded = true;
            console.log(`[${new Date().toISOString()}] Fallback download succeeded with web_embedded client`);
          } catch (fallbackError2) {
            console.error(`[${new Date().toISOString()}] Fallback 2 failed:`, fallbackError2.message);
            
            // Strategy 3: Try mweb client WITH cookies
            console.log(`[${new Date().toISOString()}] Retrying with mweb client (with cookies)...`);
            const fallbackArgs3 = [...ytDlpArgs]; // Copy original args (already has cookies)
            const userAgentIndex3 = fallbackArgs3.indexOf('--user-agent');
            if (userAgentIndex3 !== -1) {
              // Remove any existing client args
              const clientIndex = fallbackArgs3.indexOf('youtube:player_client=');
              if (clientIndex !== -1) {
                fallbackArgs3.splice(clientIndex - 1, 2); // Remove --extractor-args and value
              }
              fallbackArgs3.splice(userAgentIndex3 + 2, 0, '--extractor-args', 'youtube:player_client=mweb');
            } else {
              fallbackArgs3.push('--extractor-args', 'youtube:player_client=mweb');
            }

            try {
              console.log(`[${new Date().toISOString()}] Retry attempt 3: mweb client with cookies`);
              stdout = await Promise.race([
                ytDlpWrap.execPromise(fallbackArgs3),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
                )
              ]);
              downloadSucceeded = true;
              console.log(`[${new Date().toISOString()}] Fallback download succeeded with mweb client`);
            } catch (fallbackError3) {
              console.error(`[${new Date().toISOString()}] Fallback 3 failed:`, fallbackError3.message);
              
              // Strategy 4: Try without format restrictions (just 'best') with web client
              console.log(`[${new Date().toISOString()}] Retrying without format restrictions (best quality)...`);
              // Build clean args without format selector
              const fallbackArgs4 = [
                youtubeUrl,
                '-o', outputPath,
                '--no-playlist',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--cookies', youtubeCookiesPath,
                '--remote-components', 'ejs:github' // Enable challenge solver scripts for YouTube
              ];
              // Add merge format for video (not for audio)
              if (formatId !== 'audio_mp3') {
                fallbackArgs4.push('--merge-output-format', 'mp4');
              } else {
                fallbackArgs4.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
              }

              try {
                console.log(`[${new Date().toISOString()}] Retry attempt 4: web client with 'best' format (no quality restrictions)`);
                stdout = await Promise.race([
                  ytDlpWrap.execPromise(fallbackArgs4),
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
                  )
                ]);
                downloadSucceeded = true;
                console.log(`[${new Date().toISOString()}] Fallback download succeeded with 'best' format`);
              } catch (fallbackError4) {
                console.error(`[${new Date().toISOString()}] Fallback 4 failed:`, fallbackError4.message);
                
                // Strategy 5: Last resort - Try Android client WITHOUT cookies (sometimes works when cookies fail)
                console.log(`[${new Date().toISOString()}] Last resort: Trying Android client without cookies...`);
                const fallbackArgs5 = [
                  youtubeUrl,
                  '-o', outputPath,
                  '--no-playlist',
                  '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  '--extractor-args', 'youtube:player_client=android',
                  '--remote-components', 'ejs:github' // Enable challenge solver scripts for YouTube
                ];
                // Add merge format for video (not for audio)
                if (formatId !== 'audio_mp3') {
                  fallbackArgs5.push('--merge-output-format', 'mp4');
                } else {
                  fallbackArgs5.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
                }

                try {
                  console.log(`[${new Date().toISOString()}] Retry attempt 5: Android client without cookies (last resort)`);
                  stdout = await Promise.race([
                    ytDlpWrap.execPromise(fallbackArgs5),
                    new Promise((_, reject) =>
                      setTimeout(() => reject(new Error('YouTube download timeout after 10 minutes')), 600000)
                    )
                  ]);
                  downloadSucceeded = true;
                  console.log(`[${new Date().toISOString()}] Last resort download succeeded with Android client`);
                } catch (fallbackError5) {
                  lastError = fallbackError5;
                  console.error(`[${new Date().toISOString()}] All fallback attempts failed. Last error:`, fallbackError5.message);
                }
              }
            }
          }
        }
      }

      // If still failed, throw the error
      if (!downloadSucceeded) {
        throw lastError;
      }
    }

    // Find the downloaded file
    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`youtube_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('Video file was not downloaded');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] File downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    // Telegram has a 50MB file size limit for bots
    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
        );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending video to user...`);
    console.log(`[${new Date().toISOString()}] Video size: ${fileSizeInMB.toFixed(2)} MB - this may take a while to upload...`);

    // Send video file using safe wrapper with longer timeout for large files
    // Large files need more time to upload - use 5 minutes for files over 5MB
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small
    console.log(`[${new Date().toISOString()}] Using upload timeout: ${uploadTimeout / 1000} seconds`);


    // Send video or audio
    if (formatId === 'audio_mp3' || downloadedFile.endsWith('.mp3')) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          title: videoTitle,
          caption: `🎧 ${videoTitle}`,
          reply_to_message_id: ctx.message.message_id
        }
      );
    } else {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        {
          caption: `📹 ${videoTitle}`,
          reply_to_message_id: ctx.message.message_id
        }
      );
    }

    console.log(`[${new Date().toISOString()}] Video sent successfully`);

    // Delete processing message
    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

    // Show success message
    await ctx.reply(`✅ Video downloaded successfully!\n\nSend another link to download more.`, removeKeyboard());

    // Clean up temporary file
    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

    // Clear user state
    userStates.delete(ctx.from.id);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading YouTube video:`);
    console.error(`[${new Date().toISOString()}] Error type:`, error.constructor.name);
    console.error(`[${new Date().toISOString()}] Error message:`, error.message);

    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }

    // Check if error is related to cookies/authentication, video availability, post-processing, or timeout
    const errorMessage = error.message || '';
    const errorStderr = error.stderr || '';
    const isAuthError = errorMessage.includes('Sign in to confirm') || 
                        errorMessage.includes('not a bot') ||
                        errorStderr.includes('Sign in to confirm') ||
                        errorStderr.includes('not a bot') ||
                        errorMessage.includes('challenge solving failed') ||
                        errorStderr.includes('challenge solving failed');
    const isVideoUnavailable = errorMessage.includes('video is unavailable') ||
                                errorStderr.includes('video is unavailable') ||
                                errorMessage.includes('Error code: 152') ||
                                errorStderr.includes('Error code: 152');
    const isPostProcessingError = errorMessage.includes('Postprocessing') ||
                                   errorStderr.includes('Postprocessing') ||
                                   errorMessage.includes('Could not write header') ||
                                   errorStderr.includes('Could not write header') ||
                                   errorMessage.includes('could not find codec parameters') ||
                                   errorStderr.includes('could not find codec parameters') ||
                                   errorMessage.includes('incorrect codec parameters') ||
                                   errorStderr.includes('incorrect codec parameters');
    const isTimeoutError = errorMessage.includes('timeout') ||
                           errorMessage.includes('Timeout') ||
                           errorMessage.includes('timed out') ||
                           error.constructor.name === 'TimeoutError';

    let errorMsg = 'Sorry, I couldn\'t download the video.';
    if (isTimeoutError) {
      errorMsg += '\n\n⏱️ Download timed out.\n';
      errorMsg += 'The download took too long to complete.\n\n';
      errorMsg += '💡 Try these solutions:\n';
      errorMsg += '1. Try a lower quality format (smaller file = faster download)\n';
      errorMsg += '2. Try downloading audio only (MP3) - much faster\n';
      errorMsg += '3. Check your internet connection\n';
      errorMsg += '4. Try again in a few minutes\n';
      errorMsg += '5. Try a different video (this one might be very large)';
    } else if (isPostProcessingError) {
      errorMsg += '\n\n⚠️ Video processing error occurred.\n';
      errorMsg += 'This usually means FFmpeg had trouble processing the video streams.\n\n';
      
      // Check if it's a low quality format that might have codec issues
      const isLowQuality = formatId && (formatId.includes('height<=144') || formatId.includes('height<=240'));
      
      if (isLowQuality) {
        errorMsg += '🔍 Low quality formats (144p, 240p) often have codec compatibility issues.\n\n';
        errorMsg += '💡 Recommended solutions:\n';
        errorMsg += '1. ✅ Try a higher quality (360p, 480p, or 720p) - these work better\n';
        errorMsg += '2. ✅ Try downloading audio only (MP3) - this always works\n';
        errorMsg += '3. The bot will automatically try 360p if low quality fails\n';
      } else {
        errorMsg += '💡 Try these solutions:\n';
        errorMsg += '1. Try a different quality/format\n';
        errorMsg += '2. Try downloading audio only (MP3)\n';
        errorMsg += '3. Try a lower quality (sometimes more compatible)\n';
        errorMsg += '4. Make sure FFmpeg is installed and accessible\n';
        errorMsg += '5. Try again in a few minutes (may be a temporary issue)';
      }
    } else if (isVideoUnavailable) {
      errorMsg += '\n\n⚠️ This video appears to be unavailable or restricted.\n';
      errorMsg += 'This might be due to:\n';
      errorMsg += '• Region restrictions\n';
      errorMsg += '• Age restrictions\n';
      errorMsg += '• Video was deleted or made private\n';
      errorMsg += '\nTry a different video or check if the link is accessible in your browser.';
    } else if (isAuthError && hasCookies) {
      errorMsg += '\n\n⚠️ YouTube is blocking the request with challenge solving.\n\n';
      
      // Check if it's specifically a challenge solving error
      const isChallengeError = errorMessage.includes('challenge solving failed') || 
                               errorStderr.includes('challenge solving failed');
      
      if (isChallengeError) {
        errorMsg += '🔒 YouTube is using JavaScript challenges to block automated downloads.\n';
        errorMsg += 'This is a known issue with YouTube\'s anti-bot protection.\n\n';
        errorMsg += '💡 Try these solutions:\n';
        errorMsg += '1. Try a different video (some videos are more restricted)\n';
        errorMsg += '2. Wait a few minutes and try again\n';
        errorMsg += '3. Re-export your cookies (they may have expired)\n';
        errorMsg += '4. Make sure you\'re logged into YouTube when exporting cookies\n\n';
        errorMsg += '📋 To re-export cookies:\n';
        errorMsg += '• Use the "Get cookies.txt LOCALLY" extension\n';
        errorMsg += '• Export from youtube.com (file should be 100+ KB)\n';
        errorMsg += '• Replace youtube_cookies.txt and restart the bot';
      } else {
        // Use validation info if available
        if (cookieValidation && cookieValidation.message) {
          errorMsg += `⚠️ ${cookieValidation.message}\n\n`;
        } else {
          // Fallback check
          try {
            const cookieStats = fs.statSync(youtubeCookiesPath);
            const cookieSizeKB = (cookieStats.size / 1024).toFixed(2);
            if (cookieStats.size < 10000) {
              errorMsg += `⚠️ Your cookies file is very small (${cookieSizeKB} KB).\n`;
              errorMsg += 'A proper cookies file should be 100+ KB with many cookies.\n\n';
            }
          } catch (e) {
            // Ignore
          }
        }
        
        errorMsg += '📋 How to export a complete cookies file:\n\n';
        errorMsg += '1. Make sure you\'re logged into YouTube in your browser\n';
        errorMsg += '2. Click the "Get cookies.txt LOCALLY" extension icon\n';
        errorMsg += '3. Select "youtube.com" from the dropdown\n';
        errorMsg += '4. Click "Export" - this should download a file\n';
        errorMsg += '5. The file should be 100+ KB (if it\'s small, try again)\n';
        errorMsg += '6. Rename it to "youtube_cookies.txt"\n';
        errorMsg += '7. Replace the file in the bot folder\n';
        errorMsg += '8. Restart the bot and try again\n\n';
        errorMsg += '💡 Tip: Make sure you export ALL cookies, not just a few. The extension should export hundreds of cookies.';
      }
    } else {
      errorMsg += ' Please try selecting a different format.';
    }

    try {
      await safeTelegramCall(
        ctx.telegram.editMessageText.bind(ctx.telegram),
        300000,
        ctx.chat.id,
        processingMsg.message_id,
        null,
        errorMsg
      );
    } catch (err) {
      await safeReply(ctx, errorMsg);
    }

    // Clear user state on error
    userStates.delete(ctx.from.id);
  }
}

// Helper function to download generic media
async function downloadGenericMedia(ctx, url) {
  console.log(`[${new Date().toISOString()}] Downloading generic media from: ${url}`);

  let processingMsg;
  try {
    processingMsg = await ctx.reply('Downloading media... Please wait.');
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] Could not send processing message, continuing anyway:`, error.message);
    processingMsg = null;
  }

  try {
    const timestamp = Date.now();
    const outputPath = path.join(tempDir, `generic_media_${timestamp}.%(ext)s`);

    const ytDlpArgs = [
      url,
      '-o', outputPath,
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    console.log(`[${new Date().toISOString()}] Running yt-dlp for generic URL with args:`, ytDlpArgs);

    await ytDlpWrap.execPromise(ytDlpArgs);

    const files = fs.readdirSync(tempDir);
    const downloadedFile = files.find(file => file.startsWith(`generic_media_${timestamp}.`));

    if (!downloadedFile) {
      throw new Error('Media file was not downloaded for generic URL');
    }

    const actualOutputPath = path.join(tempDir, downloadedFile);
    console.log(`[${new Date().toISOString()}] Found downloaded file: ${actualOutputPath}`);

    const stats = fs.statSync(actualOutputPath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    console.log(`[${new Date().toISOString()}] Generic file downloaded successfully. Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB > 50) {
      console.log(`[${new Date().toISOString()}] File too large (${fileSizeInMB.toFixed(2)} MB), deleting...`);
      fs.unlinkSync(actualOutputPath);
      if (processingMsg && processingMsg.message_id) {
        try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'File is too large (over 50MB). Telegram bots cannot send files larger than 50MB.'
        );
        } catch (err) {
          console.warn(`[${new Date().toISOString()}] Could not edit message:`, err.message);
        }
      }
      return;
    }

    console.log(`[${new Date().toISOString()}] Sending generic media to user...`);
    const uploadTimeout = fileSizeInMB > 5 ? 300000 : 180000; // 5 min for large, 3 min for small

    const fileExtension = path.extname(actualOutputPath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendPhoto.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp4', '.webm', '.mkv', '.avi'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendVideo.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (['.mp3', '.ogg', '.wav', '.flac'].includes(fileExtension)) {
      await safeTelegramCall(
        ctx.telegram.sendAudio.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      // Fallback to document for unknown types
      await safeTelegramCall(
        ctx.telegram.sendDocument.bind(ctx.telegram),
        uploadTimeout,
        ctx.chat.id,
        { source: actualOutputPath },
        { reply_to_message_id: ctx.message.message_id }
      );
    }

    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(ctx.telegram.deleteMessage.bind(ctx.telegram), 300000, ctx.chat.id, processingMsg.message_id);
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] Could not delete processing message:`, err.message);
      }
    }

    await safeReply(ctx, `✅ Media downloaded successfully!\n\nSend another link to download more.`);

    try {
      fs.unlinkSync(actualOutputPath);
      console.log(`[${new Date().toISOString()}] Temporary file deleted: ${actualOutputPath}`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error deleting temp file:`, err);
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error downloading generic media:`, error);
    if (error.stderr) {
      console.error(`[${new Date().toISOString()}] yt-dlp stderr:`, error.stderr);
    }
    if (processingMsg && processingMsg.message_id) {
      try {
        await safeTelegramCall(
          ctx.telegram.editMessageText.bind(ctx.telegram),
          300000, // Default timeout
          ctx.chat.id,
          processingMsg.message_id,
          null,
          'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.'
        );
      } catch (err) {
        await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
      }
    } else {
      await safeReply(ctx, 'Sorry, I couldn\'t download the media from this link. Please check if the link is valid.');
    }
  }
}

// Helper function to safely send messages with retry and timeout handling
async function safeReply(ctx, message, extra = {}) {
  const maxRetries = 5;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create a promise with timeout
      const replyPromise = ctx.reply(message, extra);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Reply timeout after 120 seconds')), 120000)
      );

      await Promise.race([replyPromise, timeoutPromise]);
      return true;
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' ||
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT') ||
        error.errno === 'ETIMEDOUT';

      console.warn(`[${new Date().toISOString()}] Failed to send message (attempt ${attempt}/${maxRetries}):`, error.message);

      // If it's a timeout/connection error and we have retries left, wait and retry
      if (attempt < maxRetries && isTimeout) {
        const waitTime = Math.min(3000 * attempt, 15000); // Exponential backoff, max 15 seconds
        console.log(`[${new Date().toISOString()}] Retrying in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If it's not a timeout or we're out of retries, break
      if (!isTimeout) {
        break; // Non-timeout errors don't retry
      }
    }
  }

  console.error(`[${new Date().toISOString()}] Failed to send message after ${maxRetries} attempts:`, lastError);
  return false;
}

// Helper function to safely send Telegram API calls with retry and timeout handling
// Usage: safeTelegramCall(method, timeoutMs, ...args) or safeTelegramCall(method, ...args) with default timeout
async function safeTelegramCall(telegramMethod, timeoutOrFirstArg, ...restArgs) {
  // Check if second argument is a number (timeout) or first arg
  let timeoutMs = 300000; // Default 5 minutes
  let args;

  if (typeof timeoutOrFirstArg === 'number') {
    // timeoutMs provided as second argument
    timeoutMs = timeoutOrFirstArg;
    args = restArgs;
  } else {
    // No timeout provided, use default and treat timeoutOrFirstArg as first arg
    args = [timeoutOrFirstArg, ...restArgs];
  }

  const maxRetries = 3; // Reduced retries for file uploads (they take long)
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Create a promise with timeout
      const callPromise = telegramMethod(...args);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`API call timeout after ${timeoutMs / 1000} seconds`)), timeoutMs)
      );

      return await Promise.race([callPromise, timeoutPromise]);
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT' ||
        error.message.includes('timeout') ||
        error.message.includes('ETIMEDOUT') ||
        error.errno === 'ETIMEDOUT';

      console.warn(`[${new Date().toISOString()}] Failed Telegram API call (attempt ${attempt}/${maxRetries}):`, error.message);

      // If it's a timeout/connection error and we have retries left, wait and retry
      if (attempt < maxRetries && isTimeout) {
        const waitTime = Math.min(3000 * attempt, 15000); // Exponential backoff, max 15 seconds
        console.log(`[${new Date().toISOString()}] Retrying API call in ${waitTime / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If it's not a timeout or we're out of retries, break
      if (!isTimeout) {
        break; // Non-timeout errors don't retry
      }
    }
  }

  console.error(`[${new Date().toISOString()}] Failed Telegram API call after ${maxRetries} attempts:`, lastError);
  throw lastError;
}

// Helper function to create admin status keyboard (Reply Keyboard Markup)
function createAdminStatusKeyboard() {
  return Markup.keyboard([
    ['📊 Bot Status']
  ]).resize();
}

// Helper function to remove keyboard
function removeKeyboard() {
  return Markup.removeKeyboard();
}

// Start command handler
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username;
  const firstName = ctx.from.first_name;
  const lastName = ctx.from.last_name;

  // Add user to tracking and get user type
  const userType = addUser(userId, username, firstName, lastName);

  // Personalized greetings based on user type
  let greetingMessage = '';

  if (userType === 'admin') {
    const stats = getStats();
    greetingMessage = `👋 Hello Admin!\n\n📊 Bot Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nI can help you download:\n• 📹 YouTube videos (with format selection)\n• 🎬 YouTube Shorts (MP4)\n• 🎵 TikTok videos (MP4)\n• 📸 Instagram photos (PNG)\n• 🎥 Instagram videos (MP4)\n• 🖼️ YouTube thumbnails (PNG)\n• 📦 Instagram carousel posts (all items)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, createAdminStatusKeyboard());
  } else if (userType === 'existing') {
    greetingMessage = `👋 Welcome back!\n\nI can help you download:\n• 📹 YouTube videos (with format selection)\n• 🎬 YouTube Shorts (MP4)\n• 🎵 TikTok videos (MP4)\n• 📸 Instagram photos (PNG)\n• 🎥 Instagram videos (MP4)\n• 🖼️ YouTube thumbnails (PNG)\n• 📦 Instagram carousel posts (all items)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else if (userType === 'new') {
    greetingMessage = `👋 Welcome! Nice to meet you!\n\nI'm a bot that can help you download:\n• 📹 YouTube videos (with format selection)\n• 🎬 YouTube Shorts (MP4)\n• 🎵 TikTok videos (MP4)\n• 📸 Instagram photos (PNG)\n• 🎥 Instagram videos (MP4)\n• 🖼️ YouTube thumbnails (PNG)\n• 📦 Instagram carousel posts (all items)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  } else {
    // Fallback for general users
    greetingMessage = `Hi! I can help you download:\n• 📹 YouTube videos (with format selection)\n• 🎬 YouTube Shorts (MP4)\n• 🎵 TikTok videos (MP4)\n• 📸 Instagram photos (PNG)\n• 🎥 Instagram videos (MP4)\n• 🖼️ YouTube thumbnails (PNG)\n• 📦 Instagram carousel posts (all items)\n\nPlease share a link to download.`;
    await ctx.reply(greetingMessage, removeKeyboard());
  }
});


// Function to show statistics
function showStats(ctx) {
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('This command is only available for administrators.');
    return;
  }

  const stats = getStats();
  const usersData = loadUsers();
  const recentUsers = usersData.users.slice(-10).reverse(); // Last 10 users

  let message = `📊 Bot Statistics\n\n`;
  message += `👥 Total Users: ${stats.totalUsers}\n`;
  message += `🆕 New Users Today: ${stats.newUsersToday}\n\n`;
  message += `📅 Last Reset Date: ${usersData.lastResetDate}\n\n`;

  if (recentUsers.length > 0) {
    message += `👤 Recent Users (last 10):\n`;
    recentUsers.forEach((user, index) => {
      const name = user.firstName || user.username || `User ${user.id}`;
      message += `${index + 1}. ${name} (ID: ${user.id})\n`;
    });
  }

  ctx.reply(message, createAdminStatusKeyboard());
}

// Stats command handler (admin only) - hidden from commands menu
// Admin can use the Reply Keyboard button "📊 Bot Status" instead
bot.command('stats', (ctx) => {
  // Track user
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  // Only show stats if user is admin
  if (!ADMIN_ID || ctx.from.id !== ADMIN_ID) {
    ctx.reply('This command is only available for administrators.');
    return;
  }
  showStats(ctx);
});

// /tiktoksetup – install curl_cffi so TikTok downloads work (fixes "no impersonate target" / SSL errors)
// Runs in background so the 90s Telegraf handler timeout doesn't kill it
bot.command('tiktoksetup', async (ctx) => {
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  const { spawn } = require('child_process');
  const py = (finalYtDlpPath === 'python' || finalYtDlpPath === 'python3') ? finalYtDlpPath : 'python';
  ctx.reply('⏳ Installing curl_cffi (0.5.10) and yt-dlp in the background (2–3 min). I\'ll message you when it\'s done.').catch(() => {});
  // curl_cffi==0.5.10 avoids OpenSSL bug on Windows; yt-dlp[default,curl-cffi] uses it for TikTok
  const proc = spawn(py, ['-m', 'pip', 'install', 'curl_cffi==0.5.10', 'yt-dlp[default,curl-cffi]'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const t = setTimeout(() => { try { proc.kill(); } catch (_) {} }, 180000);
  proc.on('close', (code) => {
    clearTimeout(t);
    if (code === 0) {
      if (process.platform === 'win32') {
        try { fs.writeFileSync(path.join(__dirname, 'use_python_ytdlp'), '', 'utf8'); } catch (_) {}
      }
      ctx.reply('✅ Installed. Switched to Python+curl_cffi for TikTok. Restart the bot (Ctrl+C, then npm start) and try a TikTok link.').catch(() => {});
    } else {
      ctx.reply(`❌ Install failed (code ${code}). In Cursor terminal run: pip install "curl_cffi==0.5.10" "yt-dlp[default,curl-cffi]" then: New-Item -ItemType File -Path use_python_ytdlp -Force (in rvbot folder), then restart.`).catch(() => {});
    }
  });
  proc.on('error', () => { clearTimeout(t); ctx.reply('❌ Could not run pip. In Cursor terminal: pip install "curl_cffi==0.5.10" "yt-dlp[default,curl-cffi]" and create use_python_ytdlp in rvbot.').catch(() => {}); });
});

// /tiktokfix – on Windows: download standalone yt-dlp.exe to rvbot/bin to bypass curl_cffi/OpenSSL bug
bot.command('tiktokfix', async (ctx) => {
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  if (process.platform !== 'win32') {
    await ctx.reply('This fix is for Windows. On your system, try: pip install "curl_cffi==0.5.10" and restart the bot.');
    return;
  }
  await ctx.reply('⏳ Downloading standalone yt-dlp.exe...');
  const binDir = path.join(__dirname, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exePath = path.join(binDir, 'yt-dlp.exe');
  const ua = 'rvbot-tiktokfix/1.0';
  try {
    const apiJson = await new Promise((resolve, reject) => {
      const req = https.get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { 'User-Agent': ua } }, (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
    });
    if (apiJson.message && /rate|limit/i.test(apiJson.message)) throw new Error('GitHub rate limit');
    const asset = (apiJson.assets || []).find(a => a.name === 'yt-dlp.exe');
    if (!asset || !asset.browser_download_url) throw new Error('yt-dlp.exe not in release');
    const url = asset.browser_download_url;
    await new Promise((resolve, reject) => {
      const doGet = (u) => {
        const req = https.get(u, { headers: { 'User-Agent': ua } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            doGet(res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, u).href);
            return;
          }
          if (res.statusCode !== 200) { reject(new Error('Download HTTP ' + res.statusCode)); return; }
          const file = fs.createWriteStream(exePath);
          res.pipe(file);
          file.on('finish', () => { file.close(() => resolve()); });
          file.on('error', reject);
        });
        req.on('error', reject);
      };
      doGet(url);
    });
    await ctx.reply('✅ Downloaded yt-dlp.exe to rvbot/bin. Restart the bot (Ctrl+C, npm start) and try a TikTok link again.');
    try { const fp = path.join(__dirname, 'use_python_ytdlp'); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
  } catch (e) {
    const msg = (e && e.message) || String(e);
    await ctx.reply('❌ Failed: ' + msg + '. Manually download yt-dlp.exe from https://github.com/yt-dlp/yt-dlp/releases and put it in the rvbot/bin folder.');
  }
});

// /tiktokcursor – show Cursor terminal commands to fix TikTok (Python+curl_cffi) without /tiktoksetup
bot.command('tiktokcursor', async (ctx) => {
  addUser(ctx.from.id, ctx.from.username, ctx.from.first_name, ctx.from.last_name);
  const rvbot = __dirname;
  const rvbotSlash = rvbot.replace(/\\/g, '/');
  const msg = '📋 **Cursor terminal commands** (fix TikTok OpenSSL on Windows):\n\n' +
    '1) Open Cursor\'s terminal (Ctrl+`) and run:\n\n' +
    '`cd "' + rvbotSlash + '"`\n\n' +
    '2) Then:\n\n' +
    '`pip install "curl_cffi==0.5.10" "yt-dlp[default,curl-cffi]"`\n\n' +
    '3) Create the flag file:\n\n' +
    '`New-Item -ItemType File -Path "use_python_ytdlp" -Force`\n\n' +
    '4) Restart the bot: `Ctrl+C`, then `npm start`\n\n' +
    'After that, try a TikTok link again.';
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Message handler for Instagram links, YouTube links, and admin status button
bot.on('text', async (ctx) => {
  try {
    // Safety checks
    if (!ctx || !ctx.message || !ctx.message.text) {
      console.warn(`[${new Date().toISOString()}] Received text update without message text`);
      return;
    }

    if (!ctx.from || !ctx.from.id) {
      console.warn(`[${new Date().toISOString()}] Received text update without user info`);
      return;
    }

    const userId = ctx.from.id;
    const messageText = ctx.message.text;

    // Track user
    addUser(userId, ctx.from.username, ctx.from.first_name, ctx.from.last_name);

    // Handle admin status button
    if (ADMIN_ID && userId === ADMIN_ID && messageText === '📊 Bot Status') {
      showStats(ctx);
      return;
    }

    // Check if user is selecting a YouTube format
    const userState = userStates.get(userId);
    if (userState && userState.type === 'youtube_format_selection') {
      const selectedFormat = userState.formats[messageText];
      if (selectedFormat) {
        // User selected a format, download the video
        await downloadYouTubeVideo(ctx, selectedFormat, userState.url, userState.title);
        return;
      } else {
        // Invalid selection, clear state and ask to try again
        userStates.delete(userId);
        ctx.reply('Invalid format selection. Please send a valid YouTube link to try again.', removeKeyboard());
        return;
      }
    }

    // Check if it's a TikTok URL pattern
    const tiktokUrlPattern = /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\/.+/i;
    const isTikTokLink = tiktokUrlPattern.test(messageText);

    // Check if it's a YouTube URL pattern (including Shorts)
    const youtubeUrlPattern = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/i;
    const isYouTubeLink = youtubeUrlPattern.test(messageText);
    const isYouTubeShorts = /youtube\.com\/shorts\//i.test(messageText);

    // Check if it's an Instagram URL pattern (auto-detect)
    const instagramUrlPattern = /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\/.+/i;
    const isInstagramLink = instagramUrlPattern.test(messageText);

    // Handle TikTok links - download directly as MP4
    if (isTikTokLink) {
      console.log(`[${new Date().toISOString()}] Auto-detected TikTok link from user ${userId}`);
      await downloadTikTokVideo(ctx, messageText);
      return;
    }

    // Handle YouTube Shorts - download directly as MP4 (no format selection)
    if (isYouTubeShorts) {
      console.log(`[${new Date().toISOString()}] Auto-detected YouTube Shorts link from user ${userId}`);
      // Download YouTube Shorts directly as MP4
      await downloadYouTubeVideo(ctx, 'bestvideo+bestaudio/best[acodec!=none]/best', messageText, 'YouTube Shorts');
      return;
    }

    // Handle YouTube links - show format selection
    if (isYouTubeLink) {
      console.log(`[${new Date().toISOString()}] Auto-detected YouTube link from user ${userId}`);
      await showYouTubeFormats(ctx, messageText);
      return;
    }

    // Auto-detect and download Instagram links
    if (isInstagramLink) {
      console.log(`[${new Date().toISOString()}] Auto-detected Instagram link from user ${userId}`);
      // Download the media automatically
      await downloadInstagramMedia(ctx, messageText);
      return;
    }

    // Generic URL detection (if not YT/Insta)
    const isUrl = /^https?:\/\//i.test(messageText);
    if (isUrl) {
      console.log(`[${new Date().toISOString()}] Detected generic URL from user ${userId}`);
      await downloadGenericMedia(ctx, messageText);
      return;
    }

    // Search functionality (if text is not a URL and not a command)
    if (messageText && !messageText.startsWith('/') && messageText.length > 2) {
      console.log(`[${new Date().toISOString()}] Treating as search query: ${messageText}`);
      const searchUrl = `ytsearch1:${messageText}`;
      await showYouTubeFormats(ctx, searchUrl);
      return;
    }

    // If message is not a link and not a command, provide helpful message
    // Only respond if it looks like they might be trying to send a link
    if (messageText && messageText.length > 10 && !messageText.startsWith('/')) {
      await ctx.reply('Please send a valid link to download media.\n\nSupported platforms:\n• 📹 YouTube: https://www.youtube.com/watch?v=...\n• 🎬 YouTube Shorts: https://www.youtube.com/shorts/...\n• 🎵 TikTok: https://www.tiktok.com/@...\n• 📸 Instagram: https://www.instagram.com/p/...');
    }
  } catch (error) {
    // Log error but don't let it crash the bot
    console.error(`[${new Date().toISOString()}] Error in text message handler:`, error);
    console.error(`[${new Date().toISOString()}] Error stack:`, error.stack);
    // Error will be caught by bot.catch() handler
    throw error;
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`[${new Date().toISOString()}] ========== BOT ERROR ==========`);
  console.error(`[${new Date().toISOString()}] Error type:`, err.constructor.name);
  console.error(`[${new Date().toISOString()}] Error message:`, err.message);
  console.error(`[${new Date().toISOString()}] Error stack:`, err.stack);
  if (ctx) {
    console.error(`[${new Date().toISOString()}] User ID:`, ctx.from?.id);
    console.error(`[${new Date().toISOString()}] Username:`, ctx.from?.username);
    console.error(`[${new Date().toISOString()}] Chat ID:`, ctx.chat?.id);
    console.error(`[${new Date().toISOString()}] Message text:`, ctx.message?.text);
    console.error(`[${new Date().toISOString()}] Update type:`, ctx.updateType);
  }
  console.error(`[${new Date().toISOString()}] ====================================`);

  // Try to send a more helpful error message
  try {
    if (ctx && ctx.reply) {
      const isTimeout = err.name === 'TimeoutError' || (err.message && String(err.message).includes('timed out'));
      const txt = (ctx.message?.text || '').trim();
      const isTiktoksetup = txt === '/tiktoksetup';
      const isTiktokUrl = /tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(txt);
      if (isTimeout && isTiktoksetup) {
        ctx.reply('⏱️ The setup timed out. The install may still be running in the background. Wait 2–3 minutes, then restart the bot (Ctrl+C, npm start) and try a TikTok link. If it still fails, run in a terminal: python -m pip install "yt-dlp[default,curl-cffi]" and restart.').catch(() => {});
        return;
      }
      if (isTimeout && isTiktokUrl) {
        ctx.reply('⏱️ The TikTok download timed out. This is often the curl_cffi/OpenSSL issue on Windows. Send /tiktokfix in this chat (to the bot), or run: pip install "curl_cffi==0.5.10" and restart the bot.').catch(() => {});
        return;
      }
      ctx.reply('An error occurred. Please try again. If the problem persists, make sure you\'re sending a valid link (YouTube, YouTube Shorts, TikTok, or Instagram).');
    }
  } catch (replyError) {
    console.error(`[${new Date().toISOString()}] Failed to send error message:`, replyError);
  }
});

// Retry function for bot launch
async function launchBotWithRetry(maxRetries = 5, delay = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[${new Date().toISOString()}] Attempting to start bot (attempt ${attempt}/${maxRetries})...`);
      await bot.launch();
      console.log(`[${new Date().toISOString()}] Bot is running...`);
      console.log(`[${new Date().toISOString()}] yt-dlp binary path: ${ytDlpWrap.getBinaryPath()}`);

      // Set empty bot commands menu so no commands are visible to users
      // Stats is only available to admin via Reply Keyboard Markup button
      try {
        await bot.telegram.setMyCommands([]);
        console.log(`[${new Date().toISOString()}] Bot commands menu configured`);
      } catch (cmdError) {
        console.warn(`[${new Date().toISOString()}] Warning: Could not set bot commands:`, cmdError.message);
      }

      // Greet admin with statistics
      if (ADMIN_ID) {
        try {
          const stats = getStats();
          const greetingMessage = `🤖 Bot Started Successfully!\n\n📊 Current Statistics:\n• Total Users: ${stats.totalUsers}\n• New Users Today: ${stats.newUsersToday}\n\nUse the "📊 Bot Status" button to view detailed statistics.`;
          await bot.telegram.sendMessage(ADMIN_ID, greetingMessage);
          console.log(`[${new Date().toISOString()}] Admin notification sent`);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error sending admin notification:`, error);
        }
      } else {
        console.warn(`[${new Date().toISOString()}] ADMIN_ID not set - admin features will be disabled`);
      }
      return; // Success, exit function
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error starting bot (attempt ${attempt}/${maxRetries}):`, err.message);

      if (attempt < maxRetries) {
        console.log(`[${new Date().toISOString()}] Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        // Exponential backoff - increase delay for next retry
        delay = Math.min(delay * 1.5, 30000); // Max 30 seconds
      } else {
        console.error(`[${new Date().toISOString()}] Failed to start bot after ${maxRetries} attempts.`);
        console.error(`[${new Date().toISOString()}] Last error:`, err);
        // Don't exit - keep HTTP server running for Render port detection
        // The bot will be in a failed state, but the service will stay up
        console.error(`[${new Date().toISOString()}] Bot failed to start, but HTTP server will continue running`);
        throw err; // Re-throw so caller knows it failed
      }
    }
  }
}

// Graceful shutdown
process.once('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] Shutting down...`);
  server.close();
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] Shutting down...`);
  server.close();
  bot.stop('SIGTERM');
});

