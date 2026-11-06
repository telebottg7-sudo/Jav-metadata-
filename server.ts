import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

interface BotConfig {
  botToken: string;
  botUsername: string;
  lastChatId: string;
  defaultUploadChannel: string;
  dumpChannel: string;
  screenshotChannel: string;
  mode: 'copy_to_all' | 'append_suffix' | 'watermark' | 'javdb_metadata';
  customSuffix: string;
  watermarkText: string;
  autoHashtags: boolean;
  enabled: boolean;
  deliveryMethod: 'both' | 'channel_edit' | 'resend_album';
}

function loadConfigFromFile(): BotConfig {
  const defaultConfig: BotConfig = {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    botUsername: '',
    lastChatId: '',
    defaultUploadChannel: '',
    dumpChannel: '',
    screenshotChannel: '',
    mode: 'javdb_metadata',
    customSuffix: '\n\n✨ <i>Synced via MediaGroup Bot</i>',
    watermarkText: '@MyChannel',
    autoHashtags: true,
    enabled: false,
    deliveryMethod: 'both',
  };

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load bot_config.json:', e);
  }
  return defaultConfig;
}

function saveConfigToFile(cfg: BotConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save bot_config.json:', e);
  }
}

let currentConfig: BotConfig = loadConfigFromFile();

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  details: string;
  mediaGroupId?: string;
}

const botLogs: LogEntry[] = [
  {
    id: 'log-init',
    timestamp: new Date().toLocaleTimeString(),
    type: 'INFO',
    details: 'System ready. Enter your Telegram Bot Token and click "Start Bot (Long Polling)".',
  }
];

function addLog(type: LogEntry['type'], details: string, mediaGroupId?: string) {
  botLogs.unshift({
    id: 'log-' + Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toLocaleTimeString(),
    type,
    details,
    mediaGroupId
  });
  if (botLogs.length > 80) botLogs.pop();
}

// Media group buffer item structure
interface BufferedMediaGroup {
  chatId: number | string;
  isChannel: boolean;
  items: Array<{
    messageId: number;
    type: 'photo' | 'video' | 'document';
    fileId: string;
    caption?: string;
  }>;
  detectedCaption: string;
  timer: NodeJS.Timeout;
}

const activeMediaGroups = new Map<string, BufferedMediaGroup>();

interface JavMovieData {
  code: string;
  title: string;
  actress: string;
  date: string;
  coverUrl: string;
  samples: string[];
  movieUrl: string;
  description: string;
}

async function scrapeJavDatabase(rawCode: string): Promise<JavMovieData | null> {
  const code = rawCode.trim().toUpperCase();
  const directSlug = code.toLowerCase();
  const directUrl = `https://www.javdatabase.com/movies/${directSlug}/`;
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://www.javdatabase.com/'
  };

  try {
    let res = await fetch(directUrl, { headers });
    let targetUrl = directUrl;

    if (!res.ok || res.status === 404) {
      const searchUrl = `https://www.javdatabase.com/?s=${encodeURIComponent(code)}`;
      const searchRes = await fetch(searchUrl, { headers });
      if (!searchRes.ok) return null;
      const searchHtml = await searchRes.text();
      const matchLink = searchHtml.match(/href="(https:\/\/www\.javdatabase\.com\/movies\/[a-z0-9-]+(?:\/)?)"/i);
      if (!matchLink) return null;
      targetUrl = matchLink[1];
      res = await fetch(targetUrl, { headers });
      if (!res.ok) return null;
    }

    const html = await res.text();

    // Extract cover image
    let coverUrl = '';
    const ogImageMatch = html.match(/<meta\s+(?:property|name)="(?:og:image|twitter:image)"\s+content="([^"]+)"/i);
    if (ogImageMatch) {
      coverUrl = ogImageMatch[1];
    } else {
      const coverMatch = html.match(/https:\/\/(?:pics\.dmm\.co\.jp|www\.javdatabase\.com\/covers\/full)[^"'\s)]+/i);
      if (coverMatch) {
        coverUrl = coverMatch[0];
      }
    }

    // Extract title
    let title = code;
    const customTitleMatch = html.match(/<b>Title:\s*<\/b>\s*([^<]+)/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (customTitleMatch) {
      title = customTitleMatch[1].replace(/^[A-Za-z0-9_-]+\s*-\s*/, '').trim();
    } else {
      const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
      if (ogTitleMatch) {
        title = ogTitleMatch[1].replace(/\s*-\s*JAV Database\s*$/i, '').trim();
      }
    }

    // Extract actress
    let actress = '';
    const idolMatch = html.match(/href="https:\/\/www\.javdatabase\.com\/idols\/[^"]+">([^<]+)<\/a>/i);
    if (idolMatch) {
      actress = idolMatch[1].trim();
    } else {
      const featuredMatch = html.match(/([^<]+?)\s+is the featured actress in the JAV movie/i);
      if (featuredMatch) {
        actress = featuredMatch[1].trim();
      } else {
        const titleParts = title.split(' - ');
        if (titleParts.length >= 2) {
          actress = titleParts[1].trim();
        }
      }
    }

    // Extract release date
    let date = '';
    const dateMatch = html.match(/<meta\s+property="og:updated_time"\s+content="([^"T]+)/i) || html.match(/Release Date:[^<]*<[^>]+>([^<]+)/i);
    if (dateMatch) {
      date = dateMatch[1].trim();
    }

    // Extract sample preview screenshots (Strictly High Quality 'jp' images, deduplicated)
    const sampleMatches = html.matchAll(/https:\/\/pics\.dmm\.co\.jp\/digital\/video\/[a-z0-9_/-]+\.jpg/gi);
    const rawSet = new Set<string>();
    for (const m of sampleMatches) {
      const url = m[0];
      if (!url.endsWith('pl.jpg') && !url.endsWith('ps.jpg')) {
        rawSet.add(url);
      }
    }

    const allUrls = Array.from(rawSet);
    const hqUrls = allUrls.filter(u => /jp-\d+\.jpg$/i.test(u));
    const samples = (hqUrls.length > 0 ? hqUrls : allUrls).slice(0, 10);

    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
    const description = descMatch ? descMatch[1] : '';

    return {
      code,
      title,
      actress,
      date,
      coverUrl,
      samples,
      movieUrl: targetUrl,
      description
    };
  } catch (err) {
    console.error('scrapeJavDatabase error:', err);
    return null;
  }
}

export function extractJavCodesFromText(text: string): string[] {
  if (!text) return [];
  // Master regex matching all JAV video code patterns from logs, reports, missing metadata lists, or messages
  // Matches e.g.: BACJ-141, MTALL-152, WO-020, 3DS-001, FC2-PPV-123456, BACJ141, T-28001
  const masterRegex = /\b(?:FC2[-_]?(?:PPV[-_]?)?\d{5,7}|[0-9]{1,3}[A-Za-z]{2,6}[-_]?\d{2,5}|[A-Za-z]{1,6}[-_]\d{2,7}|[A-Za-z]{2,6}\d{2,5})\b/gi;
  const matches = text.match(masterRegex) || [];
  const uniqueCodes = new Set<string>();
  for (const m of matches) {
    const code = m.trim().toUpperCase();
    if (code.length >= 4 && /\d/.test(code)) {
      uniqueCodes.add(code);
    }
  }
  return Array.from(uniqueCodes);
}

export async function sendPreviewScreenshotsAlbum(token: string, chatId: string | number, videoCode: string, samples: string[]): Promise<boolean> {
  if (!samples || samples.length === 0) return false;

  const maxSamples = samples.slice(0, 10);
  const formData = new FormData();
  formData.append('chat_id', String(chatId));

  const mediaList: any[] = [];

  for (let i = 0; i < maxSamples.length; i++) {
    const sUrl = maxSamples[i];
    try {
      const imgRes = await fetch(sUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.javdatabase.com/'
        }
      });
      if (imgRes.ok) {
        const arrayBuf = await imgRes.arrayBuffer();
        const blob = new Blob([arrayBuf], { type: 'image/jpeg' });
        const attachName = `photo${i}`;
        formData.append(attachName, blob, `sample_${i + 1}.jpg`);

        // Attach video code caption to EVERY photo in the album
        const mediaItem: any = {
          type: 'photo',
          media: `attach://${attachName}`,
          caption: videoCode,
          parse_mode: 'HTML'
        };
        mediaList.push(mediaItem);
      }
    } catch (err: any) {
      console.warn(`Failed to fetch sample screenshot #${i + 1}:`, err.message);
    }
  }

  if (mediaList.length === 0) return false;

  formData.append('media', JSON.stringify(mediaList));

  try {
    const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
      method: 'POST',
      body: formData
    });
    const sendData = await sendRes.json() as any;
    return sendData.ok;
  } catch (err: any) {
    console.error('sendPreviewScreenshotsAlbum error:', err.message);
    return false;
  }
}

// Long Polling Bot Runner State
class TelegramPollingBot {
  public isRunning = false;
  public botInfo: { id: number; first_name: string; username: string } | null = null;
  public stats = {
    pollCount: 0,
    updatesReceived: 0,
    albumsSynced: 0,
    errors: 0,
    lastPollTime: '',
    lastStatus: 'Stopped'
  };
  private currentOffset = 0;
  private abortController: AbortController | null = null;

  async start(token: string) {
    if (this.isRunning) {
      await this.stop();
    }

    if (!token || !token.includes(':')) {
      throw new Error('Invalid bot token format.');
    }

    // 1. Verify token via getMe
    addLog('INFO', 'Verifying bot token with Telegram API...');
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meRes.json() as any;

    if (!meData.ok) {
      throw new Error(`Telegram error: ${meData.description || 'Unauthorized'}`);
    }

    this.botInfo = meData.result;
    currentConfig.botUsername = `@${this.botInfo?.username || 'UnknownBot'}`;
    currentConfig.enabled = true;

    // 2. Register native Telegram slash commands menu
    try {
      const commandsPayload = [
        { command: 'start', description: 'Show welcome guide & active settings' },
        { command: 'get', description: 'Fetch & upload thumbnail by code (e.g. /get ROYD-143)' },
        { command: 'sc', description: 'Download & upload sample screenshots (e.g. /sc ROYD-143)' },
        { command: 'scbulk', description: 'Bulk download & upload sample screenshot albums' },
        { command: 'bulk', description: 'Parse missing metadata log & bulk upload thumbnails' },
        { command: 'setchannel', description: 'Set default upload channel (e.g. /setchannel @MyChannel)' },
        { command: 'channel', description: 'View current upload channel' },
        { command: 'setdump', description: 'Set dump channel for captioned videos (e.g. /setdump @DumpChannel)' },
        { command: 'dumpchannel', description: 'View current dump channel' },
        { command: 'setscreenshot', description: 'Set screenshot channel (e.g. /setscreenshot @ScreenshotChannel)' },
        { command: 'screenshotchannel', description: 'View current screenshot channel' },
        { command: 'status', description: 'View live bot telemetry and stats' },
        { command: 'mode', description: 'View or change caption sync mode' },
        { command: 'help', description: 'View command usage reference' }
      ];
      await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commands: commandsPayload })
      });
      addLog('INFO', 'Registered slash commands with Telegram setMyCommands API.');
    } catch (cmdErr: any) {
      console.warn('setMyCommands error:', cmdErr.message);
    }

    // 3. Clear any lingering webhook so long polling works smoothly
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
      addLog('INFO', 'Webhook cleared. Switched to Long Polling mode.');
    } catch (e: any) {
      console.warn('Webhook delete warning:', e.message);
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.stats.lastStatus = 'Active & Polling';
    addLog('SUCCESS', `Bot started successfully as ${currentConfig.botUsername} (ID: ${this.botInfo?.id}) via Long Polling!`);

    // Start background loop
    this.pollLoop(token);
  }

  async stop() {
    this.isRunning = false;
    this.stats.lastStatus = 'Stopped';
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    currentConfig.enabled = false;
    addLog('INFO', 'Bot polling stopped.');
  }

  private async pollLoop(token: string) {
    while (this.isRunning) {
      try {
        this.stats.pollCount++;
        this.stats.lastPollTime = new Date().toLocaleTimeString();

        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.currentOffset}&timeout=15&allowed_updates=["message","channel_post"]`;
        const res = await fetch(url, {
          signal: this.abortController?.signal
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json() as any;

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            this.currentOffset = Math.max(this.currentOffset, update.update_id + 1);
            this.stats.updatesReceived++;
            await this.handleUpdate(token, update);
          }
        } else if (!data.ok) {
          addLog('WARN', `getUpdates error: ${data.description}`);
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || !this.isRunning) {
          break;
        }
        this.stats.errors++;
        addLog('ERROR', `Polling error: ${err.message}`);
        // brief delay before retrying
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  private async handleUpdate(token: string, update: any) {
    const msg = update.message || update.channel_post;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const isChannel = !!update.channel_post || msg.chat?.type === 'channel';
    const textRaw = msg.text ? msg.text.trim() : '';

    // Handle Telegram Slash Commands
    if (textRaw.startsWith('/')) {
      const parts = textRaw.split(/\s+/);
      const command = parts[0].toLowerCase().split('@')[0];
      const args = textRaw.substring(parts[0].length).trim();

      if (command === '/start') {
        const welcome = `👋 <b>Hello! I am ${this.botInfo?.first_name || 'JavDB Bot'}.</b>\n\n` +
          `📸 <b>Command Reference:</b>\n` +
          `• <code>/get ROYD-143</code> — Fetch post thumbnail from JavDB\n` +
          `• <code>/sc ROYD-143</code> — Fetch & upload sample preview screenshots album\n` +
          `• <code>/scbulk &lt;text_or_log&gt;</code> — Bulk upload sample screenshot albums\n` +
          `• <code>/bulk &lt;text_or_log&gt;</code> — Parse missing metadata log & bulk upload thumbnails\n` +
          `• <code>/setchannel @MyChannel</code> — Set default upload channel\n` +
          `• <code>/channel</code> — View current upload channel\n` +
          `• <code>/setdump @DumpChannel</code> — Set dump channel for captioned videos\n` +
          `• <code>/dumpchannel</code> — View current dump channel\n` +
          `• <code>/setscreenshot @ScreenshotChannel</code> — Set screenshot upload channel\n` +
          `• <code>/screenshotchannel</code> — View current screenshot channel\n` +
          `• <code>/status</code> — View live bot telemetry & stats\n` +
          `• <code>/mode</code> — View or change caption sync mode\n` +
          `• <code>/help</code> — Detailed usage instructions\n\n` +
          `⚡ <b>Auto Mode:</b> Simply send any movie code (e.g. <code>ROYD-143</code>) or paste missing metadata log directly!`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: welcome,
            parse_mode: 'HTML'
          })
        });
        addLog('INFO', `Handled /start command from chat ${chatId}`);
        return;
      }

      if (command === '/help') {
        const helpText = `📖 <b>JavDB Telegram Bot Command Guide</b>\n\n` +
          `🔹 <code>/get ROYD-143</code>\nDownloads cover thumbnail for <b>ROYD-143</b> from JavDB and uploads to this chat (and relays to default channel).\n\n` +
          `🔹 <code>/sc ROYD-143</code>\nDownloads sample preview screenshots album for <b>ROYD-143</b> from JavDB and uploads with video code as caption to this chat (and screenshot channel).\n\n` +
          `🔹 <code>/scbulk &lt;log report&gt;</code>\nExtracts all video codes from text/logs and bulk uploads full sample screenshot albums for each code.\n\n` +
          `🔹 <code>/bulk &lt;log report&gt;</code>\nExtracts all video codes (e.g. BACJ-141, MTALL-152) from text/logs and uploads all thumbnails.\n\n` +
          `🔹 <code>/setchannel @MyChannel</code>\nConfigures target Telegram channel where all downloaded thumbnails are automatically uploaded/relayed.\n\n` +
          `🔹 <code>/channel</code>\nDisplays currently configured upload channel.\n\n` +
          `🔹 <code>/setdump @DumpChannel</code>\nConfigures dump channel where all captioned videos & media will be uploaded automatically.\n\n` +
          `🔹 <code>/dumpchannel</code>\nDisplays currently configured video dump channel.\n\n` +
          `🔹 <code>/setscreenshot @ScreenshotChannel</code>\nConfigures target channel where all sample preview screenshot albums will be uploaded.\n\n` +
          `🔹 <code>/screenshotchannel</code>\nDisplays currently configured sample screenshot channel.\n\n` +
          `🔹 <code>/status</code>\nShows live system status, updates processed, and uptime.\n\n` +
          `🔹 <code>/mode &lt;javdb|copy|suffix|watermark&gt;</code>\nChanges album caption formatting mode.\n\n` +
          `💡 <i>Auto-detection is active: Sending codes without slash commands works as well!</i>`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: helpText,
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/setchannel') {
        if (args) {
          currentConfig.defaultUploadChannel = args;
          saveConfigToFile(currentConfig);
          addLog('SUCCESS', `Default upload channel updated via /setchannel command: ${args}`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>Thumbnail Upload Channel Updated!</b>\n\nAll downloaded thumbnails will now be relayed to: <code>${args}</code>`,
              parse_mode: 'HTML'
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📌 <b>Current Upload Channel:</b> <code>${currentConfig.defaultUploadChannel || 'Not set'}</code>\n\nTo set a new channel, send:\n<code>/setchannel @YourChannelName</code> or <code>/setchannel -100xxxxxxxxxx</code>`,
              parse_mode: 'HTML'
            })
          });
        }
        return;
      }

      if (command === '/channel') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📢 <b>Default Thumbnail Upload Channel:</b>\n` +
              (currentConfig.defaultUploadChannel 
                ? `<code>${currentConfig.defaultUploadChannel}</code>`
                : `<i>None configured. Use <code>/setchannel @channel_id</code> to set one!</i>`),
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/setdump') {
        if (args) {
          currentConfig.dumpChannel = args;
          saveConfigToFile(currentConfig);
          addLog('SUCCESS', `Dump channel updated via /setdump command: ${args}`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>Captioned Video Dump Channel Updated!</b>\n\nAll captioned videos will now be automatically uploaded/dumped to: <code>${args}</code>`,
              parse_mode: 'HTML'
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📺 <b>Current Video Dump Channel:</b> <code>${currentConfig.dumpChannel || 'Not set'}</code>\n\nTo set a new dump channel, send:\n<code>/setdump @YourDumpChannel</code> or <code>/setdump -100xxxxxxxxxx</code>`,
              parse_mode: 'HTML'
            })
          });
        }
        return;
      }

      if (command === '/dumpchannel') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📺 <b>Captioned Video Dump Channel:</b>\n` +
              (currentConfig.dumpChannel 
                ? `<code>${currentConfig.dumpChannel}</code>`
                : `<i>None configured. Use <code>/setdump @dump_channel</code> to set one!</i>`),
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/sc' || command === '/screenshot') {
        const rawCode = args ? args.split(/\s+/)[0] : '';
        const extractedCodes = extractJavCodesFromText(rawCode || textRaw);
        const code = extractedCodes.length > 0 ? extractedCodes[0] : rawCode.toUpperCase().trim();

        if (!code) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📷 <b>Sample Screenshots Downloader</b>\n\nUsage: <code>/sc ROYD-143</code>\n\nDownloads and uploads the preview screenshots album with video code caption to this chat (and your screenshot channel if configured).`,
              parse_mode: 'HTML'
            })
          });
          return;
        }

        addLog('INFO', `Fetching preview screenshots for ${code} in chat ${chatId}...`);
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'upload_photo' })
        });

        const movieData = await scrapeJavDatabase(code);

        if (!movieData || !movieData.samples || movieData.samples.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `❌ Could not find sample preview screenshots for <b>${code}</b> on JavDB.`,
              parse_mode: 'HTML'
            })
          });
          addLog('WARN', `No sample screenshots found for ${code} on JavDB.`);
          return;
        }

        const sentOk = await sendPreviewScreenshotsAlbum(token, chatId, code, movieData.samples);
        if (sentOk) {
          addLog('SUCCESS', `Uploaded sample screenshots album for ${code} to chat ${chatId}!`);

          // Auto-upload to screenshotChannel if set and not current chat
          if (currentConfig.screenshotChannel && currentConfig.screenshotChannel !== String(chatId)) {
            const scOk = await sendPreviewScreenshotsAlbum(token, currentConfig.screenshotChannel, code, movieData.samples);
            if (scOk) {
              addLog('SUCCESS', `Uploaded sample screenshots album for ${code} to screenshot channel ${currentConfig.screenshotChannel}`);
            }
          }
        } else {
          addLog('ERROR', `Failed to upload sample screenshots album for ${code}`);
        }
        return;
      }

      if (command === '/scbulk' || command === '/bulkscreenshot' || command === '/bulksc') {
        const allCodes = extractJavCodesFromText(args || textRaw);
        if (allCodes.length === 0) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📷 <b>Auto Bulk Screenshots Downloader</b>\n\nUsage: <code>/scbulk &lt;text_or_log_report&gt;</code>\n\nExtracts all JAV video codes from text or logs and uploads full preview screenshot albums sequentially to this chat (and your screenshot channel if configured).`,
              parse_mode: 'HTML'
            })
          });
          return;
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🚀 <b>Auto Bulk Screenshots Mode Activated!</b>\n\nExtracted <b>${allCodes.length}</b> video codes:\n<code>${allCodes.slice(0, 15).join(' ')}${allCodes.length > 15 ? '...' : ''}</code>\n\nDownloading preview screenshot albums from JavDB and uploading sequentially...`,
            parse_mode: 'HTML'
          })
        });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < allCodes.length; i++) {
          const code = allCodes[i];
          addLog('INFO', `[Bulk Screenshots ${i + 1}/${allCodes.length}] Processing preview album for ${code}...`);

          try {
            const movieData = await scrapeJavDatabase(code);
            if (movieData && movieData.samples && movieData.samples.length > 0) {
              const ok = await sendPreviewScreenshotsAlbum(token, chatId, code, movieData.samples);
              if (ok) {
                successCount++;
                addLog('SUCCESS', `[Bulk Screenshots ${i + 1}/${allCodes.length}] Uploaded preview album for ${code}.`);

                if (currentConfig.screenshotChannel && currentConfig.screenshotChannel !== String(chatId)) {
                  try {
                    await sendPreviewScreenshotsAlbum(token, currentConfig.screenshotChannel, code, movieData.samples);
                  } catch (sErr: any) {
                    console.error('Relay screenshot error:', sErr.message);
                  }
                }
              } else {
                failCount++;
              }
            } else {
              failCount++;
              addLog('WARN', `No sample screenshots found for ${code}.`);
            }
          } catch (err: any) {
            failCount++;
            addLog('ERROR', `Error in bulk screenshot for ${code}: ${err.message}`);
          }

          if (i < allCodes.length - 1) {
            await new Promise(r => setTimeout(r, 2500));
          }
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ <b>Auto Bulk Screenshots Upload Complete!</b>\n\n` +
              `📷 Successfully uploaded: <b>${successCount}</b> preview albums\n` +
              (failCount > 0 ? `⚠️ Skipped / not found: <b>${failCount}</b>\n` : '') +
              `All preview photos contain the video code caption.`,
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/setscreenshot') {
        if (args) {
          currentConfig.screenshotChannel = args;
          saveConfigToFile(currentConfig);
          addLog('SUCCESS', `Screenshot channel updated via /setscreenshot command: ${args}`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `✅ <b>Screenshot Channel Updated!</b>\n\nAll preview screenshot albums requested via <code>/sc</code> will now be uploaded to: <code>${args}</code>`,
              parse_mode: 'HTML'
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📷 <b>Current Screenshot Channel:</b> <code>${currentConfig.screenshotChannel || 'Not set'}</code>\n\nTo set a new screenshot channel, send:\n<code>/setscreenshot @YourScreenshotChannel</code> or <code>/setscreenshot -100xxxxxxxxxx</code>`,
              parse_mode: 'HTML'
            })
          });
        }
        return;
      }

      if (command === '/screenshotchannel') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📷 <b>Sample Screenshot Channel:</b>\n` +
              (currentConfig.screenshotChannel 
                ? `<code>${currentConfig.screenshotChannel}</code>`
                : `<i>None configured. Use <code>/setscreenshot @channel_id</code> to set one!</i>`),
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/status') {
        const statusText = `📊 <b>Bot Live Telemetry & Status</b>\n\n` +
          `🤖 <b>Bot Username:</b> ${currentConfig.botUsername || 'Active'}\n` +
          `🟢 <b>State:</b> ${this.stats.lastStatus}\n` +
          `🔄 <b>Polls Executed:</b> ${this.stats.pollCount}\n` +
          `📥 <b>Updates Processed:</b> ${this.stats.updatesReceived}\n` +
          `🖼️ <b>Albums Synced:</b> ${this.stats.albumsSynced}\n` +
          `📢 <b>Relay Channel:</b> <code>${currentConfig.defaultUploadChannel || 'Not set'}</code>\n` +
          `📺 <b>Dump Channel:</b> <code>${currentConfig.dumpChannel || 'Not set'}</code>\n` +
          `📷 <b>Screenshot Channel:</b> <code>${currentConfig.screenshotChannel || 'Not set'}</code>\n` +
          `⚙️ <b>Sync Mode:</b> <code>${currentConfig.mode}</code>\n` +
          `⏰ <b>Last Poll Time:</b> ${this.stats.lastPollTime}`;

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: statusText,
            parse_mode: 'HTML'
          })
        });
        return;
      }

      if (command === '/mode') {
        const validModes: Record<string, BotConfig['mode']> = {
          'javdb': 'javdb_metadata',
          'copy': 'copy_to_all',
          'suffix': 'append_suffix',
          'watermark': 'watermark'
        };

        if (args && validModes[args.toLowerCase()]) {
          currentConfig.mode = validModes[args.toLowerCase()];
          saveConfigToFile(currentConfig);
          addLog('INFO', `Sync mode updated via /mode to: ${currentConfig.mode}`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `⚙️ <b>Sync Mode Updated!</b>\n\nCurrent mode: <code>${currentConfig.mode}</code>`,
              parse_mode: 'HTML'
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `⚙️ <b>Current Sync Mode:</b> <code>${currentConfig.mode}</code>\n\n` +
                `<b>Available modes:</b>\n` +
                `• <code>/mode javdb</code> — Sync JavDB metadata & tags\n` +
                `• <code>/mode copy</code> — Copy original caption to all photos\n` +
                `• <code>/mode suffix</code> — Append custom footer text\n` +
                `• <code>/mode watermark</code> — Append channel watermark text`,
              parse_mode: 'HTML'
            })
          });
        }
        return;
      }
    }

    // Check if user sent movie code(s) or pasted a raw text/log report (Auto Bulk Mode or Single Code)
    if (msg.text && !msg.media_group_id && msg.text !== '/start') {
      const cleanText = msg.text.trim();
      const allCodes = extractJavCodesFromText(cleanText);

      // 1. AUTO BULK MODE: Multiple codes sent or extracted from log report
      if (allCodes.length > 1) {
        addLog('INFO', `Auto Bulk Mode: Extracted ${allCodes.length} codes in chat ${chatId}: ${allCodes.join(', ')}`);

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🚀 <b>Auto Bulk Mode & Log Parser Activated!</b>\n\nExtracted <b>${allCodes.length}</b> video codes from text report:\n<code>${allCodes.slice(0, 15).join(' ')}${allCodes.length > 15 ? '...' : ''}</code>\n\nDownloading thumbnails from JavDB and uploading with video code as caption...`,
            parse_mode: 'HTML'
          })
        });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < allCodes.length; i++) {
          const movieCode: string = allCodes[i];
          addLog('INFO', `[Auto Bulk ${i + 1}/${allCodes.length}] Downloading thumbnail for ${movieCode}...`);

          try {
            const movieData = await scrapeJavDatabase(movieCode);
            if (movieData && movieData.coverUrl) {
              const imgRes = await fetch(movieData.coverUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                  'Referer': 'https://www.javdatabase.com/'
                }
              });

              if (imgRes.ok) {
                const arrayBuffer = await imgRes.arrayBuffer();
                const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
                const formData = new FormData();
                formData.append('chat_id', String(chatId));
                formData.append('photo', blob, `${movieCode.toLowerCase()}_cover.jpg`);
                formData.append('caption', movieCode);

                const uploadRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                  method: 'POST',
                  body: formData
                });
                const uploadData = await uploadRes.json() as any;
                if (uploadData.ok) {
                  successCount++;
                  addLog('SUCCESS', `[Auto Bulk ${i + 1}/${allCodes.length}] Uploaded ${movieCode} thumbnail.`);

                  // Auto-relay to defaultUploadChannel if set
                  if (currentConfig.defaultUploadChannel && currentConfig.defaultUploadChannel !== String(chatId)) {
                    try {
                      const relayData = new FormData();
                      relayData.append('chat_id', currentConfig.defaultUploadChannel);
                      relayData.append('photo', blob, `${movieCode.toLowerCase()}_cover.jpg`);
                      relayData.append('caption', movieCode);

                      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                        method: 'POST',
                        body: relayData
                      });
                      addLog('SUCCESS', `Relayed ${movieCode} thumbnail to channel ${currentConfig.defaultUploadChannel}`);
                    } catch (rErr: any) {
                      console.error('Relay error:', rErr.message);
                    }
                  }
                } else {
                  failCount++;
                  addLog('WARN', `Telegram error on ${movieCode}: ${uploadData.description}`);
                }
              } else {
                failCount++;
              }
            } else {
              failCount++;
              addLog('WARN', `Movie ${movieCode} not found on JavDB.`);
            }
          } catch (err: any) {
            failCount++;
            addLog('ERROR', `Error processing ${movieCode}: ${err.message}`);
          }

          // Delay 1.8s between uploads to avoid Telegram 429 flood limits
          if (i < allCodes.length - 1) {
            await new Promise(r => setTimeout(r, 1800));
          }
        }

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ <b>Auto Bulk Upload Complete!</b>\n\n` +
              `📸 Successfully uploaded: <b>${successCount}</b> thumbnails\n` +
              (failCount > 0 ? `⚠️ Failed / not found: <b>${failCount}</b>\n` : '') +
              `All thumbnails sent with video code as caption only.`,
            parse_mode: 'HTML'
          })
        });
        return;
      }

      // 2. SINGLE CODE MODE
      if (allCodes.length === 1 && (cleanText.length < 25 || cleanText.startsWith('/'))) {
        const movieCode = allCodes[0];
        addLog('INFO', `Received request to download thumbnail for ${movieCode} in chat ${chatId}`);

        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'upload_photo' })
        });

        const movieData = await scrapeJavDatabase(movieCode);

        if (!movieData || !movieData.coverUrl) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `❌ Could not find thumbnail for <b>${movieCode}</b> on JavDB. Please verify the code (e.g. <code>ROYD-143</code>).`,
              parse_mode: 'HTML'
            })
          });
          addLog('WARN', `Movie code ${movieCode} not found on JavDB.`);
          return;
        }

        const caption = movieData.code;

        try {
          addLog('INFO', `Downloading cover thumbnail for ${movieCode}...`);
          const imgRes = await fetch(movieData.coverUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
              'Referer': 'https://www.javdatabase.com/'
            }
          });

          if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} downloading cover image`);

          const arrayBuffer = await imgRes.arrayBuffer();
          const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });

          const formData = new FormData();
          formData.append('chat_id', String(chatId));
          formData.append('photo', blob, `${movieCode.toLowerCase()}_cover.jpg`);
          formData.append('caption', caption);

          const uploadRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          const uploadData = await uploadRes.json() as any;

          if (uploadData.ok) {
            addLog('SUCCESS', `Successfully uploaded ${movieCode} cover photo to chat ${chatId}!`);

            // Auto-relay to defaultUploadChannel if set
            if (currentConfig.defaultUploadChannel && currentConfig.defaultUploadChannel !== String(chatId)) {
              try {
                const relayData = new FormData();
                relayData.append('chat_id', currentConfig.defaultUploadChannel);
                relayData.append('photo', blob, `${movieCode.toLowerCase()}_cover.jpg`);
                relayData.append('caption', caption);

                await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
                  method: 'POST',
                  body: relayData
                });
                addLog('SUCCESS', `Relayed ${movieCode} cover photo to default channel: ${currentConfig.defaultUploadChannel}`);
              } catch (rErr: any) {
                console.error('Relay error:', rErr.message);
              }
            }
          } else {
            addLog('ERROR', `sendPhoto API error: ${uploadData.description}`);
          }
        } catch (err: any) {
          addLog('ERROR', `Failed to download or upload cover: ${err.message}`);
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `${caption}\n\n🖼️ <a href="${movieData.coverUrl}">Direct Thumbnail Link</a>`,
              parse_mode: 'HTML'
            })
          });
        }
        return;
      }
    }

    // Check if message belongs to a media group (album)
    const mediaGroupId = msg.media_group_id;
    if (!mediaGroupId) {
      return;
    }

    let fileId = '';
    let mediaType: 'photo' | 'video' | 'document' = 'photo';

    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mediaType = 'photo';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mediaType = 'video';
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mediaType = 'document';
    }

    if (!fileId) return;

    const caption = msg.caption || '';

    // Buffer group
    if (!activeMediaGroups.has(mediaGroupId)) {
      addLog('INFO', `New media group detected (#${mediaGroupId}) with item #${msg.message_id}`, mediaGroupId);

      const buffer: BufferedMediaGroup = {
        chatId,
        isChannel,
        items: [{ messageId: msg.message_id, type: mediaType, fileId, caption }],
        detectedCaption: caption,
        timer: setTimeout(() => this.processMediaGroup(token, mediaGroupId), 1800)
      };

      activeMediaGroups.set(mediaGroupId, buffer);
    } else {
      const buffer = activeMediaGroups.get(mediaGroupId)!;
      buffer.items.push({ messageId: msg.message_id, type: mediaType, fileId, caption });
      if (caption && !buffer.detectedCaption) {
        buffer.detectedCaption = caption;
      }
      // Refresh the timer to allow subsequent items to arrive
      clearTimeout(buffer.timer);
      buffer.timer = setTimeout(() => this.processMediaGroup(token, mediaGroupId), 1800);
    }
  }

  private async processMediaGroup(token: string, mediaGroupId: string) {
    const group = activeMediaGroups.get(mediaGroupId);
    if (!group) return;
    activeMediaGroups.delete(mediaGroupId);

    this.stats.albumsSynced++;
    const itemCount = group.items.length;
    const rawCaption = group.detectedCaption || '';

    if (!rawCaption) {
      addLog('WARN', `Media group #${mediaGroupId} had ${itemCount} items, but no caption was found on any item.`, mediaGroupId);
      return;
    }

    // Extract video code from caption (e.g. ROYD-143, SONE-763, BACJ-141)
    const extractedCodes = extractJavCodesFromText(rawCaption);
    const videoCode = extractedCodes.length > 0 ? extractedCodes[0] : rawCaption.trim();

    // Check if media group contains a video file
    const videoItem = group.items.find(item => item.type === 'video');

    if (!videoItem) {
      addLog('WARN', `Media group #${mediaGroupId} (${itemCount} items) contains no video files. Ignoring image-only album per video-only mode.`, mediaGroupId);
      return;
    }

    // Helper function to send or copy video preserving original video thumbnail
    const sendVideoPreservingThumbnail = async (targetChatId: string | number) => {
      // 1. Try copyMessage first (preserves 100% of video's original embedded thumbnail, duration & dimensions)
      try {
        const copyRes = await fetch(`https://api.telegram.org/bot${token}/copyMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            from_chat_id: group.chatId,
            message_id: videoItem.messageId,
            caption: videoCode,
            parse_mode: 'HTML'
          })
        });
        const copyData = await copyRes.json() as any;
        if (copyData.ok) {
          return true;
        }
      } catch (cErr) {
        console.warn('copyMessage failed, falling back to sendVideo:', cErr);
      }

      // 2. Fallback to sendVideo with supports_streaming enabled
      try {
        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            video: videoItem.fileId,
            caption: videoCode,
            parse_mode: 'HTML',
            supports_streaming: true
          })
        });
        const sendData = await sendRes.json() as any;
        return sendData.ok;
      } catch (sErr) {
        console.error('sendVideo fallback failed:', sErr);
        return false;
      }
    };

    if (group.isChannel) {
      // In channel: edit the caption of the video item specifically
      try {
        await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: group.chatId,
            message_id: videoItem.messageId,
            caption: videoCode,
            parse_mode: 'HTML'
          })
        });
        addLog('SUCCESS', `Channel Album #${mediaGroupId}: Added caption "${videoCode}" strictly to video message!`, mediaGroupId);
      } catch (e: any) {
        console.error('Channel editMessageCaption error:', e.message);
      }

      // Upload captioned video to dumpChannel if configured (preserving original thumbnail)
      if (currentConfig.dumpChannel && currentConfig.dumpChannel !== String(group.chatId)) {
        const ok = await sendVideoPreservingThumbnail(currentConfig.dumpChannel);
        if (ok) {
          addLog('SUCCESS', `Uploaded captioned video ("${videoCode}") with intact thumbnail to dump channel ${currentConfig.dumpChannel}`, mediaGroupId);
        }
      }
    } else {
      // In private chat or group: Reply with ONLY the video file with caption (preserving original thumbnail)
      const ok = await sendVideoPreservingThumbnail(group.chatId);
      if (ok) {
        addLog('SUCCESS', `Replied with video file ("${videoCode}") with preserved video thumbnail to chat ${group.chatId}!`, mediaGroupId);

        // Auto-relay video file to defaultUploadChannel if configured
        if (currentConfig.defaultUploadChannel && currentConfig.defaultUploadChannel !== String(group.chatId)) {
          const relayOk = await sendVideoPreservingThumbnail(currentConfig.defaultUploadChannel);
          if (relayOk) {
            addLog('SUCCESS', `Relayed video file ("${videoCode}") with preserved thumbnail to channel ${currentConfig.defaultUploadChannel}`);
          }
        }

        // Upload captioned video to dumpChannel if configured
        if (currentConfig.dumpChannel && currentConfig.dumpChannel !== String(group.chatId)) {
          const dumpOk = await sendVideoPreservingThumbnail(currentConfig.dumpChannel);
          if (dumpOk) {
            addLog('SUCCESS', `Uploaded captioned video ("${videoCode}") with preserved thumbnail to dump channel ${currentConfig.dumpChannel}`, mediaGroupId);
          }
        }
      } else {
        addLog('WARN', `Failed to send video to chat ${group.chatId}`, mediaGroupId);
      }
    }
  }
}

const botRunner = new TelegramPollingBot();

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Status & Config Endpoints
  app.get('/api/bot/status', (req, res) => {
    res.json({
      success: true,
      isRunning: botRunner.isRunning,
      botInfo: botRunner.botInfo,
      stats: botRunner.stats,
      config: currentConfig
    });
  });

  app.post('/api/bot/config', async (req, res) => {
    const { botToken, defaultUploadChannel, dumpChannel, screenshotChannel, mode, customSuffix, watermarkText, autoHashtags, deliveryMethod } = req.body;
    
    currentConfig = {
      ...currentConfig,
      botToken: botToken !== undefined ? botToken : currentConfig.botToken,
      defaultUploadChannel: defaultUploadChannel !== undefined ? defaultUploadChannel : currentConfig.defaultUploadChannel,
      dumpChannel: dumpChannel !== undefined ? dumpChannel : currentConfig.dumpChannel,
      screenshotChannel: screenshotChannel !== undefined ? screenshotChannel : currentConfig.screenshotChannel,
      mode: mode !== undefined ? mode : currentConfig.mode,
      customSuffix: customSuffix !== undefined ? customSuffix : currentConfig.customSuffix,
      watermarkText: watermarkText !== undefined ? watermarkText : currentConfig.watermarkText,
      autoHashtags: autoHashtags !== undefined ? autoHashtags : currentConfig.autoHashtags,
      deliveryMethod: deliveryMethod !== undefined ? deliveryMethod : currentConfig.deliveryMethod,
    };

    saveConfigToFile(currentConfig);
    addLog('INFO', 'Bot settings updated.');
    res.json({ success: true, config: currentConfig });
  });

  // Start Long Polling Bot
  app.post('/api/bot/start', async (req, res) => {
    const token = req.body.botToken || currentConfig.botToken;
    if (!token) {
      return res.status(400).json({ success: false, error: 'Bot token is required.' });
    }

    currentConfig.botToken = token;
    currentConfig.enabled = true;

    try {
      await botRunner.start(token);
      if (botRunner.botInfo?.username) {
        currentConfig.botUsername = botRunner.botInfo.username;
      }
      saveConfigToFile(currentConfig);
      res.json({
        success: true,
        message: 'Bot started successfully with Long Polling!',
        botInfo: botRunner.botInfo
      });
    } catch (err: any) {
      addLog('ERROR', `Could not start bot: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Stop Bot
  app.post('/api/bot/stop', async (req, res) => {
    await botRunner.stop();
    currentConfig.enabled = false;
    saveConfigToFile(currentConfig);
    res.json({ success: true, message: 'Bot stopped successfully.' });
  });

  app.get('/api/bot/logs', (req, res) => {
    res.json({ success: true, logs: botLogs });
  });

  // JavDB lookup endpoint
  app.get('/api/javdb/lookup', async (req, res) => {
    const code = (req.query.code as string || '').trim();
    if (!code) {
      return res.status(400).json({ success: false, error: 'Code is required (e.g. ROYD-143)' });
    }

    try {
      const movieData = await scrapeJavDatabase(code);
      if (!movieData) {
        return res.status(404).json({ success: false, error: `Movie ${code} not found on JavDB.` });
      }
      res.json({ success: true, movie: movieData });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // JavDB extract codes from raw text / log report endpoint
  app.post('/api/javdb/extract-codes', (req, res) => {
    const text = (req.body?.text as string) || '';
    const codes = extractJavCodesFromText(text);
    res.json({
      success: true,
      count: codes.length,
      codes
    });
  });

  // JavDB upload thumbnail to Telegram endpoint
  app.post('/api/javdb/upload-telegram', async (req, res) => {
    const { code, chatId } = req.body;
    const token = currentConfig.botToken;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Bot token is not configured. Please save a bot token first in the Bot Controller tab.' });
    }
    if (!code) {
      return res.status(400).json({ success: false, error: 'Movie code is required (e.g. ROYD-143).' });
    }
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'Telegram Chat ID or Channel ID is required.' });
    }

    if (chatId && currentConfig.lastChatId !== String(chatId)) {
      currentConfig.lastChatId = String(chatId);
      saveConfigToFile(currentConfig);
    }

    try {
      const movieData = await scrapeJavDatabase(code);
      if (!movieData || !movieData.coverUrl) {
        return res.status(404).json({ success: false, error: `Could not find thumbnail for ${code} on JavDB.` });
      }

      // Caption is strictly the video code only (e.g. ROYD-143)
      const caption = movieData.code;

      const imgRes = await fetch(movieData.coverUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': 'https://www.javdatabase.com/'
        }
      });
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} downloading cover image`);

      const arrayBuffer = await imgRes.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('photo', blob, `${code.toLowerCase()}_cover.jpg`);
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');

      const uploadRes = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json() as any;

      if (!uploadData.ok) {
        throw new Error(uploadData.description || 'Telegram API error');
      }

      addLog('SUCCESS', `Manually uploaded ${movieData.code} thumbnail to Telegram chat ${chatId}`);

      // Auto-relay to defaultUploadChannel if set
      if (currentConfig.defaultUploadChannel && currentConfig.defaultUploadChannel !== String(chatId)) {
        try {
          const relayData = new FormData();
          relayData.append('chat_id', currentConfig.defaultUploadChannel);
          relayData.append('photo', new Blob([arrayBuffer], { type: 'image/jpeg' }), `${code.toLowerCase()}_cover.jpg`);
          relayData.append('caption', caption);

          await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: relayData
          });
          addLog('SUCCESS', `Relayed ${movieData.code} thumbnail to channel ${currentConfig.defaultUploadChannel}`);
        } catch (rErr: any) {
          console.error('Relay error:', rErr.message);
        }
      }

      res.json({ success: true, message: `Successfully uploaded ${movieData.code} to Telegram!`, movie: movieData });
    } catch (err: any) {
      addLog('ERROR', `Upload to Telegram failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // JavDB upload sample preview screenshots album to Telegram endpoint
  app.post('/api/javdb/upload-screenshots-telegram', async (req, res) => {
    const { code, chatId } = req.body;
    const token = currentConfig.botToken;

    if (!token) {
      return res.status(400).json({ success: false, error: 'Bot token is not configured. Please save a bot token first in the Bot Controller tab.' });
    }
    if (!code) {
      return res.status(400).json({ success: false, error: 'Movie code is required (e.g. ROYD-143).' });
    }
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'Telegram Chat ID or Channel ID is required.' });
    }

    if (chatId && currentConfig.lastChatId !== String(chatId)) {
      currentConfig.lastChatId = String(chatId);
      saveConfigToFile(currentConfig);
    }

    try {
      const movieData = await scrapeJavDatabase(code);
      if (!movieData || !movieData.samples || movieData.samples.length === 0) {
        return res.status(404).json({ success: false, error: `No sample screenshots found for ${code} on JavDB.` });
      }

      const ok = await sendPreviewScreenshotsAlbum(token, chatId, code, movieData.samples);
      if (!ok) {
        throw new Error(`Failed to upload preview screenshots album for ${code}`);
      }

      addLog('SUCCESS', `Uploaded ${movieData.samples.length} preview screenshots for ${code} to chat ${chatId}`);

      // Auto-upload to screenshotChannel if set and different from target chatId
      if (currentConfig.screenshotChannel && currentConfig.screenshotChannel !== String(chatId)) {
        try {
          await sendPreviewScreenshotsAlbum(token, currentConfig.screenshotChannel, code, movieData.samples);
          addLog('SUCCESS', `Uploaded ${movieData.samples.length} preview screenshots for ${code} to screenshot channel ${currentConfig.screenshotChannel}`);
        } catch (sErr: any) {
          console.error('Relay screenshot error:', sErr.message);
        }
      }

      res.json({
        success: true,
        message: `Successfully uploaded sample screenshots album for ${code}!`,
        samplesCount: movieData.samples.length
      });
    } catch (err: any) {
      addLog('ERROR', `Upload screenshots failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Web simulator endpoint
  app.post('/api/bot/simulate-album', async (req, res) => {
    try {
      const { items, caption } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'No media items provided' });
      }

      const rawCaption = caption || '';
      const extractedCodes = extractJavCodesFromText(rawCaption);
      const videoCode = extractedCodes.length > 0 ? extractedCodes[0] : rawCaption.trim();

      const hasVideo = items.some((i: any) => i.type === 'video');

      const processedItems = items.map((item: any, index: number) => {
        let itemCaption = '';
        if (hasVideo) {
          itemCaption = item.type === 'video' ? videoCode : '';
        } else {
          itemCaption = index === 0 ? videoCode : '';
        }

        return {
          ...item,
          caption: itemCaption,
          isOriginalCaptionHolder: item.type === 'video' || (!hasVideo && index === 0),
          status: 'Synced & Applied',
          updatedAt: new Date().toISOString()
        };
      });

      const mediaGroupId = 'MG_' + Math.floor(10000 + Math.random() * 90000);

      addLog('SUCCESS', `[Simulator] Applied video code caption ("${videoCode}") specifically on video file in album #${mediaGroupId}`, mediaGroupId);

      res.json({
        success: true,
        mediaGroupId,
        originalCaption: caption,
        processedCaption: videoCode,
        items: processedItems
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Code generator export endpoint
  app.get('/api/bot/export-code', (req, res) => {
    const framework = req.query.framework || 'python_javdb';
    const token = currentConfig.botToken || 'YOUR_BOT_TOKEN';
    
    let code = '';
    if (framework === 'python_javdb') {
      code = `"""
Telegram Media Group Caption Syncer & JavDB Metadata Bot
Dependencies:
    pip install javdb pyrogram tgcrypto

Features:
    1. Intercepts incoming media groups (albums) in Telegram channels/chats.
    2. Extracts the movie code (e.g. SONE-763, IPX-123) from the album's first caption.
    3. Fetches rich metadata (Title, Actresses, Release Date, Tags) using the 'javdb' Python library.
    4. Automatically updates / edits the caption across all photos/videos in the media group!
"""

import asyncio
import re
from pyrogram import Client, filters
from pyrogram.types import Message, InputMediaPhoto, InputMediaVideo
from javdb import Client as JavdbClient

# --- Configuration ---
API_ID = 1234567           # Replace with your Telegram API ID from my.telegram.org
API_HASH = "YOUR_API_HASH"  # Replace with your Telegram API HASH from my.telegram.org
BOT_TOKEN = "${token}"

app = Client("javdb_caption_bot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)
jav_client = JavdbClient(timeout=15, retries=2)

# In-memory buffer to hold incoming media group items: { media_group_id: { "messages": [...], "task": asyncio.Task } }
media_groups = {}

def extract_jav_code(text: str):
    """Detects movie code such as SONE-763, SSIS-123, IPX-888, etc."""
    if not text:
        return None
    match = re.search(r'\\b([A-Za-z]{2,6}[-_]?\\d{2,5})\\b', text)
    return match.group(1).upper() if match else None

def format_jav_caption(movie: dict, code: str, original_caption: str):
    """Formats full structured caption with metadata from JavDB."""
    title = movie.get("title", code)
    date = movie.get("date", "N/A")
    actresses = ", ".join(movie.get("actress", [])) or "N/A"
    genres = " ".join([f"#{g.replace(' ', '_')}" for g in movie.get("genres", [])[:5]]) or "#JavDB"

    caption = (
        f"🎬 <b>{code}</b> - {title}\\n\\n"
        f"📅 <b>Date:</b> {date}\\n"
        f"👩 <b>Actress:</b> {actresses}\\n"
        f"🏷️ <b>Tags:</b> {genres}\\n\\n"
        f"✨ <i>Synced via MediaGroup Bot</i>"
    )
    return caption[:1024]  # Telegram 1024-char limit

@app.on_message(filters.media_group)
async def handle_album(client: Client, message: Message):
    mg_id = message.media_group_id
    if not mg_id:
        return

    if mg_id not in media_groups:
        media_groups[mg_id] = {
            "messages": [message],
            "caption": message.caption or "",
            "chat_id": message.chat.id,
            "is_channel": bool(message.chat.type.name == "CHANNEL"),
            "task": asyncio.create_task(process_album(client, mg_id))
        }
    else:
        group = media_groups[mg_id]
        group["messages"].append(message)
        if message.caption and not group["caption"]:
            group["caption"] = message.caption

async def process_album(client: Client, mg_id: str):
    # Wait 1.8 seconds for all items of the album to arrive
    await asyncio.sleep(1.8)
    group = media_groups.pop(mg_id, None)
    if not group:
        return

    messages = group["messages"]
    chat_id = group["chat_id"]
    caption = group["caption"]
    is_channel = group["is_channel"]

    # 1. Look for code in caption
    code = extract_jav_code(caption)
    final_caption = caption

    if code:
        print(f"[*] Detected movie code {code} in album {mg_id}. Searching JavDB...")
        try:
            results = jav_client.search(code, page=1)
            if results and len(results) > 0:
                movie = jav_client.movie(results[0]["link"])
                final_caption = format_jav_caption(movie, code, caption)
                print(f"[+] Retrieved metadata for {code}: {movie.get('title')}")
        except Exception as e:
            print(f"[-] JavDB search failed: {e}")
            final_caption = f"🎬 <b>{code}</b>\\n\\n{caption}"

    if not final_caption:
        return

    # 2. Synchronize caption across all album messages!
    print(f"[*] Propagating caption to all {len(messages)} messages in album {mg_id}...")
    if is_channel:
        # In channels, edit every message so each photo/video has the caption
        for msg in messages:
            try:
                await client.edit_message_caption(
                    chat_id=chat_id,
                    message_id=msg.id,
                    caption=final_caption,
                    parse_mode="html"
                )
            except Exception as e:
                print(f"[-] Failed to edit message {msg.id}: {e}")
    else:
        # In private chat or group, re-send the album with the caption attached to each photo
        media_list = []
        for msg in messages:
            file_id = msg.photo.file_id if msg.photo else (msg.video.file_id if msg.video else None)
            if file_id:
                if msg.photo:
                    media_list.append(InputMediaPhoto(file_id, caption=final_caption, parse_mode="html"))
                elif msg.video:
                    media_list.append(InputMediaVideo(file_id, caption=final_caption, parse_mode="html"))

        if media_list:
            try:
                await client.send_media_group(chat_id=chat_id, media=media_list)
                print(f"[+] Re-sent synchronized media group to chat {chat_id}")
            except Exception as e:
                print(f"[-] send_media_group error: {e}")

@app.on_message(filters.text & ~filters.media_group)
async def handle_movie_code_text(client: Client, message: Message):
    """Handles both single video code and Auto Bulk Mode with multiple codes"""
    text = message.text.strip()
    raw_codes = re.findall(r'\\b(?:FC2[-_]?(?:PPV[-_]?)?\\d{5,7}|[0-9]{1,3}[A-Za-z]{2,6}[-_]?\\d{2,5}|[A-Za-z]{1,6}[-_]\\d{2,7}|[A-Za-z]{2,6}\\d{2,5})\\b', text, re.IGNORECASE)
    codes = list(dict.fromkeys([c.upper() for c in raw_codes]))
    if not codes:
        return

    # 1. AUTO BULK MODE: Multiple codes detected in one message
    if len(codes) > 1:
        await message.reply_text(
            f"🚀 <b>Auto Bulk Mode Activated!</b>\\n"
            f"Detected {len(codes)} codes: <code>{' '.join(codes)}</code>\\n"
            f"Downloading thumbnails & uploading with video code as caption only...",
            parse_mode="html"
        )
        success_count = 0
        for i, code in enumerate(codes, 1):
            try:
                results = jav_client.search(code, page=1)
                if results:
                    movie = jav_client.movie(results[0]["link"])
                    poster_url = movie.get("poster")
                    if poster_url:
                        await client.send_photo(
                            chat_id=message.chat.id,
                            photo=poster_url,
                            caption=code
                        )
                        success_count += 1
                        print(f"[+] [{i}/{len(codes)}] Uploaded {code}")
            except Exception as e:
                print(f"[-] [{i}/{len(codes)}] Error on {code}: {e}")
            await asyncio.sleep(1.8)  # Safe delay between uploads

        await message.reply_text(
            f"✅ <b>Auto Bulk Upload Finished!</b>\\n"
            f"Uploaded {success_count}/{len(codes)} thumbnails with video code as caption only.",
            parse_mode="html"
        )
        return

    # 2. SINGLE CODE MODE
    code = codes[0]
    await message.reply_chat_action("upload_photo")
    print(f"[*] Fetching JavDB thumbnail for {code}...")

    try:
        results = jav_client.search(code, page=1)
        if not results:
            await message.reply_text(f"❌ Could not find <b>{code}</b> on JavDB.", parse_mode="html")
            return

        movie = jav_client.movie(results[0]["link"])
        poster_url = movie.get("poster")
        if not poster_url:
            await message.reply_text(f"❌ No thumbnail available for <b>{code}</b>.", parse_mode="html")
            return

        # Upload post thumbnail with only the video code as caption
        await client.send_photo(
            chat_id=message.chat.id,
            photo=poster_url,
            caption=code
        )
        print(f"[+] Successfully uploaded {code} thumbnail to chat {message.chat.id}")
    except Exception as e:
        print(f"[-] Error: {e}")
        await message.reply_text(f"⚠️ Error fetching {code}: {e}")

if __name__ == "__main__":
    print("Starting JavDB Media Group Caption & Thumbnail Bot with Long Polling...")
    app.run()
`;
    } else if (framework === 'grammy') {
      code = `/**
 * Telegram Media Group Caption Syncer Bot (grammY)
 * Uses Long Polling (works anywhere, no webhooks required)
 */
import { Bot } from "grammy";

const bot = new Bot("${token}");

const albumBuffer = new Map<string, {
  messages: Array<{ messageId: number; chatId: number; fileId: string; type: string }>;
  caption: string;
  timer: NodeJS.Timeout;
}>();

bot.on([":photo", ":video"], async (ctx) => {
  const msg = ctx.message || ctx.channelPost;
  if (!msg || !msg.media_group_id) return;

  const mediaGroupId = msg.media_group_id;
  const caption = msg.caption || "";
  const chatId = ctx.chat.id;
  const isChannel = ctx.chat.type === "channel";

  const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.video?.file_id;
  const type = msg.photo ? "photo" : "video";

  if (!albumBuffer.has(mediaGroupId)) {
    albumBuffer.set(mediaGroupId, {
      messages: [{ messageId: msg.message_id, chatId, fileId: fileId!, type }],
      caption: caption,
      timer: setTimeout(async () => {
        const album = albumBuffer.get(mediaGroupId);
        if (!album) return;
        albumBuffer.delete(mediaGroupId);

        if (!album.caption) return;
        const finalCaption = album.caption + "${currentConfig.customSuffix.replace(/\n/g, '\\n')}";

        if (isChannel) {
          // Edit in-place for channels where bot is admin
          for (const m of album.messages) {
            try {
              await ctx.api.editMessageCaption(m.chatId, m.messageId, {
                caption: finalCaption,
                parse_mode: "HTML"
              });
            } catch (err) {
              console.error("Edit error:", err);
            }
          }
        } else {
          // Send back media group with caption on every item
          await ctx.api.sendMediaGroup(chatId, album.messages.map(m => ({
            type: m.type as any,
            media: m.fileId,
            caption: finalCaption,
            parse_mode: "HTML"
          })));
        }
      }, 1800)
    });
  } else {
    const album = albumBuffer.get(mediaGroupId)!;
    album.messages.push({ messageId: msg.message_id, chatId, fileId: fileId!, type });
    if (caption && !album.caption) {
      album.caption = caption;
    }
  }
});

bot.start();
console.log("grammY Long Polling Bot running!");
`;
    } else {
      code = `/**
 * Telegram Media Group Caption Syncer Bot (Telegraf)
 * Uses Long Polling (works anywhere, no webhooks required)
 */
import { Telegraf } from 'telegraf';

const bot = new Telegraf("${token}");
const albumBuffer = new Map();

bot.on(['photo', 'video'], async (ctx) => {
  const msg = ctx.message || ctx.channelPost;
  if (!msg || !msg.media_group_id) return;

  const mediaGroupId = msg.media_group_id;
  const caption = msg.caption || '';
  const chatId = ctx.chat.id;
  const isChannel = ctx.chat.type === 'channel';

  const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.video?.file_id;
  const type = msg.photo ? 'photo' : 'video';

  if (!albumBuffer.has(mediaGroupId)) {
    albumBuffer.set(mediaGroupId, {
      messages: [{ messageId: msg.message_id, chatId, fileId, type }],
      caption,
      timer: setTimeout(async () => {
        const album = albumBuffer.get(mediaGroupId);
        if (!album) return;
        albumBuffer.delete(mediaGroupId);

        if (!album.caption) return;
        const finalCaption = album.caption + '${currentConfig.customSuffix.replace(/\n/g, '\\n')}';

        if (isChannel) {
          for (const m of album.messages) {
            try {
              await ctx.telegram.editMessageCaption(m.chatId, m.messageId, undefined, finalCaption, {
                parse_mode: 'HTML'
              });
            } catch (e) {
              console.error('Edit error:', e);
            }
          }
        } else {
          await ctx.telegram.sendMediaGroup(chatId, album.messages.map(m => ({
            type: m.type,
            media: m.fileId,
            caption: finalCaption,
            parse_mode: 'HTML'
          })));
        }
      }, 1800)
    });
  } else {
    const album = albumBuffer.get(mediaGroupId);
    album.messages.push({ messageId: msg.message_id, chatId, fileId, type });
    if (caption && !album.caption) {
      album.caption = caption;
    }
  }
});

bot.launch();
console.log('Telegraf Long Polling Bot running!');
`;
    }

    res.json({ success: true, code, framework });
  });

  // Vite middleware for frontend development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (currentConfig.botToken) {
      addLog('INFO', `Auto-resuming bot polling with saved token...`);
      botRunner.start(currentConfig.botToken).catch(err => {
        console.error('Auto-start bot error:', err.message);
      });
    }
  });
}

startServer().catch(console.error);
