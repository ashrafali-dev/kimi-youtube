# 🎬 YouTube Automation Pro

TikTok/YouTube থেকে বাল্ক ভিডিও ডাউনলোড করুন, AI দিয়ে SEO টাইটেল/হ্যাশট্যাগ জেনারেট করুন, এবং অটো আপলোড করুন।

## ✨ ফিচার সমূহ

- **বাল্ক ডাউনলোড** - একসাথে ৪০টি TikTok/YouTube লিংক
- **অটো মিউট** - ভিডিও ডাউনলোড হলেই মিউট হয়ে যাবে
- **অডিও লাইব্রেরি** - নিজের অডিও বা YouTube Shorts থেকে অডিও নিন
- **AI মেটা** - Gemini/Grok/GPT-4 দিয়ে অনন্য টাইটেল, হ্যাশট্যাগ, SEO ট্যাগ
- **YouTube আপলোড** - এক ক্লিকে আপলোড, প্রাইভেসি কন্ট্রোল
- **Google Drive ZIP** - সিলেক্ট করা ভিডিও ZIP করে Drive-এ পাঠান
- **অটো শিডিউল** - প্রতিদিন নির্দিষ্ট সময়ে অটো আপলোড
- **Mobile Optimized** - মোবাইলে সম্পূর্ণ কাজ করা যায়

## 🚀 Railway Deploy

### ধাপ ১: GitHub Repo তৈরি
\`\`\`bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/yt-automation.git
git push -u origin main
\`\`\`

### ধাপ ২: Railway Setup
1. [railway.app](https://railway.app) এ যান
2. **New Project → Deploy from GitHub repo** সিলেক্ট করুন
3. আপনার repo সিলেক্ট করুন
4. **Variables** ট্যাবে `.env.example` থেকে variables যোগ করুন

### ধাপ ৩: Frontend Deploy
`public/index.html` ফাইলটি Railway app-এর `public` ফোল্ডারে রাখুন।

## 📁 ফাইল স্ট্রাকচার
\`\`\`
├── server.js          # Backend API
├── package.json       # Dependencies
├── nixpacks.toml      # Railway build config (ffmpeg, yt-dlp)
├── railway.toml       # Railway deploy config
├── .env.example       # Environment variables template
└── public/
    └── index.html     # Frontend UI
\`\`\`

## 🔑 API Keys

| সার্ভিস | কোথায় পাবেন |
|--------|------------|
| Gemini | [aistudio.google.com](https://aistudio.google.com) |
| Grok | [console.x.ai](https://console.x.ai) |
| YouTube OAuth | [console.cloud.google.com](https://console.cloud.google.com) |
| Google Drive | [console.cloud.google.com](https://console.cloud.google.com) |

## ⚙️ YouTube OAuth Setup

1. Google Cloud Console → **APIs & Services → Credentials**
2. **Create OAuth 2.0 Client ID** → Application type: Web
3. Authorized redirect URIs: `https://YOUR-APP.up.railway.app/auth/youtube/callback`
4. Client ID এবং Secret Railway Variables-এ যোগ করুন

## 📱 ব্যবহার

1. **ডাউনলোড ট্যাব** → TikTok/YouTube লিংক পেস্ট করুন → বাল্ক ডাউনলোড
2. **অডিও ট্যাব** → অডিও যোগ করুন বা YouTube Shorts থেকে নিন
3. **ভিডিও ট্যাব** → ভিডিও সিলেক্ট করুন → অডিও যোগ করুন
4. **AI ট্যাব** → AI দিয়ে টাইটেল/হ্যাশট্যাগ জেনারেট করুন
5. **আপলোড ট্যাব** → YouTube-এ আপলোড বা ZIP করে Drive-এ পাঠান
6. **শিডিউল ট্যাব** → অটো আপলোড সময় সেট করুন

## 🛠️ Local Development

\`\`\`bash
npm install
pip install yt-dlp
# Linux/Mac: sudo apt install ffmpeg / brew install ffmpeg
cp .env.example .env
# .env ফাইলে API keys দিন
node server.js
\`\`\`
