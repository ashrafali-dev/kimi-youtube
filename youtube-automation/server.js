const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const YTDlpWrap = require('yt-dlp-wrap');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const cron = require('node-cron');
const archiver = require('archiver');
require('dotenv').config();

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/temp', express.static('temp'));
app.use('/uploads', express.static('uploads'));

// Ensure directories exist
fs.ensureDirSync('temp');
fs.ensureDirSync('uploads/audio');
fs.ensureDirSync('uploads/videos');

// In-memory storage
const db = {
  videos: [],
  audios: [],
  schedules: [],
  settings: {}
};

// yt-dlp instance
const ytDlp = new YTDlpWrap();

// Gemini AI
let genAI = null;
let geminiModel = null;
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-pro' });
}

// YouTube OAuth
const youtubeOAuth = new OAuth2Client(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${PORT}/api/youtube/callback`
);

let youtubeTokens = null;

// Google Drive OAuth
const driveOAuth = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/drive/callback`
);

let driveTokens = null;

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/audio');
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ==================== HELPERS ====================

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

async function getVideoInfo(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of json "${filePath}"`
    );
    return JSON.parse(stdout).streams[0] || {};
  } catch {
    return {};
  }
}

async function getAudioInfo(filePath) {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`
    );
    const info = JSON.parse(stdout);
    return {
      duration: parseFloat(info.format.duration) || 0,
      bitrate: parseInt(info.format.bit_rate) || 0
    };
  } catch {
    return { duration: 0, bitrate: 0 };
  }
}

// ==================== VIDEO ROUTES ====================

// Download video
app.post('/api/videos/download', async (req, res) => {
  try {
    const { url, mute = true, quality = 'medium' } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = uuidv4();
    const outputPath = path.join('temp', `${id}.%(ext)s`);
    
    console.log(`Downloading: ${url}`);
    
    // Download with yt-dlp
    const format = quality === 'best' 
      ? 'best[ext=mp4]/best'
      : quality === 'worst'
      ? 'worst[ext=mp4]/worst'
      : 'best[height<=720][ext=mp4]/best[height<=720]/best';
    
    await ytDlp.execPromise([url, '-o', outputPath, '-f', format]);
    
    // Find downloaded file
    const files = await fs.readdir('temp');
    const downloadedFile = files.find(f => f.startsWith(id));
    
    if (!downloadedFile) {
      throw new Error('Download failed');
    }
    
    const localPath = path.join('temp', downloadedFile);
    const info = await ytDlp.getVideoInfo(url);
    const videoInfo = await getVideoInfo(localPath);
    
    const video = {
      id,
      originalUrl: url,
      title: info.title || 'Untitled',
      description: info.description || '',
      localPath,
      processedPath: localPath,
      status: mute ? 'ready' : 'downloaded',
      isMuted: mute,
      metadata: {
        duration: info.duration || 0,
        width: videoInfo.width || 0,
        height: videoInfo.height || 0,
        size: (await fs.stat(localPath)).size
      },
      createdAt: new Date().toISOString()
    };
    
    // Mute if requested
    if (mute) {
      const mutedPath = path.join('temp', `${id}_muted.mp4`);
      await execAsync(`ffmpeg -i "${localPath}" -c:v copy -an "${mutedPath}" -y`);
      video.processedPath = mutedPath;
    }
    
    db.videos.push(video);
    res.json({ success: true, video });
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk download
app.post('/api/videos/download/bulk', async (req, res) => {
  try {
    const { urls, mute = true, quality = 'medium' } = req.body;
    if (!Array.isArray(urls)) return res.status(400).json({ error: 'URLs array required' });
    
    const results = [];
    for (const url of urls) {
      try {
        const response = await fetch(`http://localhost:${PORT}/api/videos/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, mute, quality })
        });
        const data = await response.json();
        results.push({ url, success: data.success, video: data.video });
      } catch (err) {
        results.push({ url, success: false, error: err.message });
      }
    }
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all videos
app.get('/api/videos', (req, res) => {
  const { status } = req.query;
  let videos = db.videos;
  if (status) videos = videos.filter(v => v.status === status);
  res.json({ success: true, videos });
});

// Get video by ID
app.get('/api/videos/:id', (req, res) => {
  const video = db.videos.find(v => v.id === req.params.id);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  res.json({ success: true, video });
});

// Merge video with audio
app.post('/api/videos/:id/merge', async (req, res) => {
  try {
    const { audioId, loop = false } = req.body;
    const video = db.videos.find(v => v.id === req.params.id);
    const audio = db.audios.find(a => a.id === audioId);
    
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (!audio) return res.status(404).json({ error: 'Audio not found' });
    
    const outputPath = path.join('temp', `${video.id}_final.mp4`);
    
    let ffmpegCmd;
    if (loop) {
      ffmpegCmd = `ffmpeg -i "${video.processedPath}" -stream_loop -1 -i "${audio.localPath}" -c:v copy -c:a aac -shortest "${outputPath}" -y`;
    } else {
      ffmpegCmd = `ffmpeg -i "${video.processedPath}" -i "${audio.localPath}" -c:v copy -c:a aac -shortest "${outputPath}" -y`;
    }
    
    await execAsync(ffmpegCmd);
    
    video.processedPath = outputPath;
    video.audioId = audioId;
    video.status = 'ready';
    
    res.json({ success: true, video });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete video
app.delete('/api/videos/:id', async (req, res) => {
  try {
    const video = db.videos.find(v => v.id === req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    if (video.localPath) await fs.remove(video.localPath).catch(() => {});
    if (video.processedPath && video.processedPath !== video.localPath) {
      await fs.remove(video.processedPath).catch(() => {});
    }
    
    db.videos = db.videos.filter(v => v.id !== req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create zip
app.post('/api/videos/zip', async (req, res) => {
  try {
    const { videoIds } = req.body;
    const zipId = uuidv4();
    const zipPath = path.join('temp', `${zipId}.zip`);
    
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.pipe(output);
    
    for (const videoId of videoIds) {
      const video = db.videos.find(v => v.id === videoId);
      if (video?.processedPath && fs.existsSync(video.processedPath)) {
        archive.file(video.processedPath, { name: `${video.title || videoId}.mp4` });
      }
    }
    
    await archive.finalize();
    
    res.json({ success: true, zipPath: `/temp/${zipId}.zip` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== AUDIO ROUTES ====================

// Upload audio
app.post('/api/audio/upload', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    const info = await getAudioInfo(req.file.path);
    
    const audio = {
      id: uuidv4(),
      name: req.body.name || req.file.originalname.replace(/\.[^/.]+$/, ''),
      localPath: req.file.path,
      duration: info.duration,
      format: path.extname(req.file.originalname).slice(1),
      size: req.file.size,
      createdAt: new Date().toISOString()
    };
    
    db.audios.push(audio);
    res.json({ success: true, audio });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download audio from YouTube
app.post('/api/audio/download', async (req, res) => {
  try {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    
    const id = uuidv4();
    const outputPath = path.join('uploads/audio', `${id}.%(ext)s`);
    
    await ytDlp.execPromise([url, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outputPath]);
    
    const files = await fs.readdir('uploads/audio');
    const downloadedFile = files.find(f => f.startsWith(id));
    
    if (!downloadedFile) throw new Error('Download failed');
    
    const localPath = path.join('uploads/audio', downloadedFile);
    const info = await getAudioInfo(localPath);
    const videoInfo = await ytDlp.getVideoInfo(url);
    
    const audio = {
      id,
      name: name || videoInfo.title || 'Audio',
      originalUrl: url,
      localPath,
      duration: info.duration,
      format: 'mp3',
      size: (await fs.stat(localPath)).size,
      createdAt: new Date().toISOString()
    };
    
    db.audios.push(audio);
    res.json({ success: true, audio });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all audios
app.get('/api/audio', (req, res) => {
  res.json({ success: true, audio: db.audios });
});

// Delete audio
app.delete('/api/audio/:id', async (req, res) => {
  try {
    const audio = db.audios.find(a => a.id === req.params.id);
    if (!audio) return res.status(404).json({ error: 'Audio not found' });
    
    await fs.remove(audio.localPath).catch(() => {});
    db.audios = db.audios.filter(a => a.id !== req.params.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== AI ROUTES ====================

// Generate content
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { videoTitle, videoDescription, category = 'general', language = 'bn' } = req.body;
    
    if (!geminiModel) {
      return res.json({
        success: true,
        content: {
          title: videoTitle || 'Amazing Video',
          description: 'Watch this amazing video!',
          tags: ['shorts', 'viral', 'trending'],
          hashtags: ['#Shorts', '#YouTubeShorts', '#Viral']
        }
      });
    }
    
    const prompt = `Generate YouTube Shorts content in ${language === 'bn' ? 'Bengali' : 'English'}:
Title: ${videoTitle}
Category: ${category}

Respond in JSON:
{
  "title": "attention-grabbing title (max 100 chars)",
  "description": "engaging description with call-to-action",
  "tags": ["tag1", "tag2", ...],
  "hashtags": ["#tag1", "#tag2", ...]
}`;
    
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text();
    
    let content;
    try {
      content = JSON.parse(text.replace(/```json\n?/, '').replace(/```\n?/, ''));
    } catch {
      content = {
        title: videoTitle || 'Amazing Video',
        description: 'Watch this amazing video!',
        tags: ['shorts', 'viral', 'trending'],
        hashtags: ['#Shorts', '#YouTubeShorts', '#Viral']
      };
    }
    
    res.json({ success: true, content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== YOUTUBE UPLOAD ROUTES ====================

// Get auth URL
app.get('/api/upload/youtube/auth', (req, res) => {
  const url = youtubeOAuth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent'
  });
  res.json({ success: true, authUrl: url });
});

// OAuth callback
app.get('/api/upload/youtube/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await youtubeOAuth.getToken(code);
    youtubeTokens = tokens;
    youtubeOAuth.setCredentials(tokens);
    res.json({ success: true, message: 'YouTube connected!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload video
app.post('/api/upload/youtube/:videoId', async (req, res) => {
  try {
    if (!youtubeTokens) return res.status(401).json({ error: 'YouTube not connected' });
    
    const video = db.videos.find(v => v.id === req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    const { title, description, tags, autoGenerateContent } = req.body;
    
    let finalTitle = title;
    let finalDescription = description;
    let finalTags = tags;
    
    if (autoGenerateContent || !title) {
      const aiResponse = await fetch(`http://localhost:${PORT}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoTitle: video.title })
      });
      const aiData = await aiResponse.json();
      finalTitle = aiData.content.title;
      finalDescription = aiData.content.description;
      finalTags = aiData.content.tags;
    }
    
    const youtube = google.youtube({ version: 'v3', auth: youtubeOAuth });
    
    const response = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: finalTitle.substring(0, 100),
          description: finalDescription,
          tags: finalTags
        },
        status: { privacyStatus: 'public' }
      },
      media: { body: fs.createReadStream(video.processedPath) }
    });
    
    video.status = 'uploaded';
    video.uploadInfo = { youtubeVideoId: response.data.id, uploadDate: new Date().toISOString() };
    
    res.json({ success: true, result: { youtubeVideoId: response.data.id } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== GOOGLE DRIVE ROUTES ====================

// Get auth URL
app.get('/api/upload/drive/auth', (req, res) => {
  const url = driveOAuth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent'
  });
  res.json({ success: true, authUrl: url });
});

// OAuth callback
app.get('/api/upload/drive/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await driveOAuth.getToken(code);
    driveTokens = tokens;
    driveOAuth.setCredentials(tokens);
    res.json({ success: true, message: 'Drive connected!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload to Drive
app.post('/api/upload/drive/:videoId', async (req, res) => {
  try {
    if (!driveTokens) return res.status(401).json({ error: 'Drive not connected' });
    
    const video = db.videos.find(v => v.id === req.params.videoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    const drive = google.drive({ version: 'v3', auth: driveOAuth });
    
    const response = await drive.files.create({
      requestBody: { name: `${video.title}.mp4` },
      media: { body: fs.createReadStream(video.processedPath) },
      fields: 'id, webViewLink'
    });
    
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });
    
    res.json({ success: true, result: { fileId: response.data.id, webLink: response.data.webViewLink } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload zip to Drive
app.post('/api/upload/drive/zip', async (req, res) => {
  try {
    if (!driveTokens) return res.status(401).json({ error: 'Drive not connected' });
    
    const { videoIds, zipName } = req.body;
    const zipId = uuidv4();
    const zipPath = path.join('temp', `${zipId}.zip`);
    
    // Create zip
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    
    for (const videoId of videoIds) {
      const video = db.videos.find(v => v.id === videoId);
      if (video?.processedPath && fs.existsSync(video.processedPath)) {
        archive.file(video.processedPath, { name: `${video.title || videoId}.mp4` });
      }
    }
    
    await archive.finalize();
    
    // Upload to Drive
    const drive = google.drive({ version: 'v3', auth: driveOAuth });
    
    const response = await drive.files.create({
      requestBody: { name: `${zipName || 'videos'}.zip` },
      media: { body: fs.createReadStream(zipPath) },
      fields: 'id, webViewLink'
    });
    
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });
    
    res.json({ success: true, result: { fileId: response.data.id, webLink: response.data.webViewLink } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SCHEDULE ROUTES ====================

// Create schedule
app.post('/api/schedule', (req, res) => {
  try {
    const { videoId, scheduledTime, autoGenerateContent = true } = req.body;
    
    const schedule = {
      id: uuidv4(),
      videoId,
      scheduledTime,
      status: 'active',
      autoGenerateContent,
      createdAt: new Date().toISOString()
    };
    
    db.schedules.push(schedule);
    
    // Update video status
    const video = db.videos.find(v => v.id === videoId);
    if (video) video.status = 'scheduled';
    
    res.json({ success: true, schedule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get schedules
app.get('/api/schedule', (req, res) => {
  res.json({ success: true, schedules: db.schedules });
});

// Delete schedule
app.delete('/api/schedule/:id', (req, res) => {
  const schedule = db.schedules.find(s => s.id === req.params.id);
  if (schedule) {
    const video = db.videos.find(v => v.id === schedule.videoId);
    if (video) video.status = 'ready';
  }
  db.schedules = db.schedules.filter(s => s.id !== req.params.id);
  res.json({ success: true });
});

// Schedule checker (runs every minute)
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const dueSchedules = db.schedules.filter(s => {
    if (s.status !== 'active') return false;
    const scheduleTime = new Date(s.scheduledTime);
    return scheduleTime <= now;
  });
  
  for (const schedule of dueSchedules) {
    try {
      schedule.status = 'uploading';
      
      await fetch(`http://localhost:${PORT}/api/upload/youtube/${schedule.videoId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoGenerateContent: schedule.autoGenerateContent })
      });
      
      schedule.status = 'completed';
    } catch (error) {
      schedule.status = 'failed';
      console.error('Schedule upload failed:', error);
    }
  }
});

// ==================== FRONTEND ====================

// Serve frontend
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube Automation</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f; 
      color: #fff;
      padding-bottom: 80px;
    }
    .header { 
      background: #1a1a1a; 
      padding: 15px; 
      position: sticky; 
      top: 0; 
      z-index: 100;
      border-bottom: 1px solid #333;
    }
    .header h1 { font-size: 18px; display: flex; align-items: center; gap: 10px; }
    .header .icon { color: #ff0000; }
    .container { padding: 15px; max-width: 600px; margin: 0 auto; }
    .card { 
      background: #1a1a1a; 
      border-radius: 12px; 
      padding: 15px; 
      margin-bottom: 15px;
      border: 1px solid #333;
    }
    .card-title { font-size: 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .input-group { display: flex; gap: 8px; margin-bottom: 10px; }
    input, textarea, select {
      flex: 1;
      background: #2a2a2a;
      border: 1px solid #444;
      color: #fff;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
    }
    button {
      background: #ff0000;
      color: #fff;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button:disabled { opacity: 0.5; }
    button.secondary { background: #333; }
    .btn-small { padding: 8px 12px; font-size: 12px; }
    .video-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .video-card { 
      background: #222; 
      border-radius: 8px; 
      overflow: hidden;
      border: 1px solid #333;
    }
    .video-card video { width: 100%; aspect-ratio: 9/16; background: #000; }
    .video-info { padding: 10px; }
    .video-title { font-size: 12px; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .video-meta { font-size: 11px; color: #888; }
    .video-actions { display: flex; gap: 5px; padding: 10px; padding-top: 0; }
    .video-actions button { flex: 1; padding: 8px; font-size: 11px; }
    .badge { 
      display: inline-block;
      padding: 3px 8px; 
      border-radius: 4px; 
      font-size: 11px;
      background: #444;
    }
    .badge.ready { background: #22c55e; }
    .badge.uploaded { background: #3b82f6; }
    .badge.scheduled { background: #f59e0b; }
    .tabs { display: flex; gap: 5px; margin-bottom: 15px; overflow-x: auto; }
    .tab { 
      flex: 1;
      padding: 12px; 
      background: #222; 
      border: none; 
      color: #888;
      border-radius: 8px;
      font-size: 13px;
      white-space: nowrap;
    }
    .tab.active { background: #ff0000; color: #fff; }
    .audio-list { max-height: 300px; overflow-y: auto; }
    .audio-item { 
      display: flex; 
      align-items: center; 
      gap: 10px; 
      padding: 10px; 
      background: #222;
      border-radius: 8px;
      margin-bottom: 8px;
    }
    .audio-item button { padding: 6px 10px; font-size: 11px; }
    .loading { text-align: center; padding: 20px; color: #888; }
    .notification {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: #fff;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    }
    .notification.success { background: #22c55e; }
    .notification.error { background: #ef4444; }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .hidden { display: none !important; }
    .bulk-actions { 
      position: fixed; 
      bottom: 0; 
      left: 0; 
      right: 0; 
      background: #1a1a1a;
      padding: 15px;
      border-top: 1px solid #333;
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    select option { background: #222; }
  </style>
</head>
<body>
  <div class="header">
    <h1><span class="icon">▶</span> YouTube Automation</h1>
  </div>
  
  <div class="container">
    <div class="tabs">
      <button class="tab active" onclick="showTab('videos')">📹 ভিডিও</button>
      <button class="tab" onclick="showTab('audio')">🎵 অডিও</button>
      <button class="tab" onclick="showTab('uploaded')">✅ আপলোড</button>
    </div>
    
    <div id="videos-tab">
      <div class="card">
        <div class="card-title">📥 ভিডিও ডাউনলোড</div>
        <div id="url-inputs">
          <div class="input-group">
            <input type="text" class="video-url" placeholder="YouTube/TikTok URL...">
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="secondary" onclick="addUrlInput()">+ আরো URL</button>
          <button onclick="downloadVideos()" id="download-btn">ডাউনলোড</button>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">📹 আমার ভিডিও <span id="video-count"></span></div>
        <div id="video-list" class="video-grid"></div>
      </div>
    </div>
    
    <div id="audio-tab" class="hidden">
      <div class="card">
        <div class="card-title">🎵 অডিও আপলোড</div>
        <input type="file" id="audio-file" accept="audio/*" style="display:none">
        <button onclick="document.getElementById('audio-file').click()">📁 ফাইল নির্বাচন</button>
        <div class="input-group" style="margin-top:10px;">
          <input type="text" id="yt-audio-url" placeholder="YouTube URL থেকে অডিও নিন...">
          <button onclick="downloadAudio()">ডাউনলোড</button>
        </div>
      </div>
      
      <div class="card">
        <div class="card-title">🎶 অডিও লিস্ট</div>
        <div id="audio-list" class="audio-list"></div>
      </div>
    </div>
    
    <div id="uploaded-tab" class="hidden">
      <div class="card">
        <div class="card-title">✅ আপলোড করা ভিডিও</div>
        <div id="uploaded-list" class="video-grid"></div>
      </div>
    </div>
  </div>
  
  <div id="bulk-actions" class="bulk-actions hidden">
    <button onclick="uploadSelected()">📤 YouTube-এ আপলোড</button>
    <button class="secondary" onclick="uploadZipToDrive()">☁️ Drive-এ জিপ</button>
    <button class="secondary" onclick="clearSelection()">❌ বাতিল</button>
  </div>

  <script>
    let videos = [];
    let audios = [];
    let selectedVideos = new Set();
    let currentTab = 'videos';
    
    function showTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      
      document.getElementById('videos-tab').classList.add('hidden');
      document.getElementById('audio-tab').classList.add('hidden');
      document.getElementById('uploaded-tab').classList.add('hidden');
      document.getElementById(tab + '-tab').classList.remove('hidden');
      
      currentTab = tab;
      if (tab === 'videos') loadVideos();
      if (tab === 'audio') loadAudios();
      if (tab === 'uploaded') loadUploaded();
    }
    
    function notify(message, type = 'success') {
      const div = document.createElement('div');
      div.className = 'notification ' + type;
      div.textContent = message;
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 3000);
    }
    
    function addUrlInput() {
      const div = document.createElement('div');
      div.className = 'input-group';
      div.innerHTML = '<input type="text" class="video-url" placeholder="YouTube/TikTok URL...">';
      document.getElementById('url-inputs').appendChild(div);
    }
    
    async function downloadVideos() {
      const urls = Array.from(document.querySelectorAll('.video-url'))
        .map(i => i.value.trim()).filter(v => v);
      
      if (urls.length === 0) return notify('অন্তত একটি URL দিন', 'error');
      
      const btn = document.getElementById('download-btn');
      btn.disabled = true;
      btn.textContent = 'ডাউনলোড হচ্ছে...';
      
      for (const url of urls) {
        try {
          const res = await fetch('/api/videos/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, mute: true })
          });
          const data = await res.json();
          if (data.success) {
            videos.push(data.video);
            notify('ভিডিও ডাউনলোড সম্পন্ন!');
          }
        } catch (err) {
          notify('ডাউনলোড ব্যর্থ: ' + url, 'error');
        }
      }
      
      btn.disabled = false;
      btn.textContent = 'ডাউনলোড';
      document.getElementById('url-inputs').innerHTML = '<div class="input-group"><input type="text" class="video-url" placeholder="YouTube/TikTok URL..."></div>';
      renderVideos();
    }
    
    function renderVideos() {
      const readyVideos = videos.filter(v => v.status === 'ready' || v.status === 'downloaded');
      document.getElementById('video-count').textContent = '(' + readyVideos.length + ')';
      
      const container = document.getElementById('video-list');
      if (readyVideos.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">কোনো ভিডিও নেই</div>';
        return;
      }
      
      container.innerHTML = readyVideos.map(v => \`
        <div class="video-card">
          <video src="/\${v.processedPath}" muted loop playsinline 
            onclick="this.paused ? this.play() : this.pause()"></video>
          <div class="video-info">
            <div class="video-title">\${v.title}</div>
            <div class="video-meta">
              <span class="badge \${v.status}">\${v.status}</span>
              \${formatDuration(v.metadata?.duration)} | \${formatSize(v.metadata?.size)}
            </div>
          </div>
          <div class="video-actions">
            <button onclick="toggleSelect('\${v.id}')" class="btn-small \${selectedVideos.has(v.id) ? 'secondary' : ''}">
              \${selectedVideos.has(v.id) ? '✓' : '☐'}
            </button>
            <button onclick="showAudioSelect('\${v.id}')" class="btn-small secondary">🎵</button>
            <button onclick="uploadVideo('\${v.id}')" class="btn-small">▶</button>
            <button onclick="deleteVideo('\${v.id}')" class="btn-small secondary">🗑</button>
          </div>
        </div>
      \`).join('');
      
      document.getElementById('bulk-actions').classList.toggle('hidden', selectedVideos.size === 0);
    }
    
    function toggleSelect(id) {
      if (selectedVideos.has(id)) selectedVideos.delete(id);
      else selectedVideos.add(id);
      renderVideos();
    }
    
    function clearSelection() {
      selectedVideos.clear();
      renderVideos();
    }
    
    function showAudioSelect(videoId) {
      if (audios.length === 0) return notify('প্রথমে অডিও আপলোড করুন', 'error');
      
      const audioId = prompt('অডিও নির্বাচন করুন (ID):\\n' + 
        audios.map((a, i) => \`\${i+1}. \${a.name} (\${formatDuration(a.duration)})\`).join('\\n'));
      
      if (audioId) mergeAudio(videoId, audios[parseInt(audioId)-1]?.id);
    }
    
    async function mergeAudio(videoId, audioId) {
      if (!audioId) return;
      try {
        const res = await fetch(\`/api/videos/\${videoId}/merge\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioId, loop: true })
        });
        const data = await res.json();
        if (data.success) {
          const idx = videos.findIndex(v => v.id === videoId);
          if (idx >= 0) videos[idx] = data.video;
          notify('অডিও যোগ সম্পন্ন!');
          renderVideos();
        }
      } catch (err) {
        notify('অডিও যোগ ব্যর্থ', 'error');
      }
    }
    
    async function uploadVideo(id) {
      try {
        notify('আপলোড হচ্ছে...');
        const res = await fetch(\`/api/upload/youtube/\${id}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ autoGenerateContent: true })
        });
        const data = await res.json();
        if (data.success) {
          const idx = videos.findIndex(v => v.id === id);
          if (idx >= 0) videos[idx].status = 'uploaded';
          notify('YouTube-এ আপলোড সম্পন্ন!');
          renderVideos();
        } else {
          notify(data.error || 'আপলোড ব্যর্থ', 'error');
        }
      } catch (err) {
        notify('আপলোড ব্যর্থ: ' + err.message, 'error');
      }
    }
    
    async function uploadSelected() {
      for (const id of selectedVideos) {
        await uploadVideo(id);
      }
      selectedVideos.clear();
      renderVideos();
    }
    
    async function uploadZipToDrive() {
      try {
        notify('জিপ তৈরি হচ্ছে...');
        const res = await fetch('/api/upload/drive/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoIds: Array.from(selectedVideos), zipName: 'my_videos' })
        });
        const data = await res.json();
        if (data.success) {
          notify('Drive-ে আপলোড সম্পন্ন! লিংক: ' + data.result.webLink);
        } else {
          notify(data.error || 'আপলোড ব্যর্থ', 'error');
        }
      } catch (err) {
        notify('আপলোড ব্যর্থ', 'error');
      }
    }
    
    async function deleteVideo(id) {
      if (!confirm('মুছে ফেলবেন?')) return;
      try {
        await fetch(\`/api/videos/\${id}\`, { method: 'DELETE' });
        videos = videos.filter(v => v.id !== id);
        notify('মুছে ফেলা হয়েছে');
        renderVideos();
      } catch (err) {
        notify('মুছতে ব্যর্থ', 'error');
      }
    }
    
    async function loadVideos() {
      try {
        const res = await fetch('/api/videos?status=ready');
        const data = await res.json();
        if (data.success) videos = data.videos;
        renderVideos();
      } catch (err) {
        console.error('Load videos failed:', err);
      }
    }
    
    // Audio functions
    document.getElementById('audio-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('name', file.name.replace(/\.[^/.]+$/, ''));
      
      try {
        const res = await fetch('/api/audio/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          audios.push(data.audio);
          notify('অডিও আপলোড সম্পন্ন!');
          renderAudios();
        }
      } catch (err) {
        notify('আপলোড ব্যর্থ', 'error');
      }
    });
    
    async function downloadAudio() {
      const url = document.getElementById('yt-audio-url').value.trim();
      if (!url) return notify('URL দিন', 'error');
      
      try {
        const res = await fetch('/api/audio/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
          audios.push(data.audio);
          notify('অডিও ডাউনলোড সম্পন্ন!');
          document.getElementById('yt-audio-url').value = '';
          renderAudios();
        }
      } catch (err) {
        notify('ডাউনলোড ব্যর্থ', 'error');
      }
    }
    
    function renderAudios() {
      const container = document.getElementById('audio-list');
      if (audios.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">কোনো অডিও নেই</div>';
        return;
      }
      
      container.innerHTML = audios.map(a => \`
        <div class="audio-item">
          <button onclick="playAudio('\${a.id}')" class="btn-small">▶</button>
          <div style="flex:1;">
            <div style="font-size:13px;">\${a.name}</div>
            <div style="font-size:11px;color:#888;">\${formatDuration(a.duration)}</div>
          </div>
          <button onclick="deleteAudio('\${a.id}')" class="btn-small secondary">🗑</button>
          <audio id="audio-\${a.id}" src="/\${a.localPath}"></audio>
        </div>
      \`).join('');
    }
    
    function playAudio(id) {
      const audio = document.getElementById('audio-' + id);
      if (audio.paused) audio.play();
      else audio.pause();
    }
    
    async function deleteAudio(id) {
      if (!confirm('মুছে ফেলবেন?')) return;
      try {
        await fetch(\`/api/audio/\${id}\`, { method: 'DELETE' });
        audios = audios.filter(a => a.id !== id);
        notify('মুছে ফেলা হয়েছে');
        renderAudios();
      } catch (err) {
        notify('মুছতে ব্যর্থ', 'error');
      }
    }
    
    async function loadAudios() {
      try {
        const res = await fetch('/api/audio');
        const data = await res.json();
        if (data.success) audios = data.audio;
        renderAudios();
      } catch (err) {
        console.error('Load audios failed:', err);
      }
    }
    
    async function loadUploaded() {
      try {
        const res = await fetch('/api/videos?status=uploaded');
        const data = await res.json();
        const uploadedVideos = data.videos || [];
        
        const container = document.getElementById('uploaded-list');
        if (uploadedVideos.length === 0) {
          container.innerHTML = '<div style="text-align:center;color:#888;padding:30px;">কোনো আপলোড করা ভিডিও নেই</div>';
          return;
        }
        
        container.innerHTML = uploadedVideos.map(v => \`
          <div class="video-card">
            <video src="/\${v.processedPath}" muted loop playsinline
              onclick="this.paused ? this.play() : this.pause()"></video>
            <div class="video-info">
              <div class="video-title">\${v.title}</div>
              <div class="video-meta">
                <span class="badge uploaded">uploaded</span>
                \${v.uploadInfo?.youtubeVideoId ? 
                  '<a href="https://youtube.com/shorts/' + v.uploadInfo.youtubeVideoId + '" target="_blank" style="color:#3b82f6;">YouTube-এ দেখুন</a>' : ''}
              </div>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Load uploaded failed:', err);
      }
    }
    
    function formatDuration(sec) {
      if (!sec) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + s.toString().padStart(2, '0');
    }
    
    function formatSize(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let size = bytes;
      let i = 0;
      while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
      return size.toFixed(1) + ' ' + units[i];
    }
    
    // Initial load
    loadVideos();
    loadAudios();
  </script>
</body>
</html>
  `);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
