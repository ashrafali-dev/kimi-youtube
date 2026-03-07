# YouTube Automation Tool

সহজ এবং Railway-ফ্রেন্ডলি YouTube অটোমেশন টুল। TikTok/YouTube থেকে ভিডিও ডাউনলোড, অডিও যোগ, এবং সরাসরি YouTube-ে আপলোড করুন।

## ⚡ দ্রুত স্টার্ট (Railway)

### ধাপ ১: GitHub-ে আপলোড করুন

```bash
# নতুন GitHub রিপোজিটরি তৈরি করুন
# তারপর এই ফাইলগুলো আপলোড করুন:
- server.js
- package.json
- Procfile
- railway.json
- .env.example
```

### ধাপ ২: Railway-তে ডিপ্লয়

1. https://railway.app এ লগইন করুন
2. "New Project" → "Deploy from GitHub repo"
3. আপনার রিপোজিটরি নির্বাচন করুন
4. "Deploy" ক্লিক করুন

### ধাপ ৩: Environment Variables সেট করুন

Railway Dashboard → Variables ট্যাবে যোগ করুন:

```
GEMINI_API_KEY=your_gemini_api_key
YOUTUBE_CLIENT_ID=your_youtube_client_id
YOUTUBE_CLIENT_SECRET=your_youtube_client_secret
YOUTUBE_REDIRECT_URI=https://your-app.up.railway.app/api/youtube/callback
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://your-app.up.railway.app/api/drive/callback
```

## 📱 মোবাইলে ব্যবহার

আপনার Railway URL-এ গিয়ে ব্যবহার করুন:
```
https://your-app.up.railway.app
```

## 🔑 API কী সংগ্রহ

### ১. Gemini API Key
1. https://makersuite.google.com/app/apikey এ যান
2. "Create API Key" ক্লিক করুন
3. কপি করে Railway Variables-এ পেস্ট করুন

### ২. YouTube OAuth
1. https://console.cloud.google.com/ এ যান
2. New Project → APIs & Services → Credentials
3. Create Credentials → OAuth 2.0 Client ID
4. Authorized redirect URIs:
   - `https://your-app.up.railway.app/api/youtube/callback`

### ৩. Google Drive OAuth
1. Google Cloud Console-এ যান
2. APIs & Services → Enable APIs → Google Drive API
3. Credentials → Create Credentials → OAuth 2.0 Client ID

## 📂 ফাইল স্ট্রাকচার

```
youtube-automation/
├── server.js           # মূল সার্ভার (সব API এখানে)
├── package.json        # ডিপেন্ডেন্সি
├── Procfile           # Railway প্রসেস ফাইল
├── railway.json       # Railway কনফিগ
├── .env.example       # এনভায়রনমেন্ট উদাহরণ
└── README.md          # এই ফাইল
```

## 🚀 ফিচারস

### ✅ ভিডিও ডাউনলোড
- TikTok, YouTube, Instagram, Facebook সাপোর্ট
- একসাথে একাধিক ভিডিও ডাউনলোড
- অটো মিউট
- প্রিভিউ দেখুন

### ✅ অডিও ম্যানেজমেন্ট
- লোকাল ফাইল আপলোড
- YouTube থেকে অডিও ডাউনলোড
- ভিডিওতে অডিও যোগ করুন

### ✅ AI কন্টেন্ট
- Gemini AI দিয়ে টাইটেল, ডেসক্রিপশন, ট্যাগস তৈরি
- বাংলা ভাষা সাপোর্ট

### ✅ আপলোড
- সরাসরি YouTube-ে আপলোড
- Google Drive-ে জিপ ফাইল আপলোড
- বাল্ক আপলোড

## 🔧 API এন্ডপয়েন্টস

```
POST   /api/videos/download         # ভিডিও ডাউনলোড
POST   /api/videos/download/bulk    # বাল্ক ডাউনলোড
GET    /api/videos                  # সব ভিডিও
POST   /api/videos/:id/merge        # অডিও যোগ
DELETE /api/videos/:id              # ভিডিও মুছুন

POST   /api/audio/upload            # অডিও আপলোড
POST   /api/audio/download          # YouTube থেকে অডিও
GET    /api/audio                   # সব অডিও

GET    /api/upload/youtube/auth     # YouTube OAuth
POST   /api/upload/youtube/:id      # YouTube-এ আপলোড
POST   /api/upload/drive/zip        # Drive-এ জিপ আপলোড

POST   /api/ai/generate             # AI কন্টেন্ট
```

## 🐛 ট্রাবলশুটিং

### সমস্যা: "ENOENT: ffmpeg not found"
**সমাধান:** Railway-তে ffmpeg অটো ইনস্টল হয়। লocally চালাতে:
```bash
# Ubuntu/Debian
sudo apt-get install ffmpeg

# macOS
brew install ffmpeg
```

### সমস্যা: "yt-dlp not found"
**সমাধান:** `yt-dlp-wrap` প্যাকেজ অটো yt-dlp ইনস্টল করে।

### সমস্যা: YouTube OAuth কাজ করছে না
**সমাধান:** 
1. Google Cloud Console-ে redirect URI চেক করুন
2. `https://` দিয়ে শুরু হয়েছে কিনা দেখুন
3. URL-এ কোনো `/` মিসিং নেই তো চেক করুন

## 📞 সাপোর্ট

প্রশ্ন থাকলে GitHub Issues-এ জানান।

---

**Made with ❤️ for Bangladeshi Content Creators**
