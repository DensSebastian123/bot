const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running! 🚀');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Web server listening on port ${port}`);
    });
}
module.exports = app;

require('dotenv').config();
const qrcode = require('qrcode-terminal');
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const gTTS = require('gtts');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { GoogleGenAI } = require('@google/genai');

// Set ffmpeg path for fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// Initialize the WhatsApp client with LocalAuth to persist session across restarts
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    }
});

// Offline Mode flag
let isOfflineMode = false;

// Simple Database for Reminders and Auto Replies
const DB_FILE = path.join(__dirname, 'database.json');
let db = { reminders: {}, autoReplies: {} };

try {
    if (fs.existsSync(DB_FILE)) {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } else {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    }
} catch (error) {
    console.error('Failed to load database.json:', error);
}

function saveDB() {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const INTRO_MESSAGE = `
╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮
   ✨ *DENS'S ASSISTANT* ✨
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯

👋 *Hello there! / നമസ്കാരം!*
I am an Advanced WhatsApp AI created by *Dens Sebastian*. 👨‍💻

*🌟 WHAT I CAN DO:*
🤖 *AI Chat:* Ask me anything!
🎙️ *Voice AI:* Send a voice note, I'll reply
🌤️ *Tools:* Weather, News, Crypto, Wikipedia
🔗 *Utils:* Shorten URLs, QR Codes, YT Audio
🎬 *Entertainment:* Movies, Jokes, Facts, Images

*🚀 HOW TO USE ME:*
🔹 *Private Chat:* Use \`!\` (e.g., \`!weather London\`)
🔹 *Group Chat:* Just \`@mention\` me!
🔹 *Voice:* Send me a Voice Note anytime! 🎙️

💬 Type *!help* to see all my features!`;

// Generate and display the QR code
client.on('qr', (qr) => {
    console.log('Scan the QR code below to log in:');
    qrcode.generate(qr, { small: true });
});

// Log a message when the client is authenticated
client.on('authenticated', () => {
    console.log('Client is authenticated!');
});

// Log a message when the client is ready
client.on('ready', () => {
    console.log('WhatsApp bot is ready and listening for messages!');
});

// Handle incoming messages
client.on('message', async (message) => {
    const isGroup = message.from.endsWith('@g.us');
    let body = message.body.trim();

    // Check if the bot is mentioned
    let isMentioned = false;
    if (client.info && client.info.wid) {
        const botId = client.info.wid._serialized;
        isMentioned = message.mentionedIds && message.mentionedIds.includes(botId);
    }

    const exactMatchTrigger = db.autoReplies[body.toLowerCase()];
    const isVoiceNote = message.hasMedia && (message.type === 'ptt' || message.type === 'audio');

    // In groups, require the bot to be mentioned OR for the user to use the '!' prefix directly OR it matches an auto-reply
    // We also allow Voice Notes to pass through for automatic transcription!
    if (isGroup && !isMentioned && !body.startsWith('!') && !exactMatchTrigger && !isVoiceNote) {
        return;
    }

    // Process auto-reply if matched
    if (exactMatchTrigger && !body.startsWith('!')) {
        if (isOfflineMode) return;
        return message.reply(exactMatchTrigger);
    }

    // Check for incoming Voice Messages (Process natively without prefix!)
    // Now enabled globally for Live Transcription
    if (isVoiceNote) {
        if (isOfflineMode) {
            if (!isGroup) return message.reply('⚠️ *Service Offline:* The bot is currently under maintenance. Please try again later! 🛠️');
            return;
        }
        try {
            if (!isGroup) await message.reply('🎧 *Transcribing your voice message...* ✍️');
            const media = await message.downloadMedia();
            
            const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
            const aiResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        inlineData: {
                            data: media.data,
                            mimeType: media.mimetype.split(';')[0]
                        }
                    },
                    "You are an advanced audio transcriber. Listen to the user's voice message and write down EXACTLY what they said (in the same language they spoke). If they ask a question or need assistance, provide a highly realistic, conversational, and human-like response below the transcription. Do not sound like an AI. Act like a casual human friend. Format it like this:\n\n🎙️ *Transcription:*\n[Exact words spoken]\n\n👤 *Reply:*\n[Your human-like response, if applicable]"
                ]
            });
            const replyText = aiResponse.text.trim();
            await message.reply(replyText);
            
            // Extract the reply part for TTS if formatted with "Reply:"
            const replyMatch = replyText.match(/Reply:\*\n([\s\S]*)/);
            let textToSpeak = replyMatch ? replyMatch[1].trim() : replyText;
            const cleanText = textToSpeak.replace(/[\u{1F600}-\u{1F6FF}*_]/gu, '').trim();
            
            if (cleanText.length > 0 && cleanText.length < 300) {
                const isMalayalam = /[\u0D00-\u0D7F]/.test(cleanText);
                const lang = isMalayalam ? 'ml' : 'en';
                const tts = new gTTS(cleanText, lang);
                const tempFilePath = path.join(__dirname, `chatvoice_${Date.now()}.mp3`);
                tts.save(tempFilePath, async (err) => {
                    if (!err) {
                        const media = MessageMedia.fromFilePath(tempFilePath);
                        await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
                        fs.unlinkSync(tempFilePath);
                    }
                });
            }
            return;
        } catch (e) {
            console.error('Audio AI Error:', e);
            if (!isGroup) return message.reply('❌ *Error:* Could not transcribe the voice note.');
            return;
        }
    }
    
    // Define the command prefix (e.g., '!')
    const PREFIX = '!';

    // If the bot is mentioned, strip the mention text from the body to get the actual command
    if (isMentioned && client.info) {
        const mentionRegex = new RegExp(`@${client.info.wid.user}\\s*`, 'g');
        body = body.replace(mentionRegex, '').trim();
    }
    
    // Check if the body starts with the prefix
    const hasPrefix = body.startsWith(PREFIX);
    let command = '';
    let args = [];

    if (hasPrefix) {
        body = body.slice(PREFIX.length).trim();
        args = body.split(/ +/);
        command = args.shift().toLowerCase();
    } else {
        if (!isGroup || (isGroup && isMentioned)) {
            // It's a natural conversation! Treat it as a chat.
            command = 'natural_chat';
        } else {
            return; // Ignore normal group chat without mentions/commands
        }
    }

    console.log(`[${new Date().toLocaleTimeString()}] Message from ${message.from}: ${message.body}`);

    // Toggle Offline Mode
    if (command === 'toggleoffline') {
        isOfflineMode = !isOfflineMode;
        return message.reply(`⚙️ *Maintenance Mode* is now ${isOfflineMode ? 'ON (Bot is sleeping 💤)' : 'OFF (Bot is active ⚡)'}`);
    }

    // Check if bot is offline
    if (isOfflineMode) {
        return message.reply('⚠️ *Service Offline:* The bot is currently under maintenance or the server is down. Please try again later! 🛠️');
    }

    try {
        // --- 1. Basic Greetings & Information ---
        if (['hello', 'hi', 'hai', 'hey', 'start'].includes(command)) {
            await message.reply(INTRO_MESSAGE);
        
        } else if (['bye', 'goodbye', 'cya'].includes(command)) {
            await message.reply('👋 *Goodbye!* Have an amazing day ahead! 🌟');
            
        } else if (['help', 'commands', 'menu'].includes(command)) {
            const helpText = `
╭━━━━━━━━━━━━━━━━━━━━━━━━━━╮
   📋 *COMMAND CENTER* 📋
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯

⚙️ *GENERAL*
▫️ *!hello* - Greet the bot 👋
▫️ *!ping* - Check my speed ⚡
▫️ *!time* / *!date* - Live Clock ⏰
▫️ *!toggleoffline* - Maintenance Mode 💤

🎨 *MEDIA & FUN*
▫️ *!imagine <prompt>* - AI Image Generator 🎨
▫️ *!lyrics <song>* - Get song lyrics 🎶
▫️ *!image* - Beautiful random picture 🖼️
▫️ *!sticker* - Reply to image for sticker ✨
▫️ *!joke* - Programming humor 😂
▫️ *!quote* - Inspiring thoughts 💭
▫️ *!fact* - Random knowledge 🧠

🤖 *AI & ML*
▫️ *!ai <text>* - Ask the AI anything!
▫️ *!aivoice <text>* - AI voice reply 🎙️
▫️ *(Send Voice Note)* - Native AI listening!
▫️ *!translate <text>* - English to Malayalam 🔤
▫️ *!recipe <dish>* - AI Chef 👨‍🍳

🧠 *MEMORY & AUTOMATION*
▫️ *!remember <key> | <val>* - Save info 💾
▫️ *!recall <key>* - Fetch info 💡
▫️ *!forget <key>* - Delete info 🗑️
▫️ *!setauto <trigger> | <reply>* - Auto-reply 🤖
▫️ *!delauto <trigger>* - Delete auto-reply ❌

🌴 *KERALA SPECIALS*
▫️ *!keralanews* - Top local news 📰
▫️ *!kerala* - Explore God's Own Country ✨
▫️ *!ml <text>* - Chat with AI in Malayalam 🗣️
▫️ *!mlvoice <text>* - Malayalam Voice Note 🎙️
▫️ *!dialogue* - Iconic Malayalam Dialogues 🎬
▫️ *!keralarecipe <dish>* - Kerala style recipes 🍛

🛠️ *UTILITIES & INFO*
▫️ *!calc <math>* - Quick calculator 🧮
▫️ *!dict <word>* - Dictionary meaning 📖
▫️ *!weather <city>* - Live weather 🌤️
▫️ *!github <user>* - GitHub profile info 💻
▫️ *!crypto <coin>* - Live coin prices 📈
▫️ *!movie <title>* - Movie details 🎬
▫️ *!wiki <topic>* - Quick Wikipedia summary 📚
▫️ *!screenshot <url>* - Capture website 📸
▫️ *!tts <text>* - Text to Voice 🗣️
▫️ *!ytdl <url>* - YT Audio Downloader 🎵
▫️ *!qr <text>* - Custom QR Generator 📱
▫️ *!shorten <url>* - Link shortener 🔗
▫️ *!news* - Top Global Tech News 🌍
▫️ *!location* - Beautiful destinations ✈️

━━━━━━━━━━━━━━━━━━━━━━
👨‍💻 _Developed by Dens Sebastian_
            `;
            await message.reply(helpText);

        } else if (['ping', 'speed', 'latency'].includes(command)) {
            const start = Date.now();
            await message.reply('🏓 *Pong!* Testing connection...');
            const latency = Date.now() - start;
            await message.reply(`⚡ *Latency:* ${latency}ms\n🟢 *Status:* Excellent`);
            
        } else if (['time', 'clock'].includes(command)) {
            const time = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: true });
            await message.reply(`⏰ *Current Time:* ${time}`);

        } else if (['date', 'today'].includes(command)) {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const date = new Date().toLocaleDateString('en-US', options);
            await message.reply(`📅 *Today's Date:* ${date}`);

        // --- 2. Advanced Media Features ---
        } else if (command === 'tts') {
            const textToSpeak = args.join(' ');
            if (!textToSpeak) {
                return message.reply('🎙️ *Please provide some text!* \nExample: *!tts Hello everyone!*');
            }
            const tts = new gTTS(textToSpeak, 'en');
            const tempFilePath = path.join(__dirname, `tts_${Date.now()}.mp3`);
            
            tts.save(tempFilePath, async (err) => {
                if (err) {
                    console.error('TTS Error:', err);
                    return message.reply('😔 *Sorry!* I could not generate the voice note at this moment. Please try again later.');
                }
                const media = MessageMedia.fromFilePath(tempFilePath);
                await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
                fs.unlinkSync(tempFilePath); // Cleanup
            });

        } else if (command === 'ytdl') {
            const videoUrl = args[0];
            if (!videoUrl || !ytdl.validateURL(videoUrl)) {
                return message.reply('🎵 *Oops! That link does not look right.*\nPlease provide a valid YouTube link.\nExample: *!ytdl https://youtu.be/...*');
            }

            await message.reply('⏳ *Downloading audio...* This might take a moment. Grab a coffee! ☕🎶');
            const stream = ytdl(videoUrl, { quality: 'highestaudio' });
            const outputFilePath = path.join(__dirname, `yt_${Date.now()}.mp3`);

            ffmpeg(stream)
                .audioBitrate(128)
                .save(outputFilePath)
                .on('end', async () => {
                    try {
                        const media = MessageMedia.fromFilePath(outputFilePath);
                        await client.sendMessage(message.from, media, { sendMediaAsDocument: true, caption: '🎵 *Here is your audio!* Enjoy!' });
                    } catch (err) {
                        message.reply('❌ *Error:* Failed to send the audio file. It might be too large.');
                    } finally {
                        if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
                    }
                })
                .on('error', (err) => {
                    console.error('YouTube DL Error:', err);
                    message.reply('❌ *Service Offline:* Video download failed. The service might be temporarily unavailable.');
                    if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath);
                });

        } else if (command === 'qr') {
            const text = args.join(' ');
            if (!text) return message.reply('📱 *Please tell me what to turn into a QR Code!*\nExample: *!qr https://google.com*');
            
            await message.reply('⏳ *Generating your custom QR Code...* 🎨');
            try {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(text)}`;
                const media = await MessageMedia.fromUrl(qrUrl);
                await client.sendMessage(message.from, media, { caption: '📱 *Here is your custom QR Code!*' });
            } catch (e) {
                await message.reply('😔 *Sorry!* I could not generate the QR code right now.');
            }

        } else if (['image', 'pic', 'picture'].includes(command)) {
            try {
                const response = await axios.get('https://source.unsplash.com/random/800x600', { responseType: 'arraybuffer' });
                const media = new MessageMedia('image/jpeg', Buffer.from(response.data).toString('base64'), 'random.jpg');
                await client.sendMessage(message.from, media, { caption: '🖼️ *Here is a beautiful random image for you!*' });
            } catch (error) {
                await message.reply('😔 *Sorry!* The image server is taking a nap. Try again later!');
            }

        } else if (['sticker', 'makesticker'].includes(command)) {
            if (message.hasQuotedMsg) {
                const quotedMsg = await message.getQuotedMessage();
                if (quotedMsg.hasMedia) {
                    const media = await quotedMsg.downloadMedia();
                    return await client.sendMessage(message.from, media, { sendMediaAsSticker: true });
                }
            } else if (message.hasMedia) {
                const media = await message.downloadMedia();
                return await client.sendMessage(message.from, media, { sendMediaAsSticker: true });
            }
            await message.reply('🖼️ *Oops! You forgot the image.*\nPlease send this command with an image attached, or reply to an existing image to turn it into a sticker! ✨');

        } else if (['screenshot', 'screen'].includes(command)) {
            let url = args[0];
            if (!url) return message.reply('📸 *Which website should I capture?*\nExample: *!screenshot google.com*');
            if (!url.startsWith('http')) url = 'https://' + url;

            await message.reply('📸 *Capturing screenshot...* Please wait! 🌐');
            try {
                const browser = await puppeteer.launch({ 
                    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
                });
                const page = await browser.newPage();
                await page.setViewport({ width: 1280, height: 800 });
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
                
                const screenshotPath = path.join(__dirname, `ss_${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: false });
                await browser.close();
                
                const media = MessageMedia.fromFilePath(screenshotPath);
                await client.sendMessage(message.from, media, { caption: `🌐 *Screenshot of:* ${url}` });
                fs.unlinkSync(screenshotPath); // Cleanup
            } catch (error) {
                console.error('Screenshot error:', error);
                await message.reply('❌ *Service Offline:* Failed to capture screenshot. The website might be down or protecting against bots.');
            }

        // --- 3. APIs Integration & Utilities ---
        } else if (command === 'shorten') {
            const url = args[0];
            if (!url) return message.reply('🔗 *Please provide a URL to shorten!*\nExample: *!shorten https://verylongwebsite.com*');
            try {
                const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
                await message.reply(`🔗 *Here is your shortened URL:*\n${response.data}`);
            } catch (e) {
                await message.reply('😔 *Sorry!* The URL shortener service is currently down.');
            }

        } else if (command === 'news') {
            await message.reply('📰 *Fetching top tech news...*');
            try {
                const topStories = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json');
                const storyIds = topStories.data.slice(0, 5); // Get top 5 stories
                let newsText = '🌍 *Latest Tech News:*\n\n';
                for (let i = 0; i < storyIds.length; i++) {
                    const story = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${storyIds[i]}.json`);
                    newsText += `${i + 1}. *${story.data.title}*\n🔗 ${story.data.url || 'No link'}\n\n`;
                }
                await message.reply(newsText.trim());
            } catch (e) {
                await message.reply('❌ *Service Offline:* News service is currently unreachable.');
            }

        } else if (command === 'fact') {
            try {
                const response = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random');
                await message.reply(`🧠 *Did you know?*\n\n${response.data.text}`);
            } catch (e) {
                await message.reply('❌ *Service Offline:* Fact service is currently unreachable.');
            }

        } else if (command === 'weather') {
            const city = args.join(' ');
            if (!city) return message.reply('🌤️ *Which city would you like to check?*\nExample: *!weather London*');
            
            try {
                const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
                await message.reply(`🌤️ *Weather Report*\n\n📍 ${response.data}`);
            } catch (error) {
                await message.reply(`😔 *Sorry!* I could not find the weather for ${city}. Make sure the spelling is correct.`);
            }

        } else if (['quote', 'inspire'].includes(command)) {
            try {
                const response = await axios.get('https://api.quotable.io/random');
                const quote = response.data;
                await message.reply(`✨ *Thought of the day:*\n\n"${quote.content}"\n\n— _${quote.author}_`);
            } catch (error) {
                await message.reply('❌ *Service Offline:* Could not fetch a quote right now.');
            }

        } else if (['joke', 'funny'].includes(command)) {
            const jokes = [
                "Why do programmers prefer dark mode?\nBecause light attracts bugs! 🐛",
                "How many programmers does it take to change a light bulb?\nNone, that's a hardware problem! 💡",
                "Why did the developer go broke?\nBecause he used up all his cache! 💸",
                "I would tell you a UDP joke, but you might not get it. 📡",
                "A SQL query goes into a bar, walks up to two tables and asks...\n'Can I join you?' 🍻"
            ];
            const randomJoke = jokes[Math.floor(Math.random() * jokes.length)];
            await message.reply(`😂 *Here's a joke for you:*\n\n${randomJoke}`);

        } else if (['location', 'place'].includes(command)) {
            const locationInfo = `
🌍 *Top Places to Visit:*
1. 🗼 Paris, France
2. 🗻 Tokyo, Japan
3. 🗽 New York, USA
4. 🏖️ Maldives
            `;
            try {
                const response = await axios.get('https://source.unsplash.com/random/800x600/?travel,landscape', { responseType: 'arraybuffer' });
                const media = new MessageMedia('image/jpeg', Buffer.from(response.data).toString('base64'), 'travel.jpg');
                await client.sendMessage(message.from, media, { caption: '✈️ *Random Beautiful Destination*' });
            } catch (e) {
                await message.reply('❌ *Service Offline:* Failed to load location image.');
            }
            await message.reply(locationInfo);

        } else if (command === 'github') {
            const username = args[0];
            if (!username) return message.reply('💻 *Whose profile should I fetch?*\nExample: *!github octocat*');
            try {
                const response = await axios.get(`https://api.github.com/users/${username}`);
                const data = response.data;
                const profile = `
💻 *GitHub Profile: ${data.login}*

👤 *Name:* ${data.name || 'Not provided'}
📝 *Bio:* ${data.bio || 'No bio available'}
👥 *Followers:* ${data.followers} | *Following:* ${data.following}
📦 *Public Repos:* ${data.public_repos}
📍 *Location:* ${data.location || 'Unknown'}
🔗 *Link:* ${data.html_url}
                `;
                await message.reply(profile.trim());
            } catch (error) {
                await message.reply(`😔 *Sorry!* Could not find a GitHub user named ${username}.`);
            }

        } else if (['crypto', 'coin', 'price'].includes(command)) {
            const coin = args[0]?.toLowerCase();
            if (!coin) return message.reply('📈 *Which crypto price do you want?*\nExample: *!crypto bitcoin*');
            try {
                const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd,inr`);
                const data = response.data[coin];
                if (!data) return message.reply(`❌ Could not find price for *${coin}*. Check the spelling.`);
                await message.reply(`📈 *${coin.toUpperCase()} Price:*\n\n💵 USD: $${data.usd}\n🇮🇳 INR: ₹${data.inr}`);
            } catch (error) {
                await message.reply('❌ *Service Offline:* Could not fetch crypto prices.');
            }

        } else if (['movie', 'film'].includes(command)) {
            const movie = args.join(' ');
            if (!movie) return message.reply('🎬 *Which movie details do you want?*\nExample: *!movie Inception*');
            await message.reply('🎬 *Searching for movie details...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Provide details for the movie "${movie}". Include the release year, director, main cast, IMDB rating (approximate if exact isn't known), and a short 2-sentence synopsis. Format nicely with emojis.`,
                });
                await message.reply(`🎬 *Movie Info: ${movie}*\n\n${aiResponse.text.trim()}`);
            } catch (error) {
                await message.reply('❌ *Error:* Could not fetch movie info.');
            }

        } else if (['wiki', 'wikipedia'].includes(command)) {
            const topic = args.join(' ');
            if (!topic) return message.reply('📚 *What topic do you want to learn about?*\nExample: *!wiki Black Hole*');
            await message.reply('📚 *Searching Wikipedia...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Provide a short, easy-to-understand summary of "${topic}" like a Wikipedia intro. Keep it under 100 words.`,
                });
                await message.reply(`📚 *Wiki Summary: ${topic}*\n\n${aiResponse.text.trim()}`);
            } catch (error) {
                await message.reply('❌ *Error:* Could not fetch summary.');
            }

        } else if (command === 'calc') {
            const expression = args.join('');
            if (!expression) return message.reply('🧮 *What should I calculate?*\nExample: *!calc 5+5* or *!calc 100/4*');
            try {
                const response = await axios.get(`https://api.mathjs.org/v4/?expr=${encodeURIComponent(expression)}`);
                await message.reply(`🧮 *Result:*\n\n${expression} = *${response.data}*`);
            } catch (error) {
                await message.reply('❌ *Error:* Invalid math expression.');
            }

        } else if (['dict', 'meaning'].includes(command)) {
            const word = args[0];
            if (!word) return message.reply('📖 *Which word should I look up?*\nExample: *!dict serendipity*');
            try {
                const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
                const data = response.data[0];
                let reply = `📖 *Dictionary: ${data.word}*\n`;
                if (data.phonetic) reply += `🗣️ ${data.phonetic}\n\n`;
                data.meanings.slice(0, 2).forEach(m => {
                    reply += `*${m.partOfSpeech}*\n`;
                    reply += `🔹 ${m.definitions[0].definition}\n\n`;
                });
                await message.reply(reply.trim());
            } catch (error) {
                await message.reply(`❌ *Sorry!* I couldn't find the meaning of *${word}*.`);
            }

        } else if (['imagine', 'draw'].includes(command)) {
            const prompt = args.join(' ');
            if (!prompt) return message.reply('🎨 *What should I draw?*\nExample: *!imagine a futuristic city at sunset*');
            await message.reply('🎨 *Painting your imagination...* This might take a few seconds. ⏳');
            try {
                const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
                const media = await MessageMedia.fromUrl(imageUrl);
                await client.sendMessage(message.from, media, { caption: `🎨 *Prompt:* ${prompt}` });
            } catch (error) {
                await message.reply('❌ *Error:* Could not generate the image. The service might be busy.');
            }

        } else if (command === 'lyrics') {
            const song = args.join(' ');
            if (!song) return message.reply('🎶 *Which song lyrics do you want?*\nExample: *!lyrics Shape of You*');
            await message.reply('🎶 *Finding lyrics...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Provide the full lyrics for the song "${song}". Start directly with the lyrics, no introduction.`,
                });
                await message.reply(`🎶 *Lyrics: ${song}*\n\n${aiResponse.text.trim()}`);
            } catch (error) {
                await message.reply('❌ *Error:* Could not find lyrics for this song.');
            }

        // --- 4. Memory & Auto-Reply ---
        } else if (command === 'remember') {
            const parts = args.join(' ').split('|');
            if (parts.length < 2) return message.reply('📝 *Usage:* !remember <key> | <value>\nExample: *!remember wifi | 12345678*');
            
            const key = parts[0].trim().toLowerCase();
            const value = parts.slice(1).join('|').trim();
            const userId = message.from;
            
            if (!db.reminders[userId]) db.reminders[userId] = {};
            db.reminders[userId][key] = value;
            saveDB();
            
            await message.reply(`✅ *Remembered!*\nKey: *${key}*\nValue: *${value}*`);

        } else if (command === 'recall') {
            const key = args.join(' ').trim().toLowerCase();
            if (!key) return message.reply('📝 *Usage:* !recall <key>\nExample: *!recall wifi*');
            
            const userId = message.from;
            if (db.reminders[userId] && db.reminders[userId][key]) {
                await message.reply(`💡 *Memory recalled:*\n\n${db.reminders[userId][key]}`);
            } else {
                await message.reply(`❌ I don't have anything saved for *${key}*.`);
            }

        } else if (command === 'forget') {
            const key = args.join(' ').trim().toLowerCase();
            if (!key) return message.reply('📝 *Usage:* !forget <key>\nExample: *!forget wifi*');
            
            const userId = message.from;
            if (db.reminders[userId] && db.reminders[userId][key]) {
                delete db.reminders[userId][key];
                saveDB();
                await message.reply(`🗑️ *Forgot* the memory for *${key}*.`);
            } else {
                await message.reply(`❌ I don't have anything saved for *${key}*.`);
            }

        } else if (command === 'setauto') {
            const parts = args.join(' ').split('|');
            if (parts.length < 2) return message.reply('📝 *Usage:* !setauto <trigger> | <reply>\nExample: *!setauto hi bot | Hello there!*');
            
            const trigger = parts[0].trim().toLowerCase();
            const replyText = parts.slice(1).join('|').trim();
            
            db.autoReplies[trigger] = replyText;
            saveDB();
            
            await message.reply(`✅ *Auto-reply set!*\nWhen someone says: *${trigger}*\nI will reply: *${replyText}*`);

        } else if (command === 'delauto') {
            const trigger = args.join(' ').trim().toLowerCase();
            if (!trigger) return message.reply('📝 *Usage:* !delauto <trigger>\nExample: *!delauto hi bot*');
            
            if (db.autoReplies[trigger]) {
                delete db.autoReplies[trigger];
                saveDB();
                await message.reply(`🗑️ *Deleted* the auto-reply for *${trigger}*.`);
            } else {
                await message.reply(`❌ No auto-reply found for *${trigger}*.`);
            }

        // --- 5. Kerala Specials & Extra Features ---
        } else if (command === 'keralanews') {
            await message.reply('📰 *Fetching top Kerala news...* (വാർത്തകൾ)');
            try {
                const Parser = require('rss-parser');
                const parser = new Parser();
                // Using Malayalam Google News for Kerala
                const feed = await parser.parseURL('https://news.google.com/rss/search?q=Kerala&hl=ml&gl=IN&ceid=IN:ml');
                let newsText = '🌴 *Latest Kerala News:*\n\n';
                for (let i = 0; i < Math.min(5, feed.items.length); i++) {
                    const item = feed.items[i];
                    newsText += `${i + 1}. *${item.title}*\n🔗 ${item.link}\n\n`;
                }
                await message.reply(newsText.trim());
            } catch (e) {
                console.error('Kerala News Error:', e);
                await message.reply('❌ *Service Offline:* News service is currently unreachable.');
            }

        } else if (command === 'kerala') {
            const places = [
                "Munnar - The Kashmir of South India ☕",
                "Alleppey - The Venice of the East 🛶",
                "Wayanad - Nature's Abode 🌲",
                "Kochi - Queen of the Arabian Sea 🛳️",
                "Kumarakom - A tranquil backwater destination 🌿",
                "Varkala - Beautiful cliff beaches 🏖️",
                "Thekkady - Home to Periyar National Park 🐘"
            ];
            const facts = [
                "Kerala is known as 'God's Own Country' (ദൈവത്തിന്റെ സ്വന്തം നാട്).",
                "Kerala has the highest literacy rate in India.",
                "Ayurveda is widely practiced as a mainstream medical system in Kerala.",
                "Kerala is the spice capital of India.",
                "Elephants are highly respected and are the state animal of Kerala."
            ];
            
            let text = `🌴 *Welcome to Kerala (കേരളം)!*\n\n`;
            text += `✨ *Random Fact:*\n${facts[Math.floor(Math.random() * facts.length)]}\n\n`;
            text += `🌍 *Top Places to Visit:*\n${places.join('\n')}\n`;
            
            try {
                const response = await axios.get('https://source.unsplash.com/random/800x600/?kerala,nature', { responseType: 'arraybuffer' });
                const media = new MessageMedia('image/jpeg', Buffer.from(response.data).toString('base64'), 'kerala.jpg');
                await client.sendMessage(message.from, media, { caption: text });
            } catch (e) {
                await message.reply(text);
            }
            
        } else if (command === 'ml') {
            const prompt = args.join(' ');
            if (!prompt) return message.reply('❌ *Usage:* !ml <your question in English or Malayalam>');
            await message.reply('🧠 *ചിന്തിക്കുന്നു... (Thinking...)*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `You are a friendly Malayali WhatsApp bot. Answer the following question entirely in Malayalam language (Malayalam script). Keep it natural, casual, and helpful: ${prompt}`,
                });
                await message.reply(`🗣️ *AI (Malayalam):*\n\n${aiResponse.text.trim()}`);
            } catch (e) {
                await message.reply('❌ *Error:* Could not fetch Malayalam response.');
            }

        } else if (command === 'mlvoice') {
            const textToSpeak = args.join(' ');
            if (!textToSpeak) return message.reply('🎙️ *എന്ത് പറയണം? (What should I say?)* \nExample: *!mlvoice സുഖമാണോ?*');
            
            const tts = new gTTS(textToSpeak, 'ml');
            const tempFilePath = path.join(__dirname, `mlvoice_${Date.now()}.mp3`);
            
            tts.save(tempFilePath, async (err) => {
                if (err) return message.reply('😔 *Sorry!* I could not generate the Malayalam voice note.');
                const media = MessageMedia.fromFilePath(tempFilePath);
                await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
                fs.unlinkSync(tempFilePath);
            });

        } else if (['dialogue', 'troll'].includes(command)) {
            const dialogues = [
                "സാധനം കയ്യിലുണ്ടോ? 💼",
                "പോ മോനെ ദിനേശാ! 😎",
                "ഓർമ്മയുണ്ടോ ഈ മുഖം? 😠",
                "ചിരിക്കണ്ട, ഞാൻ മരിക്കും! 😂",
                "തോമസ്കുട്ടി വിട്ടോടാ! 🏃‍♂️",
                "എനിക്കിതൊന്നും കേൾക്കണ്ടേ! 🙉",
                "അശോകന് ക്ഷീണമാകും! 😌",
                "ഇതൊക്കെ എന്ത്! 🤷‍♂️",
                "അങ്ങനെ പവനായി ശവമായി! 💀",
                "സെൻസെക്സ് താഴോട്ടാണല്ലോ! 📉"
            ];
            const randomDialogue = dialogues[Math.floor(Math.random() * dialogues.length)];
            await message.reply(`🎬 *Iconic Malayalam Dialogue:*\n\n${randomDialogue}`);

        } else if (command === 'keralarecipe') {
            const dish = args.join(' ');
            if (!dish) return message.reply('🍛 *ഏത് ഭക്ഷണത്തിന്റെ റെസിപ്പി ആണ് വേണ്ടത്?*\nExample: *!keralarecipe Beef Roast*');
            
            await message.reply('👨‍🍳 *രുചികരമായ റെസിപ്പി തിരയുന്നു...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Give me a traditional authentic Kerala style recipe for "${dish}". Write the entire response strictly in Malayalam language (Malayalam script). Include ingredients and step-by-step preparation. Keep it under 200 words. Format nicely with emojis.`,
                });
                await message.reply(`🍛 *കേരള റെസിപ്പി: ${dish}*\n\n${aiResponse.text.trim()}`);
            } catch (e) {
                await message.reply('❌ *Error:* Could not fetch recipe.');
            }
        } else if (command === 'translate') {
            const textToTranslate = args.join(' ');
            if (!textToTranslate) return message.reply('🔤 *What should I translate?*\nExample: *!translate How are you?*');
            
            await message.reply('🔄 *Translating to Malayalam...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Translate the following text to Malayalam. Return ONLY the Malayalam translation, without any explanations:\n\n${textToTranslate}`,
                });
                await message.reply(`🔤 *Translation (Malayalam):*\n\n${aiResponse.text.trim()}`);
            } catch (e) {
                await message.reply('❌ *Error:* Translation failed.');
            }

        } else if (command === 'recipe') {
            const dish = args.join(' ');
            if (!dish) return message.reply('🍲 *Which recipe do you want?*\nExample: *!recipe Chicken Biryani*');
            
            await message.reply('👨‍🍳 *Finding the best recipe...*');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `Give me a short, easy to follow recipe for ${dish}. Include ingredients and steps. Keep it under 150 words. Format it beautifully with emojis.`,
                });
                await message.reply(`🍲 *Recipe: ${dish}*\n\n${aiResponse.text.trim()}`);
            } catch (e) {
                await message.reply('❌ *Error:* Could not fetch recipe.');
            }

        // --- 5. Machine Learning & AI ---
        } else if (command === 'aivoice') {
            const prompt = args.join(' ');
            if (!prompt) return message.reply('❌ *Usage:* !aivoice <your question or prompt>');
            
            await message.reply('🧠 *Thinking and recording voice...* 🎙️');
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt + " (Please provide a highly conversational, human-like response under 50 words so it sounds natural when spoken aloud. Do not sound like a robot or AI assistant. Act like a real person.)",
                });
                
                const responseText = aiResponse.text;
                const tts = new gTTS(responseText, 'en');
                const tempFilePath = path.join(__dirname, `aivoice_${Date.now()}.mp3`);
                
                tts.save(tempFilePath, async (err) => {
                    if (err) {
                        return message.reply('❌ *Service Offline:* Could not generate voice at this moment.');
                    }
                    const media = MessageMedia.fromFilePath(tempFilePath);
                    await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
                    fs.unlinkSync(tempFilePath); // Cleanup
                });
            } catch (e) {
                console.error('AI Voice Error:', e);
                await message.reply('❌ *Service Offline:* The AI model is currently unreachable.');
            }

        } else {
            // Default to AI for any unrecognized commands or natural chat
            let prompt = hasPrefix ? body : message.body.trim();
            if (isMentioned && client.info) {
                const mentionRegex = new RegExp(`@${client.info.wid.user}\\s*`, 'g');
                prompt = prompt.replace(mentionRegex, '').trim();
            }
            
            // Remove 'ai' or 'ask' if the user still uses the old command structure
            if (prompt.toLowerCase().startsWith('ai ')) prompt = prompt.slice(3).trim();
            if (prompt.toLowerCase().startsWith('ask ')) prompt = prompt.slice(4).trim();
            if (prompt.toLowerCase().startsWith('!')) prompt = prompt.slice(1).trim();
            
            if (!prompt) return;

            // If it's a simple exact greeting, we can show the beautiful intro
            if (['hi', 'hello', 'hey', 'start', 'help'].includes(prompt.toLowerCase())) {
                return message.reply(INTRO_MESSAGE);
            }

            // We removed the 'Thinking...' message to make it feel like a real instant human reply!
            try {
                const ai = new GoogleGenAI({ apiKey: 'AIzaSyBuEl4HsGkhns3kXGMgZ0P4F_6lO01wZxE' });
                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: `You are a real human friend chatting on WhatsApp. Your name is Dens's Assistant. You must act entirely human. Be casual, friendly, use emojis naturally, make jokes, use occasional slang, and keep your messages concise like a text message. Never say "As an AI" or mention that you are an AI. Never sound overly formal. Respond to this message:\n\n${prompt}`,
                });
                const replyText = aiResponse.text.trim();
                await message.reply(replyText); // Send reply naturally without formatting prefix
                
                // Voice Reply Logic
                const cleanText = replyText.replace(/[\u{1F600}-\u{1F6FF}*_]/gu, '').trim(); // Strip emojis and markdown
                if (cleanText.length > 0 && cleanText.length < 300) { // Limit length so TTS doesn't fail
                    const isMalayalam = /[\u0D00-\u0D7F]/.test(cleanText);
                    const lang = isMalayalam ? 'ml' : 'en';
                    
                    const tts = new gTTS(cleanText, lang);
                    const tempFilePath = path.join(__dirname, `chatvoice_${Date.now()}.mp3`);
                    tts.save(tempFilePath, async (err) => {
                        if (!err) {
                            const media = MessageMedia.fromFilePath(tempFilePath);
                            await client.sendMessage(message.from, media, { sendAudioAsVoice: true });
                            fs.unlinkSync(tempFilePath);
                        }
                    });
                }
            } catch (e) {
                console.error('AI Error:', e);
                await message.reply('❌ *Service Offline:* The AI model is currently unreachable.');
            }
        }

    } catch (error) {
        console.error('Error handling message:', error);
        await message.reply('❌ *Server Error:* An unexpected error occurred. The bot might be experiencing technical issues.');
    }
});

// Handle bot being added to groups
client.on('group_join', async (notification) => {
    // If client info is not available, we can't reliably check
    if (!client.info || !client.info.wid) return;
    
    const botId = client.info.wid._serialized;
    
    // Check if the bot itself was added to the group
    if (notification.recipientIds && notification.recipientIds.includes(botId)) {
        try {
            const chat = await notification.getChat();
            await chat.sendMessage(INTRO_MESSAGE);
        } catch (error) {
            console.error('Failed to send intro to new group:', error);
        }
    }
});

// Process Unhandled Promise Rejections
process.on('unhandledRejection', error => {
    console.error('Unhandled Rejection:', error);
});

// Start the client
client.initialize();