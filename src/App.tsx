import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, Settings, Play, Square, Code, CheckCircle2, RefreshCw, 
  Copy, Check, Send, ShieldCheck, Layers, Zap, AlertCircle, Key, 
  Radio, RadioTower, Sparkles, MessageSquare, Terminal, ExternalLink, ArrowRight,
  ListFilter, Clock, CheckCircle, XCircle, Trash2, Sliders, FileText,
  Menu, X, ChevronLeft, ChevronRight, Activity
} from 'lucide-react';

export interface BulkItem {
  id: string;
  code: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
  coverUrl?: string;
  uploadedAt?: string;
}

interface BotConfig {
  botToken: string;
  botUsername: string;
  lastChatId?: string;
  defaultUploadChannel?: string;
  dumpChannel?: string;
  screenshotChannel?: string;
  mode: 'copy_to_all' | 'append_suffix' | 'watermark' | 'javdb_metadata';
  customSuffix: string;
  watermarkText: string;
  autoHashtags: boolean;
  enabled: boolean;
  deliveryMethod: 'both' | 'channel_edit' | 'resend_album';
}

interface BotStatusResponse {
  success: boolean;
  isRunning: boolean;
  botInfo: { id: number; first_name: string; username: string } | null;
  stats: {
    pollCount: number;
    updatesReceived: number;
    albumsSynced: number;
    errors: number;
    lastPollTime: string;
    lastStatus: string;
  };
  config: BotConfig;
}

interface LogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  details: string;
  mediaGroupId?: string;
}

interface SimulatedItem {
  id: string;
  type: 'photo' | 'video' | 'document';
  fileName: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'thumbnail_downloader' | 'bot_control' | 'rules' | 'simulator' | 'code' | 'logs'>('thumbnail_downloader');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [botInfo, setBotInfo] = useState<{ id: number; first_name: string; username: string } | null>(null);
  const [lookupCode, setLookupCode] = useState('ROYD-143');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [uploadChatId, setUploadChatId] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Auto Bulk Downloader state
  const [downloadSubMode, setDownloadSubMode] = useState<'single' | 'bulk'>('single');
  const [bulkTargetType, setBulkTargetType] = useState<'thumbnails' | 'screenshots'>('thumbnails');
  const [bulkInput, setBulkInput] = useState('ROYD-143\nSONE-763\nSSIS-088\nIPX-123\nMIDE-456');
  const [bulkDelay, setBulkDelay] = useState(2000);
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkCurrentIndex, setBulkCurrentIndex] = useState(-1);
  const [bulkStats, setBulkStats] = useState({ total: 5, completed: 0, success: 0, error: 0 });
  const cancelBulkRef = useRef(false);
  const [stats, setStats] = useState({
    pollCount: 0,
    updatesReceived: 0,
    albumsSynced: 0,
    errors: 0,
    lastPollTime: '',
    lastStatus: 'Stopped'
  });
  const [config, setConfig] = useState<BotConfig>({
    botToken: '',
    botUsername: '',
    mode: 'copy_to_all',
    customSuffix: '\n\n✨ <i>Synced via MediaGroup Bot</i>',
    watermarkText: '@MyChannel',
    autoHashtags: true,
    enabled: false,
    deliveryMethod: 'both',
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  // Simulator state
  const [simCaption, setSimCaption] = useState('🌟 SONE-763 [Exclusive Preview] Complete sample photo album.');
  const [simItems, setSimItems] = useState<SimulatedItem[]>([
    { id: '1', type: 'photo', fileName: 'sone763_cover.jpg' },
    { id: '2', type: 'photo', fileName: 'sone763_preview_1.jpg' },
    { id: '3', type: 'photo', fileName: 'sone763_preview_2.jpg' },
  ]);
  const [simResult, setSimResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  // Code generator state
  const [framework, setFramework] = useState<'python_javdb' | 'telegraf' | 'grammy'>('python_javdb');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const hasLoadedInitialConfigRef = useRef(false);

  // Restore saved token & chat ID from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('telegram_bot_token');
    const savedChatId = localStorage.getItem('telegram_chat_id');
    if (savedToken) setTokenInput(savedToken);
    if (savedChatId) setUploadChatId(savedChatId);
  }, []);

  const handleTokenChange = (val: string) => {
    setTokenInput(val);
    localStorage.setItem('telegram_bot_token', val);
  };

  const handleChatIdChange = (val: string) => {
    setUploadChatId(val);
    localStorage.setItem('telegram_chat_id', val);
  };

  // Auto poll status & logs every 2.5 seconds
  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchCode();

    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 2500);

    return () => clearInterval(interval);
  }, [framework]);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/bot/status');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;

      const data: BotStatusResponse = await res.json();
      if (data.success) {
        setIsRunning(data.isRunning);
        setBotInfo(data.botInfo);
        setStats(data.stats);

        // Only set initial config/inputs once on mount to avoid overwriting user edits or deletions during polling
        if (!hasLoadedInitialConfigRef.current) {
          hasLoadedInitialConfigRef.current = true;
          setConfig(data.config);

          if (data.config.botToken) {
            setTokenInput(prev => prev || data.config.botToken);
            localStorage.setItem('telegram_bot_token', data.config.botToken);
          }
          if (data.config.lastChatId) {
            setUploadChatId(prev => prev || data.config.lastChatId || '');
            localStorage.setItem('telegram_chat_id', data.config.lastChatId);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch status', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/bot/logs');
      if (!res.ok) return;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;

      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
      }
    } catch (e) {
      console.error('Failed to fetch logs', e);
    }
  };

  const fetchCode = async () => {
    try {
      const res = await fetch(`/api/bot/export-code?framework=${framework}`);
      const data = await res.json();
      if (data.success) {
        setGeneratedCode(data.code);
      }
    } catch (e) {
      console.error('Failed to load code', e);
    }
  };

  const handleStartBot = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!tokenInput.trim()) {
      setFeedbackMsg({ text: 'Please enter a valid Telegram Bot Token.', isError: true });
      return;
    }

    setActionLoading(true);
    setFeedbackMsg(null);

    try {
      // Save current channel configurations
      await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, botToken: tokenInput.trim() })
      });

      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tokenInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setIsRunning(true);
        setBotInfo(data.botInfo);
        setFeedbackMsg({ text: `Bot connected as @${data.botInfo?.username}! Channel settings saved & Long Polling active.` });
        fetchLogs();
      } else {
        setFeedbackMsg({ text: data.error || 'Failed to start bot.', isError: true });
      }
    } catch (err: any) {
      setFeedbackMsg({ text: err.message || 'Network error.', isError: true });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopBot = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/bot/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setIsRunning(false);
        setFeedbackMsg({ text: 'Bot stopped successfully.' });
        fetchLogs();
      }
    } catch (err: any) {
      setFeedbackMsg({ text: err.message, isError: true });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setActionLoading(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, botToken: tokenInput.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setFeedbackMsg({ text: 'Channel settings and caption rules saved successfully!' });
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
    } catch (err: any) {
      setFeedbackMsg({ text: err.message, isError: true });
    } finally {
      setActionLoading(false);
    }
  };

  const runSimulation = async () => {
    setSimulating(true);
    try {
      const res = await fetch('/api/bot/simulate-album', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: simItems, caption: simCaption })
      });
      const data = await res.json();
      if (data.success) {
        setSimResult(data);
        fetchLogs();
      }
    } catch (e) {
      console.error('Simulation error', e);
    } finally {
      setSimulating(false);
    }
  };

  const handleFetchThumbnail = async (codeToFetch?: string) => {
    const code = (codeToFetch || lookupCode).trim();
    if (!code) return;
    setLookupLoading(true);
    setUploadMsg(null);
    try {
      const res = await fetch(`/api/javdb/lookup?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.success && data.movie) {
        setLookupResult(data.movie);
      } else {
        setUploadMsg({ text: data.error || `Movie ${code} not found on JavDB.`, isError: true });
        setLookupResult(null);
      }
    } catch (e: any) {
      setUploadMsg({ text: e.message || 'Lookup request failed.', isError: true });
    } finally {
      setLookupLoading(false);
    }
  };

  const handleUploadToTelegram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupResult?.code) {
      setUploadMsg({ text: 'Please fetch a movie thumbnail first.', isError: true });
      return;
    }
    if (!uploadChatId.trim()) {
      setUploadMsg({ text: 'Please enter a target Chat ID or Channel username.', isError: true });
      return;
    }

    setUploadLoading(true);
    setUploadMsg(null);
    try {
      const res = await fetch('/api/javdb/upload-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: lookupResult.code,
          chatId: uploadChatId.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setUploadMsg({ text: `Success! ${lookupResult.code} cover was uploaded to Telegram.` });
        fetchLogs();
      } else {
        setUploadMsg({ text: data.error || 'Failed to upload to Telegram.', isError: true });
      }
    } catch (e: any) {
      setUploadMsg({ text: e.message || 'Upload failed.', isError: true });
    } finally {
      setUploadLoading(false);
    }
  };

  const parseCodesFromText = (text: string): string[] => {
    if (!text) return [];
    // Master regex matching all JAV video code patterns from raw text or logs (e.g. BACJ-141, MTALL-152, WO-020, 3DS-001, FC2-PPV-123456, BACJ141, T-28001)
    const masterRegex = /\b(?:FC2[-_]?(?:PPV[-_]?)?\d{5,7}|[0-9]{1,3}[A-Za-z]{2,6}[-_]?\d{2,5}|[A-Za-z]{1,6}[-_]\d{2,7}|[A-Za-z]{2,6}\d{2,5})\b/gi;
    const matches = text.match(masterRegex) || [];
    const found = new Set<string>();
    for (const m of matches) {
      const code = m.trim().toUpperCase();
      if (code.length >= 4 && /\d/.test(code)) {
        found.add(code);
      }
    }
    return Array.from(found);
  };

  useEffect(() => {
    if (!bulkRunning) {
      const detected = parseCodesFromText(bulkInput);
      setBulkItems(detected.map(code => ({
        id: code,
        code,
        status: 'pending'
      })));
      setBulkStats({ total: detected.length, completed: 0, success: 0, error: 0 });
    }
  }, [bulkInput, bulkRunning]);

  const handleStartBulkUpload = async () => {
    if (!config.botToken) {
      setUploadMsg({ text: 'Please configure and start your bot in the Bot Controller tab first.', isError: true });
      return;
    }
    if (!uploadChatId.trim()) {
      setUploadMsg({ text: 'Please specify the target Chat ID or @channel_username for bulk upload.', isError: true });
      return;
    }
    const codes = parseCodesFromText(bulkInput);
    if (codes.length === 0) {
      setUploadMsg({ text: 'No valid movie codes detected in the bulk input.', isError: true });
      return;
    }

    cancelBulkRef.current = false;
    setBulkRunning(true);
    setUploadMsg(null);

    const items: BulkItem[] = codes.map(c => ({ id: c, code: c, status: 'pending' }));
    setBulkItems([...items]);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < items.length; i++) {
      if (cancelBulkRef.current) break;

      setBulkCurrentIndex(i);
      items[i].status = 'processing';
      setBulkItems([...items]);

      const endpoint = bulkTargetType === 'screenshots' ? '/api/javdb/upload-screenshots-telegram' : '/api/javdb/upload-telegram';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: items[i].code,
            chatId: uploadChatId.trim()
          })
        });
        const data = await res.json();
        if (data.success) {
          items[i].status = 'success';
          items[i].uploadedAt = new Date().toLocaleTimeString();
          successCount++;
        } else {
          items[i].status = 'error';
          items[i].error = data.error || 'Failed to upload';
          errorCount++;
        }
      } catch (err: any) {
        items[i].status = 'error';
        items[i].error = err.message || 'Network error';
        errorCount++;
      }

      setBulkItems([...items]);
      setBulkStats({
        total: items.length,
        completed: i + 1,
        success: successCount,
        error: errorCount
      });

      if (i < items.length - 1 && !cancelBulkRef.current) {
        await new Promise(r => setTimeout(r, bulkDelay));
      }
    }

    setBulkRunning(false);
    setBulkCurrentIndex(-1);
    fetchLogs();
    fetchStatus();
  };

  const handleStopBulkUpload = () => {
    cancelBulkRef.current = true;
    setBulkRunning(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const navItems = [
    {
      id: 'thumbnail_downloader' as const,
      label: 'Thumbnail Downloader',
      shortLabel: 'Thumbnails',
      icon: Sparkles,
      badge: 'ROYD-143',
      badgeColor: 'cyan',
      description: 'Single & Auto Bulk JavDB Scraper'
    },
    {
      id: 'bot_control' as const,
      label: 'Bot Controller',
      shortLabel: 'Bot Engine',
      icon: Bot,
      badge: isRunning ? 'Active' : 'Idle',
      badgeColor: isRunning ? 'emerald' : 'slate',
      description: 'Long Polling Engine & Token Setup'
    },
    {
      id: 'rules' as const,
      label: 'Caption Rules',
      shortLabel: 'Caption Rules',
      icon: Settings,
      badge: config.mode === 'javdb_metadata' ? 'JavDB' : config.mode === 'copy_to_all' ? '1:1 Sync' : 'Custom',
      badgeColor: 'blue',
      description: 'MediaGroup Caption Formatting'
    },
    {
      id: 'simulator' as const,
      label: 'MediaGroup Simulator',
      shortLabel: 'Simulator',
      icon: Terminal,
      description: 'Test Bench for Album Propagation'
    },
    {
      id: 'logs' as const,
      label: 'Live Activity Logs',
      shortLabel: 'Logs',
      icon: MessageSquare,
      badge: logs.length.toString(),
      badgeColor: 'slate',
      description: 'Real-Time Long Polling Stream'
    },
    {
      id: 'code' as const,
      label: 'Export Source Code',
      shortLabel: 'Export Code',
      icon: Code,
      badge: 'Python/JS',
      badgeColor: 'purple',
      description: 'Pyrogram, Telegraf, grammY'
    },
  ];

  const currentTabItem = navItems.find(item => item.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans selection:bg-cyan-500 selection:text-white">
      {/* Mobile Drawer Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-900 border-r border-slate-800/80 transition-all duration-300 shadow-2xl
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${sidebarCollapsed ? 'w-20' : 'w-72'}
      `}>
        {/* Sidebar Header / Brand */}
        <div className="h-16 px-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
              <RadioTower className="w-5 h-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-bold tracking-tight text-white truncate">
                  Telegram Bot Studio
                </h1>
                <div className="flex items-center gap-1.5 text-[10px] text-cyan-400 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  <span className="truncate">Long Polling Engine</span>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Collapse Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden md:flex p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition-colors"
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>

          {/* Mobile Close Button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex md:hidden p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Section */}
        <div className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          <div className={`px-3 mb-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500 ${sidebarCollapsed ? 'text-center' : ''}`}>
            {sidebarCollapsed ? '•••' : 'Main Navigation'}
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all group relative ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  {!sidebarCollapsed && (
                    <div className="text-left min-w-0">
                      <div className="truncate text-xs">{item.label}</div>
                    </div>
                  )}
                </div>

                {!sidebarCollapsed && item.badge && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono shrink-0 ${
                    isActive 
                      ? 'bg-black/30 text-white' 
                      : 'bg-slate-800 text-cyan-400 border border-slate-700'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer / Bot Status Widget */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-900/60">
          {!sidebarCollapsed ? (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Engine Status</span>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                  isRunning ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
                  <span>{isRunning ? 'POLLING' : 'IDLE'}</span>
                </span>
              </div>

              {botInfo && (
                <div className="pt-1 flex items-center justify-between text-xs border-t border-slate-800/60">
                  <span className="text-slate-300 font-mono truncate">@{botInfo.username}</span>
                  <a
                    href={`https://t.me/${botInfo.username}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 hover:underline text-[10px] font-mono flex items-center gap-1 shrink-0"
                  >
                    <span>Open</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>Albums Synced:</span>
                <span className="text-cyan-400 font-bold">{stats.albumsSynced}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-center">
              <span className={`w-3 h-3 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} title={isRunning ? 'Polling Active' : 'Bot Offline'} />
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${sidebarCollapsed ? 'md:ml-20' : 'md:ml-72'}`}>
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 h-16 border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex md:hidden p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div>
              <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>{currentTabItem.label}</span>
              </h2>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                {currentTabItem.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Quick Bot Toggle directly in Header */}
            {config.botToken && (
              <div className="hidden sm:flex items-center gap-2">
                {!isRunning ? (
                  <button
                    onClick={() => handleStartBot()}
                    disabled={actionLoading}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs rounded-xl shadow-md shadow-cyan-500/20 transition-all flex items-center gap-1.5"
                  >
                    {actionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
                    <span>Start Polling</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopBot}
                    disabled={actionLoading}
                    className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded-xl shadow-md shadow-red-500/20 transition-all flex items-center gap-1.5"
                  >
                    {actionLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-white" />}
                    <span>Stop Engine</span>
                  </button>
                )}
              </div>
            )}

            {/* Polling Indicator Pill */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono font-medium ${
              isRunning ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
              <span className="hidden sm:inline">{isRunning ? `Polling (#${stats.pollCount})` : 'Engine Idle'}</span>
              <span className="sm:hidden">{isRunning ? 'Active' : 'Idle'}</span>
            </div>
          </div>
        </header>

        {/* Main Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {/* JAVDB THUMBNAIL DOWNLOADER TAB */}
        {activeTab === 'thumbnail_downloader' && (
          <div className="space-y-8">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-950/40 to-slate-900 border border-slate-800 p-8 shadow-2xl">
              <div className="absolute right-0 top-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
              <div className="max-w-3xl space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-cyan-500/10 text-cyan-400 text-xs font-semibold tracking-wide uppercase">
                  <Sparkles className="w-3.5 h-3.5" /> JavDB Post Thumbnail Engine
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Thumbnail & Screenshot Downloader
                </h1>

                {/* Submode Switcher */}
                <div className="pt-1 flex items-center gap-2">
                  <button
                    onClick={() => setDownloadSubMode('single')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                      downloadSubMode === 'single'
                        ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/25'
                        : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Single Code Mode</span>
                  </button>
                  <button
                    onClick={() => setDownloadSubMode('bulk')}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 ${
                      downloadSubMode === 'bulk'
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25 ring-2 ring-cyan-400/30'
                        : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>Auto Bulk Mode</span>
                    <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                      Multi-Code
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {uploadMsg && (
              <div className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between ${
                uploadMsg.isError ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              }`}>
                <div className="flex items-center gap-2">
                  {uploadMsg.isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  <span>{uploadMsg.text}</span>
                </div>
                <button onClick={() => setUploadMsg(null)} className="text-slate-400 hover:text-white">✕</button>
              </div>
            )}

            {/* 1. SINGLE CODE MODE */}
            {downloadSubMode === 'single' && (
              <div className="space-y-8">
                {/* Input Bar */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Quick Code Preset:</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {['ROYD-143', 'SONE-763', 'SSIS-088', 'IPX-123'].map(c => (
                        <button
                          key={c}
                          onClick={() => {
                            setLookupCode(c);
                            handleFetchThumbnail(c);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-mono transition-colors"
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleFetchThumbnail();
                    }}
                    className="flex flex-col sm:flex-row gap-3"
                  >
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={lookupCode}
                        onChange={(e) => setLookupCode(e.target.value.toUpperCase())}
                        placeholder="Enter movie code (e.g. ROYD-143)"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono uppercase tracking-wider"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={lookupLoading || !lookupCode.trim()}
                      className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 shrink-0"
                    >
                      {lookupLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Fetch from JavDB
                    </button>
                  </form>
                </div>

                {/* Movie Result Showcase */}
                {lookupResult && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Cover Image */}
                    <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-white">Post Thumbnail</span>
                        <span className="text-xs font-mono text-cyan-400 font-bold">{lookupResult.code}</span>
                      </div>
                      <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                        <img
                          src={lookupResult.coverUrl}
                          alt={lookupResult.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-cover max-h-[500px] hover:scale-102 transition-transform duration-300"
                        />
                      </div>
                      <a
                        href={lookupResult.movieUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium text-center flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                      >
                        <span>View on JavDB</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {/* Metadata & Telegram Upload */}
                    <div className="lg:col-span-7 space-y-6">
                      {/* Metadata Card */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
                        <div className="border-b border-slate-800 pb-3">
                          <span className="text-[11px] font-mono text-cyan-400 uppercase tracking-wider block">Metadata Summary</span>
                          <h3 className="text-lg font-bold text-white mt-1">{lookupResult.title}</h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block text-[11px]">Movie Code</span>
                            <span className="font-mono text-cyan-400 font-bold text-sm">{lookupResult.code}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block text-[11px]">Actress</span>
                            <span className="font-medium text-white text-sm">{lookupResult.actress || 'N/A'}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block text-[11px]">Release Date</span>
                            <span className="font-mono text-slate-200">{lookupResult.date || 'N/A'}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                            <span className="text-slate-500 block text-[11px]">Preview Screenshots</span>
                            <span className="font-mono text-emerald-400 font-bold">{lookupResult.samples?.length || 0} samples found</span>
                          </div>
                        </div>

                        {/* Sample Screenshot Gallery if available */}
                        {lookupResult.samples && lookupResult.samples.length > 0 && (
                          <div className="pt-2 space-y-2">
                            <span className="text-xs font-semibold text-slate-300 block">Sample Screenshot Preview Album</span>
                            <div className="grid grid-cols-4 gap-2">
                              {lookupResult.samples.map((sUrl: string, idx: number) => (
                                <div key={idx} className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950 aspect-video">
                                  <img
                                    src={sUrl}
                                    alt={`Sample ${idx + 1}`}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Upload to Telegram Widget */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
                        <h4 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                          <Send className="w-4 h-4 text-cyan-400" /> Upload This Cover Directly to Telegram
                        </h4>
                        <p className="text-xs text-slate-400">
                          Enter your Telegram Chat ID (e.g. from <code className="text-slate-300">@userinfobot</code>) or public channel username (e.g. <code className="text-slate-300">@mychannel</code>).
                        </p>
                        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <div>
                            <span className="text-[11px] text-slate-500 block">Telegram Photo Caption:</span>
                            <span className="font-mono text-cyan-400 font-bold text-base">{lookupResult.code}</span>
                          </div>
                          <span className="text-[11px] px-2.5 py-1 rounded bg-cyan-500/10 text-cyan-300 font-mono border border-cyan-500/20">
                            Video Code Only
                          </span>
                        </div>

                        <form onSubmit={handleUploadToTelegram} className="flex flex-col sm:flex-row gap-3">
                          <input
                            type="text"
                            value={uploadChatId}
                            onChange={(e) => handleChatIdChange(e.target.value)}
                            placeholder="Chat ID or @channel_username"
                            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                          />
                          <button
                            type="submit"
                            disabled={uploadLoading || !uploadChatId.trim()}
                            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 shrink-0"
                          >
                            {uploadLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            Upload Cover to Telegram
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. AUTO BULK MODE */}
            {downloadSubMode === 'bulk' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: Bulk Codes Input & Presets */}
                  <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                          Bulk Movie Codes List
                        </h3>
                      </div>
                      <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 font-mono text-xs border border-cyan-500/20 flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-amber-300" />
                        <span>{bulkStats.total} Codes Detected</span>
                      </span>
                    </div>

                    <div>
                      <textarea
                        rows={8}
                        value={bulkInput}
                        disabled={bulkRunning}
                        onChange={(e) => setBulkInput(e.target.value)}
                        placeholder="Paste video codes or logs here..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 tracking-wide uppercase leading-relaxed resize-y"
                      />
                    </div>

                    {/* Quick presets */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-500">Presets:</span>
                        <button
                          type="button"
                          disabled={bulkRunning}
                          onClick={() => setBulkInput(
                            '🧾 Codes Missing Metadata\n📊 Total: 366 · Page 1/19\n\n' +
                            '1. BACJ-141 — Not found on Javtiful: No Javtiful video found for BACJ-141\n' +
                            '2. BACJ-142 — Not found on Javtiful: No Javtiful video found for BACJ-142\n' +
                            '3. GVH-729 — Not found on Javtiful: No Javtiful video found for GVH-729\n' +
                            '4. MTALL-152 — Not found on Javtiful: No Javtiful video found for MTALL-152\n' +
                            '5. MEYD-987 — Not found on Javtiful: No Javtiful video found for MEYD-987\n' +
                            '6. MUKD-526 — Not found on Javtiful: No Javtiful video found for MUKD-526\n' +
                            '7. ATYA-018 — Not found on Javtiful: No Javtiful video found for ATYA-018\n' +
                            '8. WO-020 — Not found on Javtiful: No Javtiful video found for WO-020\n' +
                            '9. ABF-213 — Not found on Javtiful: No Javtiful video found for ABF-213\n' +
                            '10. RBK-105 — Not found on Javtiful: No Javtiful video found for RBK-105\n' +
                            '11. DFE-096 — Not found on Javtiful: No Javtiful video found for DFE-096\n' +
                            '12. SORA-593 — Not found on Javtiful: No Javtiful video found for SORA-593\n' +
                            '13. DASS-590 — Not found on Javtiful: No Javtiful video found for DASS-590\n' +
                            '14. APNS-370 — Not found on Javtiful: No Javtiful video found for APNS-370\n' +
                            '15. SOAN-113 — Not found on Javtiful: No Javtiful video found for SOAN-113\n' +
                            '16. MVG-122 — Not found on Javtiful: No Javtiful video found for MVG-122\n' +
                            '17. MIAB-433 — Not found on Javtiful: No Javtiful video found for MIAB-433\n' +
                            '18. JUR-035 — Not found on Javtiful: No Javtiful video found for JUR-035\n' +
                            '19. MFYD-027 — Not found on Javtiful: No Javtiful video found for MFYD-027\n' +
                            '20. MIAB-500 — Not found on Javtiful: No Javtiful video found for MIAB-500\n\n' +
                            'Use Add to submit the title and video, or Thumbnail to update the image on the existing catalog record.'
                          )}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 text-xs font-medium border border-cyan-500/30 transition-colors flex items-center gap-1.5"
                        >
                          <Sparkles className="w-3 h-3 text-amber-300" />
                          <span>Load Missing Metadata Log (20 Codes)</span>
                        </button>
                        <button
                          type="button"
                          disabled={bulkRunning}
                          onClick={() => setBulkInput('ROYD-143\nSONE-763\nSSIS-088\nIPX-123\nMIDE-456')}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono border border-slate-700 transition-colors"
                        >
                          5 Codes
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={bulkRunning || !bulkInput.trim()}
                        onClick={() => setBulkInput('')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 text-xs flex items-center gap-1 border border-slate-700 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    </div>
                  </div>

                  {/* Right Column: Target Chat & Controls */}
                  <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5 flex flex-col justify-between">
                    <div className="space-y-4">
                      <div className="border-b border-slate-800 pb-3">
                        <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                          <Sliders className="w-4 h-4 text-cyan-400" />
                          Auto Bulk Settings
                        </h3>
                      </div>

                      {/* Bulk Target Type Selector */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-300">
                          Bulk Upload Mode Target
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={bulkRunning}
                            onClick={() => setBulkTargetType('thumbnails')}
                            className={`py-2 px-3 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                              bulkTargetType === 'thumbnails'
                                ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-md'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            <span>🖼️ Cover Thumbnails</span>
                          </button>
                          <button
                            type="button"
                            disabled={bulkRunning}
                            onClick={() => setBulkTargetType('screenshots')}
                            className={`py-2 px-3 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                              bulkTargetType === 'screenshots'
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-md'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                            }`}
                          >
                            <span>📷 Screenshot Albums</span>
                          </button>
                        </div>
                      </div>

                      {/* Destination Chat ID */}
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <label className="block text-xs font-medium text-slate-300">
                            Destination Chat ID or @Channel
                          </label>
                          <div className="flex items-center gap-2">
                            {config.defaultUploadChannel && bulkTargetType === 'thumbnails' && (
                              <button
                                type="button"
                                onClick={() => handleChatIdChange(config.defaultUploadChannel || '')}
                                className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono font-semibold underline"
                              >
                                Default ({config.defaultUploadChannel})
                              </button>
                            )}
                            {config.screenshotChannel && bulkTargetType === 'screenshots' && (
                              <button
                                type="button"
                                onClick={() => handleChatIdChange(config.screenshotChannel || '')}
                                className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono font-semibold underline"
                              >
                                Screenshot ({config.screenshotChannel})
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="relative flex items-center w-full">
                          <input
                            type="text"
                            value={uploadChatId}
                            disabled={bulkRunning}
                            onChange={(e) => handleChatIdChange(e.target.value)}
                            placeholder="e.g. @mychannel or 123456789"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                          />
                          {uploadChatId && !bulkRunning && (
                            <button
                              type="button"
                              onClick={() => handleChatIdChange('')}
                              className="absolute right-3 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors text-xs"
                              title="Clear chat ID"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {bulkTargetType === 'screenshots' 
                            ? 'Uploads 10-photo preview screenshot albums with video code caption on all photos.' 
                            : 'Uploads single post cover image with video code caption.'}
                        </p>
                      </div>

                      {/* Delay selector */}
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-slate-300">
                          Upload Interval Delay (Anti-Flood Protection)
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '1.5s Fast', ms: 1500 },
                            { label: '2.0s Optimal', ms: 2000 },
                            { label: '3.0s Safe', ms: 3000 },
                          ].map((d) => (
                            <button
                              key={d.ms}
                              type="button"
                              disabled={bulkRunning}
                              onClick={() => setBulkDelay(d.ms)}
                              className={`py-2 px-2 text-[11px] font-mono rounded-xl border text-center transition-all ${
                                bulkDelay === d.ms
                                  ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold'
                                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                              }`}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Caption specification badge */}
                      <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">Telegram Photo Caption:</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono font-semibold border border-emerald-500/20">
                            Strictly Video Code Only
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Caption format: <span className="text-cyan-400 font-bold">ROYD-143</span> (no extra titles or text)
                        </p>
                      </div>
                    </div>

                    {/* Launch / Cancel Button */}
                    <div className="pt-2">
                      {!bulkRunning ? (
                        <button
                          type="button"
                          onClick={handleStartBulkUpload}
                          disabled={bulkStats.total === 0 || !uploadChatId.trim()}
                          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
                        >
                          <Play className="w-4 h-4 fill-white" />
                          <span>Start Auto Bulk Upload ({bulkStats.total} Codes)</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStopBulkUpload}
                          className="w-full py-3.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-500/25 transition-all flex items-center justify-center gap-2"
                        >
                          <Square className="w-4 h-4 fill-white" />
                          <span>Stop / Cancel Auto Bulk Upload</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress Bar & Telemetry Dashboard */}
                {(bulkRunning || bulkStats.completed > 0) && (
                  <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${bulkRunning ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}`} />
                          <h4 className="text-sm font-bold text-white">
                            {bulkRunning ? 'Auto Bulk Upload in Progress...' : 'Auto Bulk Upload Finished'}
                          </h4>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {bulkRunning && bulkCurrentIndex >= 0 && bulkItems[bulkCurrentIndex]
                            ? `Currently processing code ${bulkItems[bulkCurrentIndex].code} (${bulkCurrentIndex + 1}/${bulkItems.length})...`
                            : `Processed ${bulkStats.completed} out of ${bulkStats.total} movie codes.`}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                          <span className="text-[10px] text-slate-500 block uppercase">Total</span>
                          <span className="text-xs font-mono font-bold text-white">{bulkStats.total}</span>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                          <span className="text-[10px] text-slate-500 block uppercase">Completed</span>
                          <span className="text-xs font-mono font-bold text-cyan-400">{bulkStats.completed}</span>
                        </div>
                        <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                          <span className="text-[10px] text-emerald-500/80 block uppercase">Uploaded</span>
                          <span className="text-xs font-mono font-bold text-emerald-400">{bulkStats.success}</span>
                        </div>
                        {bulkStats.error > 0 && (
                          <div className="px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-center">
                            <span className="text-[10px] text-red-500/80 block uppercase">Failed</span>
                            <span className="text-xs font-mono font-bold text-red-400">{bulkStats.error}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Progress Track */}
                    <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800 p-0.5">
                      <div
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.round((bulkStats.completed / Math.max(bulkStats.total, 1)) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Live Items Queue & Status Table */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <ListFilter className="w-4 h-4 text-cyan-400" />
                      <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                        Codes Queue & Download Status
                      </h4>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {bulkItems.length} items in batch
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2.5 px-3 font-semibold uppercase text-[10px]">#</th>
                          <th className="py-2.5 px-3 font-semibold uppercase text-[10px]">Movie Code</th>
                          <th className="py-2.5 px-3 font-semibold uppercase text-[10px]">Telegram Caption</th>
                          <th className="py-2.5 px-3 font-semibold uppercase text-[10px]">Status</th>
                          <th className="py-2.5 px-3 font-semibold uppercase text-[10px] text-right">Action / Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {bulkItems.map((item, idx) => {
                          const isCurrent = bulkRunning && bulkCurrentIndex === idx;
                          return (
                            <tr
                              key={item.id}
                              className={`transition-colors ${
                                isCurrent
                                  ? 'bg-cyan-500/10'
                                  : item.status === 'success'
                                  ? 'hover:bg-emerald-500/5'
                                  : 'hover:bg-slate-800/40'
                              }`}
                            >
                              <td className="py-3 px-3 text-slate-500">{idx + 1}</td>
                              <td className="py-3 px-3 font-bold text-white text-sm">
                                {item.code}
                              </td>
                              <td className="py-3 px-3">
                                <span className="px-2 py-0.5 rounded bg-slate-950 text-cyan-300 border border-slate-800">
                                  {item.code}
                                </span>
                              </td>
                              <td className="py-3 px-3">
                                {item.status === 'pending' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-[11px]">
                                    <Clock className="w-3 h-3" /> Pending
                                  </span>
                                )}
                                {item.status === 'processing' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-[11px] animate-pulse">
                                    <RefreshCw className="w-3 h-3 animate-spin" /> Downloading & Uploading...
                                  </span>
                                )}
                                {item.status === 'success' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold border border-emerald-500/20">
                                    <CheckCircle className="w-3 h-3" /> Uploaded (Caption: {item.code})
                                  </span>
                                )}
                                {item.status === 'error' && (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 text-[11px] border border-red-500/20">
                                    <XCircle className="w-3 h-3" /> {item.error || 'Failed'}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-right">
                                <a
                                  href={`https://www.javdatabase.com/movies/${item.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-400 transition-colors"
                                >
                                  <span>JavDB</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* BOT CONTROLLER TAB */}
        {activeTab === 'bot_control' && (
          <div className="space-y-8">
            {/* Notification alert if any */}
            {feedbackMsg && (
              <div className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between transition-all ${
                feedbackMsg.isError ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              }`}>
                <div className="flex items-center gap-2">
                  {feedbackMsg.isError ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  <span>{feedbackMsg.text}</span>
                </div>
                <button onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white">✕</button>
              </div>
            )}

            {/* Top Control Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Bot Token & Polling Launcher */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white">Telegram Bot Setup</h2>
                    </div>
                  </div>
                  {botInfo && (
                    <a
                      href={`https://t.me/${botInfo.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-xs font-medium hover:bg-blue-500/20 border border-blue-500/20"
                    >
                      <span>@{botInfo.username}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                <form onSubmit={handleStartBot} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Telegram Bot API Token</label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={e => handleTokenChange(e.target.value)}
                      placeholder="Enter Bot Token"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono tracking-wide"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-white uppercase tracking-wider">
                        Default Thumbnail Upload Channel
                      </label>
                      {config.defaultUploadChannel && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono border border-cyan-500/20">
                          Active: {config.defaultUploadChannel}
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={config.defaultUploadChannel || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setConfig({ ...config, defaultUploadChannel: val });
                        }}
                        placeholder="e.g. @my_thumbnail_channel or -100123456789"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-3 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono tracking-wide"
                      />
                      {config.defaultUploadChannel && (
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, defaultUploadChannel: '' })}
                          className="absolute right-3 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors text-xs"
                          title="Clear / Delete default channel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-white uppercase tracking-wider">
                        Captioned Video Dump Channel
                      </label>
                      {config.dumpChannel && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 font-mono border border-purple-500/20">
                          Active: {config.dumpChannel}
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={config.dumpChannel || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setConfig({ ...config, dumpChannel: val });
                        }}
                        placeholder="e.g. @my_video_dump_channel or -100987654321"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-3 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono tracking-wide"
                      />
                      {config.dumpChannel && (
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, dumpChannel: '' })}
                          className="absolute right-3 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors text-xs"
                          title="Clear / Delete dump channel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-white uppercase tracking-wider">
                        Sample Screenshots Channel
                      </label>
                      {config.screenshotChannel && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 font-mono border border-emerald-500/20">
                          Active: {config.screenshotChannel}
                        </span>
                      )}
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={config.screenshotChannel || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setConfig({ ...config, screenshotChannel: val });
                        }}
                        placeholder="e.g. @my_screenshot_channel or -1001122334455"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-10 py-3 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono tracking-wide"
                      />
                      {config.screenshotChannel && (
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, screenshotChannel: '' })}
                          className="absolute right-3 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-slate-800 transition-colors text-xs"
                          title="Clear / Delete screenshot channel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    {!isRunning ? (
                      <button
                        type="submit"
                        disabled={actionLoading}
                        className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center gap-2"
                      >
                        {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
                        Start Bot (Long Polling)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStopBot}
                        disabled={actionLoading}
                        className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-red-500/25 transition-all flex items-center gap-2"
                      >
                        {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-white" />}
                        Stop Bot
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSaveConfig()}
                      disabled={actionLoading}
                      className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs rounded-xl border border-slate-700 transition-colors flex items-center gap-2"
                    >
                      <Check className="w-4 h-4 text-emerald-400" /> Save Channel Settings
                    </button>
                  </div>
                </form>
              </div>

              {/* Live Polling Status & Metrics */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-cyan-400" /> Polling Engine Telemetry
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Connection Mode</span>
                      <span className="text-cyan-400 font-mono font-medium">Long Polling (getUpdates)</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Engine State</span>
                      <span className={`font-mono font-medium ${isRunning ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {isRunning ? 'ACTIVE & LISTENING' : 'OFFLINE'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Poll Requests Made</span>
                      <span className="font-mono tabular-nums text-white">{stats.pollCount}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Updates Received</span>
                      <span className="font-mono tabular-nums text-white">{stats.updatesReceived}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Default Channel</span>
                      <span className="font-mono text-cyan-400 font-medium">{config.defaultUploadChannel || 'Not set'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Dump Channel</span>
                      <span className="font-mono text-purple-400 font-medium">{config.dumpChannel || 'Not set'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2 border-b border-slate-800">
                      <span className="text-slate-400">Screenshot Channel</span>
                      <span className="font-mono text-emerald-400 font-medium">{config.screenshotChannel || 'Not set'}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs py-2">
                      <span className="text-slate-400">Albums Synchronized</span>
                      <span className="font-mono tabular-nums text-emerald-400 font-bold">{stats.albumsSynced}</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span>Last poll:</span>
                  <span className="font-mono text-slate-400">{stats.lastPollTime || 'Never'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RULES TAB */}
        {activeTab === 'rules' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Caption Synchronization Rules</h2>
              <p className="text-xs text-slate-400">Customize how captions are formatted when applied across all album messages.</p>
            </div>

            <form onSubmit={handleSaveConfig} className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6 shadow-xl">
              <div className="space-y-4">
                <label className="block text-xs font-semibold text-white uppercase tracking-wider">Sync Mode</label>
                <div className="grid grid-cols-1 gap-3">
                  <label className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${config.mode === 'javdb_metadata' ? 'bg-cyan-500/10 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-white">JavDB Movie Code Detection & Metadata Sync</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">libraries.io/pypi/javdb</span>
                      </div>
                      <span className="text-xs text-slate-400 block mt-0.5">Detects movie codes like SONE-763, IPX-123, SSIS-088 and structures a complete metadata caption across the album.</span>
                    </div>
                    <input
                      type="radio"
                      name="syncMode"
                      checked={config.mode === 'javdb_metadata'}
                      onChange={() => setConfig({ ...config, mode: 'javdb_metadata' })}
                      className="accent-cyan-500"
                    />
                  </label>

                  <label className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${config.mode === 'copy_to_all' ? 'bg-cyan-500/10 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                    <div>
                      <span className="font-semibold text-sm text-white block">Exact Caption Replication</span>
                      <span className="text-xs text-slate-400">Detects the original caption and copies it 1:1 onto all photos/videos.</span>
                    </div>
                    <input
                      type="radio"
                      name="syncMode"
                      checked={config.mode === 'copy_to_all'}
                      onChange={() => setConfig({ ...config, mode: 'copy_to_all' })}
                      className="accent-cyan-500"
                    />
                  </label>

                  <label className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${config.mode === 'append_suffix' ? 'bg-cyan-500/10 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                    <div>
                      <span className="font-semibold text-sm text-white block">Append Custom Footer / Suffix</span>
                      <span className="text-xs text-slate-400">Attaches a custom promotional signature or link to each message.</span>
                    </div>
                    <input
                      type="radio"
                      name="syncMode"
                      checked={config.mode === 'append_suffix'}
                      onChange={() => setConfig({ ...config, mode: 'append_suffix' })}
                      className="accent-cyan-500"
                    />
                  </label>

                  <label className={`p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${config.mode === 'watermark' ? 'bg-cyan-500/10 border-cyan-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                    <div>
                      <span className="font-semibold text-sm text-white block">Channel Watermark Tag</span>
                      <span className="text-xs text-slate-400">Appends your channel handle or watermark tag to every item in the album.</span>
                    </div>
                    <input
                      type="radio"
                      name="syncMode"
                      checked={config.mode === 'watermark'}
                      onChange={() => setConfig({ ...config, mode: 'watermark' })}
                      className="accent-cyan-500"
                    />
                  </label>
                </div>
              </div>

              {config.mode === 'append_suffix' && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Custom Suffix (HTML formatting supported)</label>
                  <textarea
                    rows={2}
                    value={config.customSuffix}
                    onChange={e => setConfig({ ...config, customSuffix: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              )}

              {config.mode === 'watermark' && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Channel Watermark Handle</label>
                  <input
                    type="text"
                    value={config.watermarkText}
                    onChange={e => setConfig({ ...config, watermarkText: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              )}

              {/* Real-Time Live Caption Preview */}
              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-white uppercase tracking-wider">
                      Real-Time Live Caption Preview
                    </span>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 font-mono border border-cyan-500/20">
                    Mode: {config.mode}
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {config.mode === 'javdb_metadata' && (
                    <>
                      🎬 <b>ROYD-143</b> · JAV Metadata Synced{'\n\n'}
                      📝 <b>Original:</b> Sample album caption text for ROYD-143{'\n'}
                      🏷️ <b>Tags:</b> #ROYD_143 #JavDB #MediaGroup
                      {config.customSuffix ? config.customSuffix : ''}
                    </>
                  )}
                  {config.mode === 'copy_to_all' && (
                    <>
                      Sample original album caption copied 1:1 across all photos.
                      {config.autoHashtags ? '\n\n#MediaGroup #TelegramBot' : ''}
                    </>
                  )}
                  {config.mode === 'append_suffix' && (
                    <>
                      Sample original caption text
                      {config.customSuffix ? config.customSuffix : '\n\n✨ Synced via MediaGroup Bot'}
                    </>
                  )}
                  {config.mode === 'watermark' && (
                    <>
                      Sample original caption text
                      {'\n\n📌 ' + (config.watermarkText || '@MyChannel')}
                    </>
                  )}
                </div>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center gap-2"
                >
                  <Check className="w-4 h-4" /> Save Rules
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SIMULATOR TAB */}
        {activeTab === 'simulator' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Media Group Sync Simulator</h2>
                <p className="text-xs text-slate-400">Test how the bot intercepts albums, extracts captions, and synchronizes them instantly.</p>
              </div>
              <button
                onClick={runSimulation}
                disabled={simulating}
                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center gap-2"
              >
                {simulating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-white" />}
                Simulate Album Send
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                    <Send className="w-4 h-4 text-cyan-400" /> Incoming Album Input
                  </h3>
                  <span className="text-xs text-slate-400">Media Group ID: <code className="text-cyan-400 font-mono">MG_99182</code></span>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Caption (Only on 1st Photo initially)</label>
                  <textarea
                    rows={3}
                    value={simCaption}
                    onChange={e => setSimCaption(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 leading-relaxed"
                  />
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-300">Items in Album ({simItems.length})</label>
                  <div className="space-y-2">
                    {simItems.map((item, index) => (
                      <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-cyan-400">
                            {item.type === 'photo' ? '🖼️' : '🎥'}
                          </div>
                          <div>
                            <span className="text-xs font-medium text-white block">{item.fileName}</span>
                            <span className="text-[11px] text-slate-500">Item #{index + 1} {index === 0 ? '(Caption Holder)' : '(No Caption)'}</span>
                          </div>
                        </div>
                        <span className={`text-[11px] px-2 py-0.5 rounded ${index === 0 ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'bg-slate-800 text-slate-400'}`}>
                          {index === 0 ? 'Has Caption' : 'Empty Caption'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl flex flex-col justify-between">
                <div className="space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                      <Bot className="w-4 h-4 text-emerald-400" /> Bot Synchronized Output
                    </h3>
                    <span className="text-xs text-emerald-400 font-medium">Caption Attached to All</span>
                  </div>

                  {simResult ? (
                    <div className="space-y-4">
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Caption propagated to all {simResult.items.length} items in album <code className="font-mono">{simResult.mediaGroupId}</code>!</span>
                      </div>

                      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                        {simResult.items.map((item: any) => (
                          <div key={item.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-300 flex items-center gap-1.5">
                                {item.type === 'photo' ? '🖼️' : '🎥'} {item.fileName}
                              </span>
                              <span className="text-emerald-400 font-mono text-[11px]">Synced caption applied</span>
                            </div>
                            <div className="p-2.5 rounded-lg bg-slate-900 text-xs text-slate-200 border border-slate-800/80 font-mono whitespace-pre-wrap">
                              {item.caption}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 space-y-3">
                      <Layers className="w-10 h-10 stroke-1 text-slate-700" />
                      <p className="text-xs">Click <strong className="text-slate-400">"Simulate Album Send"</strong> to run the caption synchronization algorithm.</p>
                    </div>
                  )}
                </div>

                <div className="text-center pt-4 border-t border-slate-800 text-xs text-slate-500">
                  Mode: <span className="text-cyan-400">{config.mode}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">Live Telegram Activity Logs</h2>
                <p className="text-xs text-slate-400">Real-time trace of updates received, media groups detected, and captions synced.</p>
              </div>
              <button
                onClick={fetchLogs}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-xl border border-slate-800 transition-colors flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
              <div className="divide-y divide-slate-800 max-h-[550px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">No logs recorded yet.</div>
                ) : (
                  logs.map(log => (
                    <div key={log.id} className="p-4 flex items-center justify-between hover:bg-slate-850 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          log.type === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          log.type === 'INFO' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          log.type === 'WARN' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {log.type}
                        </span>
                        <div>
                          <p className="text-xs text-slate-200 font-medium">{log.details}</p>
                          {log.mediaGroupId && (
                            <span className="text-[11px] text-cyan-400 font-mono">Media Group #{log.mediaGroupId}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 font-mono">{log.timestamp}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* EXPORT CODE TAB */}
        {activeTab === 'code' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Standalone Bot Source Code</h2>
                <p className="text-xs text-slate-400">Pre-configured with your bot token and Long Polling — supports Python JavDB, Telegraf, and grammY.</p>
              </div>
              <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setFramework('python_javdb')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                    framework === 'python_javdb' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>Python (javdb + Pyrogram)</span>
                  <span className="text-[10px] px-1 rounded bg-black/30 font-mono">PyPI</span>
                </button>
                <button
                  onClick={() => setFramework('telegraf')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    framework === 'telegraf' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Telegraf (JS)
                </button>
                <button
                  onClick={() => setFramework('grammy')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    framework === 'grammy' ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  grammY (TS)
                </button>
              </div>
            </div>

            {framework === 'python_javdb' && (
              <div className="p-4 rounded-xl bg-slate-900 border border-cyan-500/30 text-xs text-slate-300 space-y-2">
                <div className="flex items-center gap-2 text-cyan-400 font-semibold">
                  <ExternalLink className="w-4 h-4" />
                  <span>JavDB Python Scraper Integration (<a href="https://libraries.io/pypi/javdb" target="_blank" rel="noreferrer" className="underline">libraries.io/pypi/javdb</a>)</span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Install required Python packages: <code className="bg-slate-950 px-2 py-0.5 rounded text-cyan-300 font-mono">pip install javdb pyrogram tgcrypto</code>.
                  This script intercepts media groups, extracts the movie ID, scrapes full metadata from JavDB, and synchronizes the caption across every message in the album.
                </p>
              </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-6 py-4 bg-slate-950 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-mono text-slate-300">
                    {framework === 'python_javdb' ? 'bot.py (Python JavDB + Pyrogram)' : framework === 'telegraf' ? 'bot.js (Telegraf)' : 'bot.ts (grammY)'}
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(generatedCode)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs font-medium flex items-center gap-1.5 transition-colors border border-cyan-500/20"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCode ? 'Copied!' : 'Copy Code'}
                </button>
              </div>
              <div className="p-6 overflow-x-auto bg-slate-950">
                <pre className="text-xs font-mono text-slate-300 leading-relaxed">
                  <code>{generatedCode}</code>
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 bg-slate-900/40 py-4 text-center text-xs text-slate-500 font-mono">
        Telegram Bot Studio
      </footer>
    </div>
  </div>
);
}
