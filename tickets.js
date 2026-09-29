require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { SimpleShardingStrategy } = require('@discordjs/ws');
const {
    Client,
    GatewayIntentBits,
    Events,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    Status,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

// ============================================================
// ==================== CONFIG ================================
// ============================================================
const TICKET_BOT_TOKEN = process.env.TICKET_BOT_TOKEN || process.env.BOT_TOKEN_2;
const CLIENT_ID = process.env.TICKET_CLIENT_ID || process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '1554125892329017366';

const WEB_PORT = process.env.PORT || process.env.WEB_PORT || 3000;
const WEB_BASE_URL = process.env.WEB_BASE_URL || `http://localhost:${WEB_PORT}`;

const TICKET_CATEGORY_IDS = {
    purchase: process.env.TICKET_CATEGORY_PURCHASE || '',
    general: process.env.TICKET_CATEGORY_GENERAL || '',
};
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '';

const TICKET_LOG_CHANNEL_ID = process.env.TICKET_LOG_CHANNEL_ID || '';
const STAFF_ROLE_IDS = (process.env.STAFF_ROLE_IDS || '').split(',').filter(Boolean);

const TICKET_PREFIX = 'ticket-';
const MAX_TICKETS_PER_USER = 3;

const EMOJIS = {
    purchase: { name: '32877animatedarrowbluelite', id: '1542850802966601849' },
    general: { name: '15072animatedarrowpink2', id: '1542851211651452948' },
    create: { name: '129636pinkbunnybroken', id: '1549498465191591936' },
    myList: { name: '177869pinkbunnysweat', id: '1549498480672776365' },
    claim: { name: '291197pinkbunnyclap', id: '1549498511685455952' },
    transcript: { name: '357726pinkbunnyshy', id: '1549498563896016977' },
    close: { name: '699622289376804917', id: '1363251868347928801' },
    clear: { name: 'trash', id: '1377760283870629969' },
};

if (!TICKET_BOT_TOKEN) {
    console.error('❌ กรุณาตั้งค่า TICKET_BOT_TOKEN ในไฟล์ .env');
    process.exit(1);
}

const COLORS = {
    primary: 0x6366f1,
    success: 0x10b981,
    danger: 0xf43f5e,
    warning: 0xfbbf24,
    info: 0x00f0ff,
    gold: 0xfbbf24,
    purple: 0xc084fc,
};

const TICKET_TYPES = [
    {
        id: 'purchase',
        label: 'ติดต่อซื้อของ',
        description: 'สั่งซื้อสินค้า / สอบถามราคา',
        emoji: EMOJIS.purchase,
        color: COLORS.success,
        intro: 'กรุณาแจ้งรายการสินค้าที่ต้องการซื้อ + จำนวน + ช่องทางชำระเงิน',
    },
    {
        id: 'general',
        label: 'สอบถามทั่วไป',
        description: 'สอบถามข้อมูลทั่วไป',
        emoji: EMOJIS.general,
        color: COLORS.info,
        intro: 'กรุณาพิมพ์คำถามที่ต้องการสอบถามได้เลย ทีมงานจะตอบโดยเร็วที่สุด',
    },
];

const TRANSCRIPT_DIR = path.join(__dirname, 'transcripts');
const INDEX_FILE = path.join(TRANSCRIPT_DIR, 'index.json');

if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, JSON.stringify({ transcripts: [] }, null, 2));

// ============================================================
// ==================== DISCORD CLIENT ========================
// ============================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
    ],
    ws: {
        buildStrategy: (manager) => {
            manager.options.identifyProperties = {
                os: 'iOS',
                browser: 'Discord iOS',
                device: 'iOS',
            };
            return new SimpleShardingStrategy(manager);
        },
    },
});

// ============================================================
// ==================== HELPERS ===============================
// ============================================================
function generateId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function saveTranscript({ html, channelName, ownerTag, ownerId, messageCount, ticketType }) {
    const id = generateId();
    fs.writeFileSync(path.join(TRANSCRIPT_DIR, `${id}.html`), html, 'utf-8');

    let data = { transcripts: [] };
    try { data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { }

    data.transcripts.push({
        id, channelName, ownerTag, ownerId, messageCount, ticketType,
        createdAt: Date.now(),
    });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2));

    return { id, url: `${WEB_BASE_URL}/transcript/${id}` };
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const sec = Math.floor(diff / 1000);
    const min = Math.floor(sec / 60);
    const hr = Math.floor(min / 60);
    const day = Math.floor(hr / 24);

    if (day > 0) return `${day}d`;
    if (hr > 0) return `${hr}h`;
    if (min > 0) return `${min}m`;
    return 'now';
}

function renderComponent(comp, userMap = {}) {
    if (!comp) return '';
    const type = comp.type;

    if (type === 17) {
        const accent = comp.accentColor != null
            ? '#' + comp.accentColor.toString(16).padStart(6, '0')
            : '#6366f1';
        let inner = '';
        if (comp.components) {
            comp.components.forEach(c => { inner += renderComponent(c, userMap); });
        }
        return `<div class="embed" style="border-left-color: ${accent}">${inner}</div>`;
    }

    if (type === 9) {
        let textContent = '';
        let accessoryHtml = '';
        if (comp.components) {
            comp.components.forEach(c => {
                if (c.type === 10) textContent += renderComponent(c, userMap);
            });
        }
        if (comp.accessory) accessoryHtml = renderAccessory(comp.accessory);
        if (accessoryHtml) {
            return `<div style="display:flex;gap:16px;align-items:flex-start">
                <div style="flex:1;min-width:0">${textContent}</div>
                <div style="flex-shrink:0">${accessoryHtml}</div>
            </div>`;
        }
        return textContent;
    }

    if (type === 10) {
        const content = comp.content || '';
        return `<div class="embed-desc" style="margin-bottom:4px">${formatDiscordText(content, userMap)}</div>`;
    }

    if (type === 14) {
        const spacing = comp.spacing === 2 ? '12px' : '6px';
        return `<div class="divider" style="margin:${spacing} 0"></div>`;
    }

    if (type === 12) {
        let imgs = '';
        if (comp.items) {
            comp.items.forEach(item => {
                if (item.media?.url) {
                    imgs += `<img src="${escapeHtml(item.media.url)}" style="max-width:100%;border-radius:8px;margin:6px 0;display:block">`;
                }
            });
        }
        return imgs;
    }

    if (type === 1) {
        let buttons = '';
        if (comp.components) {
            comp.components.forEach(btn => {
                const label = escapeHtml(btn.label || '');
                const style = btn.style;
                let cls = 'btn-secondary';
                if (style === 1) cls = 'btn-primary';
                if (style === 3) cls = 'btn-success';
                if (style === 4) cls = 'btn-danger';

                let emojiHtml = '';
                if (btn.emoji?.id) {
                    emojiHtml = `<img src="https://cdn.discordapp.com/emojis/${btn.emoji.id}.${btn.emoji.animated ? 'gif' : 'png'}" style="width:18px;height:18px;vertical-align:middle;margin-right:6px">`;
                } else if (btn.emoji?.name) {
                    emojiHtml = `<span style="margin-right:6px">${escapeHtml(btn.emoji.name)}</span>`;
                }
                buttons += `<span class="btn ${cls}">${emojiHtml}${label}</span>`;
            });
        }
        return `<div class="action-row">${buttons}</div>`;
    }

    if (type === 11) {
        if (comp.media?.url) return `<img src="${escapeHtml(comp.media.url)}" class="thumb-sm">`;
        return '';
    }

    return '';
}

function renderAccessory(acc) {
    if (!acc) return '';
    if (acc.type === 11) {
        if (acc.media?.url) return `<img src="${escapeHtml(acc.media.url)}" class="thumb">`;
        return '';
    }
    if (acc.type === 2) {
        const label = escapeHtml(acc.label || '');
        let cls = 'btn-secondary';
        if (acc.style === 1) cls = 'btn-primary';
        if (acc.style === 3) cls = 'btn-success';
        if (acc.style === 4) cls = 'btn-danger';

        let emojiHtml = '';
        if (acc.emoji?.id) {
            emojiHtml = `<img src="https://cdn.discordapp.com/emojis/${acc.emoji.id}.${acc.emoji.animated ? 'gif' : 'png'}" style="width:16px;height:16px;vertical-align:middle;margin-right:4px">`;
        } else if (acc.emoji?.name) {
            emojiHtml = `<span style="margin-right:4px">${escapeHtml(acc.emoji.name)}</span>`;
        }
        return `<span class="btn btn-sm ${cls}">${emojiHtml}${label}</span>`;
    }
    return '';
}

function formatDiscordText(text, userMap = {}) {
    if (!text) return '';
    let html = escapeHtml(text);

    html = html.replace(/&lt;@!?(\d+)&gt;/g, (m, id) => {
        const name = userMap[id] || `${id.slice(-4)}`;
        return `<span class="mention">@${escapeHtml(name)}</span>`;
    });

    html = html.replace(/&lt;@&amp;(\d+)&gt;/g, (m, id) => {
        const name = userMap[id] || `role:${id.slice(-4)}`;
        return `<span class="mention">@${escapeHtml(name)}</span>`;
    });

    html = html.replace(/&lt;#(\d+)&gt;/g, (m, id) => {
        const name = userMap[id] || `ch:${id.slice(-4)}`;
        return `<span class="mention">#${escapeHtml(name)}</span>`;
    });

    html = html.replace(/&lt;t:(\d+)(?::([tTdDfFR]))?&gt;/g, (m, ts, fmt) => {
        const d = new Date(parseInt(ts) * 1000);
        const now = Date.now();
        const diff = Math.floor((now - d.getTime()) / 1000);

        if (fmt === 'R') {
            const abs = Math.abs(diff);
            let str;
            if (abs < 60) str = 'เมื่อสักครู่';
            else if (abs < 3600) str = `${Math.floor(abs / 60)} นาทีที่แล้ว`;
            else if (abs < 86400) str = `${Math.floor(abs / 3600)} ชั่วโมงที่แล้ว`;
            else str = `${Math.floor(abs / 86400)} วันที่แล้ว`;
            if (diff < 0) str = str.replace('ที่แล้ว', 'ข้างหน้า');
            return `<span style="color:var(--text-muted)">${str}</span>`;
        }
        return `<span style="color:var(--text-muted)">${d.toLocaleString('th-TH')}</span>`;
    });

    html = html.replace(/&lt;a?:(\w+):(\d+)&gt;/g, (m, name) => `<span style="display:inline-block;vertical-align:middle">:${name}:</span>`);

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text-primary);font-weight:700">$1</strong>');
    html = html.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');
    html = html.replace(/_([^_\n]+?)_/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<u>$1</u>');
    html = html.replace(/~~(.+?)~~/g, '<s style="color:var(--text-faint)">$1</s>');
    html = html.replace(/`([^`\n]+?)`/g, '<code style="background:rgba(168,85,247,0.15);padding:2px 6px;border-radius:4px;font-family:Consolas,monospace;font-size:0.85em;border:1px solid rgba(168,85,247,0.25);color:#e9d5ff">$1</code>');
    html = html.replace(/```([\s\S]+?)```/g, '<pre style="background:var(--bg-tertiary);padding:14px 16px;border-radius:8px;font-family:Consolas,monospace;font-size:0.85em;overflow-x:auto;margin:8px 0;border:1px solid var(--border);color:var(--text-primary)"><code>$1</code></pre>');

    html = html.replace(/(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--accent-2);text-decoration:underline;word-break:break-all">$1</a>');

    html = html.replace(/\n/g, '<br>');
    return html;
}

function buildTranscriptHtml({ channel, messages, owner, userMap = {} }) {
    const total = messages.length;
    const firstMsg = messages[0];
    const createdTs = firstMsg ? firstMsg.createdTimestamp : Date.now();

    const grouped = [];
    let lastAuthorId = null;
    let lastTs = 0;

    for (const m of messages) {
        const isSameAuthor = m.author.id === lastAuthorId;
        const isWithinTime = m.createdTimestamp - lastTs < 5 * 60 * 1000;
        const isCompact = isSameAuthor && isWithinTime && !m.reference;

        if (isCompact && grouped.length > 0) {
            grouped[grouped.length - 1].messages.push(m);
        } else {
            grouped.push({ author: m.author, messages: [m] });
        }
        lastAuthorId = m.author.id;
        lastTs = m.createdTimestamp;
    }

    const messagesHtml = grouped.map(group => {
        const author = group.author;
        const avatar = author.displayAvatarURL({ extension: 'png', size: 128 });
        const isBot = author.bot;

        const msgsHtml = group.messages.map((m, idx) => {
            const time = new Date(m.createdTimestamp).toLocaleString('th-TH', {
                hour: '2-digit', minute: '2-digit',
            });
            const fullTime = new Date(m.createdTimestamp).toLocaleString('th-TH', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            });

            let contentHtml = '';
            if (m.content) {
                contentHtml += `<div class="text">${formatDiscordText(m.content, userMap)}</div>`;
            }

            if (m.attachments && m.attachments.size > 0) {
                m.attachments.forEach(att => {
                    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(att.name || '');
                    if (isImage) {
                        contentHtml += `<div class="attachment"><img src="${escapeHtml(att.url)}" alt="${escapeHtml(att.name)}" loading="lazy"></div>`;
                    } else {
                        contentHtml += `<div class="attachment"><a href="${escapeHtml(att.url)}" target="_blank">📎 ${escapeHtml(att.name)}</a></div>`;
                    }
                });
            }

            if (m.embeds && m.embeds.length > 0) {
                m.embeds.forEach(emb => {
                    const accentColor = emb.color != null
                        ? '#' + emb.color.toString(16).padStart(6, '0')
                        : '#6366f1';
                    contentHtml += `<div class="embed" style="border-left-color: ${accentColor}">`;
                    if (emb.author?.name) {
                        contentHtml += `<div class="embed-author">${emb.author.iconURL ? `<img src="${escapeHtml(emb.author.iconURL)}">` : ''}${escapeHtml(emb.author.name)}</div>`;
                    }
                    if (emb.title) contentHtml += `<div class="embed-title">${escapeHtml(emb.title)}</div>`;
                    if (emb.description) contentHtml += `<div class="embed-desc">${formatDiscordText(emb.description, userMap)}</div>`;
                    if (emb.fields && emb.fields.length > 0) {
                        contentHtml += `<div class="embed-fields">`;
                        emb.fields.forEach(f => {
                            contentHtml += `<div class="embed-field"><div class="field-name">${escapeHtml(f.name)}</div><div class="field-value">${formatDiscordText(f.value, userMap)}</div></div>`;
                        });
                        contentHtml += `</div>`;
                    }
                    if (emb.footer?.text) {
                        contentHtml += `<div class="embed-footer">${escapeHtml(emb.footer.text)}</div>`;
                    }
                    contentHtml += `</div>`;
                });
            }

            if (m.components && m.components.length > 0) {
                m.components.forEach(comp => {
                    contentHtml += renderComponent(comp, userMap);
                });
            }

            if (!contentHtml) contentHtml = `<div class="text muted">[ไม่มีข้อความ]</div>`;

            if (idx === 0) {
                return `
                <div class="message first">
                    <img class="avatar" src="${avatar}" alt="avatar">
                    <div class="body">
                        <div class="message-header">
                            <span class="author ${isBot ? 'bot-author' : ''}">${escapeHtml(author.globalName || author.username || author.tag)}</span>
                            ${isBot ? '<span class="badge">BOT</span>' : ''}
                            <span class="time" title="${fullTime}">${fullTime}</span>
                        </div>
                        <div class="content">${contentHtml}</div>
                    </div>
                </div>`;
            } else {
                return `
                <div class="message compact">
                    <div class="compact-time" title="${fullTime}">${time}</div>
                    <div class="body">
                        <div class="content">${contentHtml}</div>
                    </div>
                </div>`;
            }
        }).join('');

        return `<div class="message-group">${msgsHtml}</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>#${escapeHtml(channel.name)} - Transcript</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>">
<style>
    :root {
        --bg-primary: #0f0f17;
        --bg-secondary: #16161f;
        --bg-tertiary: #1e1e2a;
        --bg-hover: #252535;
        --border: rgba(255, 255, 255, 0.06);
        --border-hover: rgba(168, 85, 247, 0.4);
        --text-primary: #f5f5f7;
        --text-secondary: #b8b8c4;
        --text-muted: #8a8a99;
        --text-faint: #5a5a6a;
        --accent-1: #6366f1;
        --accent-2: #a855f7;
        --accent-3: #ec4899;
        --gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
        --gradient-subtle: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.1), rgba(236,72,153,0.08));
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
        font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: 15px;
        line-height: 1.55;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
    }
    .app { display: flex; height: 100vh; overflow: hidden; }
    .sidebar {
        width: 260px; background: var(--bg-secondary);
        display: flex; flex-direction: column; flex-shrink: 0;
        border-right: 1px solid var(--border); position: relative;
    }
    .sidebar::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0;
        height: 3px; background: var(--gradient);
    }
    .sidebar-header {
        height: 60px; padding: 0 20px; display: flex; align-items: center;
        font-weight: 600; font-size: 14px; color: var(--text-primary);
        border-bottom: 1px solid var(--border); letter-spacing: -0.01em;
        background: var(--gradient-subtle);
    }
    .sidebar-header .hash {
        font-size: 18px; background: var(--gradient);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; margin-right: 8px; font-weight: 600;
    }
    .sidebar-scroll { flex: 1; overflow-y: auto; padding: 12px 10px; }
    .sidebar-scroll::-webkit-scrollbar { width: 6px; }
    .sidebar-scroll::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, var(--accent-1), var(--accent-2));
        border-radius: 3px;
    }
    .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
    .channel-category {
        padding: 16px 10px 6px; font-size: 11px; font-weight: 700;
        text-transform: uppercase; color: var(--accent-2);
        letter-spacing: 0.08em; opacity: 0.8;
    }
    .channel-item {
        display: flex; align-items: center; padding: 8px 10px;
        margin: 2px 0; border-radius: 8px; color: var(--text-secondary);
        text-decoration: none; font-size: 14px; font-weight: 500;
        transition: all 0.2s; border: 1px solid transparent;
        position: relative; overflow: hidden;
    }
    .channel-item::before {
        content: ''; position: absolute; left: 0; top: 0; bottom: 0;
        width: 3px; background: var(--gradient);
        transform: translateX(-100%); transition: transform 0.2s;
    }
    .channel-item:hover {
        background: var(--bg-hover); color: var(--text-primary);
        border-color: var(--border-hover);
    }
    .channel-item:hover::before { transform: translateX(0); }
    .channel-item.active {
        background: var(--bg-hover); color: var(--text-primary);
        border-color: var(--border-hover);
    }
    .channel-item.active::before { transform: translateX(0); }
    .channel-item .hash {
        font-size: 16px; color: var(--accent-2); margin-right: 8px;
        flex-shrink: 0; opacity: 0.6;
    }
    .channel-item .name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chat {
        flex: 1; display: flex; flex-direction: column;
        background: var(--bg-primary); min-width: 0; position: relative;
    }
    .chat::before {
        content: ''; position: absolute; top: 0; right: 0;
        width: 600px; height: 600px;
        background: radial-gradient(circle, rgba(168,85,247,0.08), transparent 70%);
        pointer-events: none;
    }
    .chat-header {
        height: 60px; padding: 0 24px; display: flex; align-items: center;
        border-bottom: 1px solid var(--border); flex-shrink: 0;
        background: rgba(22, 22, 31, 0.85); backdrop-filter: blur(20px);
        z-index: 10; position: relative;
    }
    .chat-header .hash {
        font-size: 22px; background: var(--gradient);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text; margin-right: 10px; font-weight: 600;
    }
    .chat-header .title {
        font-weight: 600; font-size: 15px; color: var(--text-primary);
        letter-spacing: -0.01em;
    }
    .chat-header .divider {
        width: 1px; height: 20px; background: var(--border); margin: 0 16px;
    }
    .chat-header .topic {
        color: var(--text-muted); font-size: 13px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .chat-messages {
        flex: 1; overflow-y: auto; padding: 24px 0 32px; position: relative;
    }
    .chat-messages::-webkit-scrollbar { width: 10px; }
    .chat-messages::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, var(--accent-1), var(--accent-2));
        border-radius: 5px; border: 3px solid var(--bg-primary);
        background-clip: padding-box;
    }
    .chat-messages::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, var(--accent-2), var(--accent-3));
        background-clip: padding-box;
    }
    .chat-messages::-webkit-scrollbar-track { background: transparent; }
    .welcome {
        padding: 16px 24px 28px; margin-bottom: 8px; position: relative;
    }
    .welcome .welcome-hash {
        width: 72px; height: 72px; border-radius: 20px;
        background: var(--gradient); display: flex; align-items: center;
        justify-content: center; font-size: 36px; color: #fff;
        margin-bottom: 16px; font-weight: 300;
        box-shadow: 0 12px 40px rgba(168, 85, 247, 0.4);
        animation: float 4s ease-in-out infinite;
    }
    @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
    }
    .welcome h1 {
        font-size: 30px; font-weight: 800; margin-bottom: 8px;
        background: var(--gradient); -webkit-background-clip: text;
        -webkit-text-fill-color: transparent; background-clip: text;
        letter-spacing: -0.02em;
    }
    .welcome p { color: var(--text-muted); font-size: 14px; }
    .message-group { padding: 0 24px; }
    .message {
        display: flex; gap: 16px; padding: 4px 0;
        position: relative; transition: background 0.15s; border-radius: 8px;
    }
    .message.first { margin-top: 20px; padding-top: 4px; }
    .message:hover { background: var(--bg-hover); }
    .message .avatar {
        width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
        cursor: pointer; object-fit: cover; margin-top: 2px;
        transition: transform 0.2s, box-shadow 0.2s; border: 2px solid transparent;
        background: linear-gradient(var(--bg-primary), var(--bg-primary)) padding-box,
                    var(--gradient) border-box;
    }
    .message .avatar:hover {
        transform: scale(1.1);
        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.35);
    }
    .message .body { flex: 1; min-width: 0; padding-right: 48px; }
    .message-header {
        display: flex; align-items: center; gap: 8px;
        margin-bottom: 4px; flex-wrap: wrap;
    }
    .message-header .author {
        font-weight: 600; font-size: 14px; color: var(--text-primary);
        cursor: pointer; letter-spacing: -0.01em;
    }
    .message-header .author:hover { text-decoration: underline; }
    .message-header .author.bot-author { color: var(--accent-2); }
    .message-header .badge {
        background: var(--gradient); color: #fff; font-size: 9px;
        padding: 2px 7px; border-radius: 4px; font-weight: 700;
        letter-spacing: 0.05em; text-transform: uppercase;
        box-shadow: 0 2px 8px rgba(168, 85, 247, 0.4);
    }
    .message-header .time {
        font-size: 11px; color: var(--text-faint); font-weight: 400;
    }
    .message .content {
        font-size: 15px; color: var(--text-secondary);
        word-wrap: break-word; overflow-wrap: anywhere;
    }
    .message .content .text { white-space: pre-wrap; }
    .message .content .text.muted { color: var(--text-faint); font-style: italic; }
    .message.compact { min-height: 24px; padding: 0; }
    .message.compact .compact-time {
        width: 40px; flex-shrink: 0; font-size: 10px;
        color: var(--text-faint); text-align: center; opacity: 0;
        padding-top: 4px; font-variant-numeric: tabular-nums;
        transition: opacity 0.15s;
    }
    .message.compact:hover .compact-time { opacity: 1; }
    .message.compact .body { padding-right: 48px; }
    .attachment { margin-top: 8px; }
    .attachment img {
        max-width: 400px; max-height: 350px; border-radius: 10px;
        cursor: pointer; display: block;
        transition: transform 0.2s, box-shadow 0.2s;
        border: 1px solid var(--border);
    }
    .attachment img:hover {
        transform: scale(1.02);
        box-shadow: 0 12px 40px rgba(168, 85, 247, 0.3);
        border-color: var(--border-hover);
    }
    .attachment a {
        display: inline-flex; align-items: center; gap: 8px;
        background: var(--bg-tertiary); padding: 10px 14px;
        border-radius: 8px; border: 1px solid var(--border);
        color: var(--accent-2); text-decoration: none;
        font-size: 13px; max-width: 400px; transition: all 0.2s;
    }
    .attachment a:hover {
        background: var(--bg-hover); border-color: var(--border-hover);
        color: var(--accent-3);
    }
    .embed {
        margin-top: 8px; padding: 16px; background: #000;
        border-left: 4px solid rgba(255,255,255,0.15);
        border-radius: 10px; max-width: 560px;
        position: relative; overflow: hidden; box-shadow: none;
    }
    .embed::before { display: none; }
    .embed > * { position: relative; z-index: 1; }
    .embed-author {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; font-weight: 600; color: var(--text-primary);
        margin-bottom: 10px;
    }
    .embed-author img { width: 20px; height: 20px; border-radius: 50%; }
    .embed-title {
        font-size: 15px; font-weight: 700; color: var(--text-primary);
        margin-bottom: 8px; letter-spacing: -0.01em;
    }
    .embed-desc {
        font-size: 14px; color: var(--text-secondary); line-height: 1.6;
    }
    .embed-fields {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px; margin-top: 10px;
    }
    .embed-field .field-name {
        font-size: 12px; font-weight: 600; color: var(--accent-2);
        margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.03em;
    }
    .embed-field .field-value { font-size: 14px; color: var(--text-secondary); }
    .embed-footer {
        font-size: 11px; color: var(--text-faint); margin-top: 12px;
        padding-top: 10px; border-top: 1px solid var(--border);
    }
    .embed .embed { margin-top: 10px; }
    .divider { height: 1px; background: var(--border); }
    .action-row { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
    .btn {
        display: inline-flex; align-items: center; padding: 8px 14px;
        border-radius: 8px; font-size: 13px; font-weight: 500;
        cursor: default; background: #000; color: #fff;
        border: 1px solid rgba(255,255,255,0.1);
        transition: all 0.15s; box-shadow: none;
    }
    .btn-sm { padding: 6px 12px; font-size: 12px; }
    .btn-primary  { background: #000; color: #fff; border-color: rgba(255,255,255,0.1); box-shadow: none; }
    .btn-secondary { background: #000; color: #fff; border-color: rgba(255,255,255,0.1); }
    .btn-success  { background: #000; color: #fff; border-color: rgba(255,255,255,0.1); box-shadow: none; }
    .btn-danger   { background: #000; color: #fff; border-color: rgba(255,255,255,0.1); box-shadow: none; }
    .thumb {
        width: 80px; height: 80px; border-radius: 12px;
        object-fit: cover; border: 2px solid var(--border);
    }
    .thumb-sm {
        max-width: 80px; max-height: 80px;
        border-radius: 10px; object-fit: cover;
    }
    .chat-end {
        padding: 40px 24px; text-align: center; color: var(--text-faint);
        font-size: 12px; margin-top: 24px; position: relative;
        letter-spacing: 0.05em; text-transform: uppercase;
    }
    .chat-end::before {
        content: ''; position: absolute; top: 0; left: 50%;
        transform: translateX(-50%); width: 80px; height: 3px;
        background: var(--gradient); border-radius: 0 0 4px 4px;
    }
    @media (max-width: 768px) {
        .sidebar { display: none; }
        .message .body { padding-right: 16px; }
        .message.compact .body { padding-right: 16px; }
        .welcome h1 { font-size: 22px; }
        .message-group { padding: 0 16px; }
        .chat-header { padding: 0 16px; }
        .welcome { padding: 16px 16px 20px; }
    }
    a { color: var(--accent-2); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .mention {
        background: rgba(168, 85, 247, 0.2); color: #e9d5ff;
        border-radius: 4px; padding: 1px 6px; font-weight: 500;
        font-size: 0.92em; border: 1px solid rgba(168, 85, 247, 0.3);
    }
</style>
</head>
<body>
<div class="app">
    <aside class="sidebar">
        <div class="sidebar-header">
            <span class="hash">#</span>
            <span>${escapeHtml(channel.name)}</span>
        </div>
        <div class="sidebar-scroll">
            <div class="channel-category">Ticket Info</div>
            <a class="channel-item active" href="#">
                <span class="hash">#</span>
                <span class="name">${escapeHtml(channel.name)}</span>
            </a>
            <div class="channel-category">Details</div>
            <div class="channel-item"><span class="name" style="padding-left:24px">👤 ${escapeHtml(owner.tag)}</span></div>
            <div class="channel-item"><span class="name" style="padding-left:24px">💬 ${total} ข้อความ</span></div>
            <div class="channel-item"><span class="name" style="padding-left:24px">🕐 ${new Date(createdTs).toLocaleString('th-TH')}</span></div>
        </div>
    </aside>

    <main class="chat">
        <header class="chat-header">
            <span class="hash">#</span>
            <span class="title">${escapeHtml(channel.name)}</span>
            <span class="divider"></span>
            <span class="topic">Ticket ของ ${escapeHtml(owner.tag)} • ${total} ข้อความ</span>
        </header>

        <div class="chat-messages" id="messages">
            <div class="welcome">
                <div class="welcome-hash">#</div>
                <h1>${escapeHtml(channel.name)}</h1>
                <p>จุดเริ่มต้นของห้อง • บันทึกเมื่อ ${new Date().toLocaleString('th-TH')}</p>
            </div>

            ${messagesHtml}

            <div class="chat-end">
                — สิ้นสุดบทสนทนา • ${total} ข้อความ —
            </div>
        </div>
    </main>
</div>

<script>
    const messagesEl = document.getElementById('messages');
    messagesEl.scrollTop = messagesEl.scrollHeight;

    document.querySelectorAll('.attachment img').forEach(img => {
        img.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out;padding:20px;backdrop-filter:blur(8px);animation:fadeIn 0.2s ease';
            const bigImg = document.createElement('img');
            bigImg.src = img.src;
            bigImg.style.cssText = 'max-width:100%;max-height:100%;border-radius:16px;box-shadow:0 20px 60px rgba(168,85,247,0.4);animation:zoomIn 0.25s ease';
            overlay.appendChild(bigImg);
            overlay.addEventListener('click', () => {
                overlay.style.animation = 'fadeOut 0.2s ease';
                setTimeout(() => overlay.remove(), 150);
            });
            document.body.appendChild(overlay);
        });
    });

    const style = document.createElement('style');
    style.textContent = \`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    \`;
    document.head.appendChild(style);
</script>
</body>
</html>`;
}

// ============================================================
// ==================== TICKET COMPONENTS =====================
// ============================================================
function buildTicketPanel() {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: 0x000000,
                components: [
                    { type: 10, content: '# `🎫`  **TICKET SYSTEM**' },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `-  **ติดต่อซื้อของ** — สั่งซื้อสินค้า / สอบถามราคา\n\n` +
                            `-  **สอบถามทั่วไป** — สอบถามข้อมูลต่างๆ`
                    },
                    { type: 14, divider: false, spacing: 1 },
                    {
                        type: 12,
                        items: [
                            {
                                media: {
                                    url: 'https://media.discordapp.net/attachments/1552288828910473267/1554483641625608324/1790688171573.jpg?ex=6abd0d35&is=6abbbbb5&hm=8a97fa21b45fe2abd17a115976b30476997391a140d5dee0d4c55e3bfb77b991&=&format=webp'
                                }
                            }
                        ]
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 2, style: 2, label: 'เปิด Ticket',
                                emoji: { animated: true, name: EMOJIS.create.name, id: EMOJIS.create.id },
                                custom_id: 'ticket_create',
                            },
                            {
                                type: 2, style: 2, label: 'ดู Ticket ของฉัน',
                                emoji: { animated: true, name: EMOJIS.myList.name, id: EMOJIS.myList.id },
                                custom_id: 'ticket_my_list',
                            },
                        ]
                    }
                ]
            }
        ]
    };
}

function buildTypeSelectMessage() {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: 0x000000,
                components: [
                    { type: 10, content: '# \`🎫\` เลือกประเภท Ticket\n**กรุณาเลือกหัวข้อที่ต้องการติดต่อ**' },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `-  **ติดต่อซื้อของ** — สั่งซื้อสินค้า / สอบถามราคา\n\n` +
                            `-  **สอบถามทั่วไป** — สอบถามข้อมูลต่างๆ`
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 3,
                                custom_id: 'ticket_type_select',
                                placeholder: '📋 เลือกประเภท Ticket ที่ต้องการ...',
                                options: [
                                    ...TICKET_TYPES.map(t => ({
                                        label: t.label,
                                        description: t.description,
                                        value: t.id,
                                        emoji: { animated: true, name: t.emoji.name, id: t.emoji.id }
                                    })),
                                    {
                                        label: 'ล้างตัวเลือก',
                                        description: 'รีเซ็ตกลับเป็นค่าเริ่มต้น',
                                        value: 'clear',
                                        emoji: { animated: true, name: EMOJIS.clear.name, id: EMOJIS.clear.id },
                                    },
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    };
}

function buildTicketWelcome({ user, typeInfo, ticketNumber }) {
    return {
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: 0x000000,
                components: [
                    {
                        type: 9,
                        components: [{ type: 10, content: `# ${typeInfo.label}\n\n- **Ticket #${ticketNumber} จาก <@${user.id}>**` }],
                        accessory: { type: 11, media: { url: user.displayAvatarURL({ dynamic: true, size: 256 }) } }
                    },
                    { type: 14, divider: true, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `- สวัสดี <@${user.id}> \`👋\` \n\n` +
                            `- ${typeInfo.intro}\n\n` +
                            `- \`⏱️\` **ทีมงานจะตอบกลับโดยเร็วที่สุด**`
                    },
                    { type: 14, divider: false, spacing: 1 },
                    {
                        type: 10,
                        content:
                            `- \`👤\` **ผู้เปิด:** <@${user.id}>\n\n` +
                            `- \`📁\` **ประเภท:** ${typeInfo.label}\n\n` +
                            `- \`🔢\` **Ticket #:** ${ticketNumber}\n\n` +
                            `- \`🕐\` **เวลา:** <t:${Math.floor(Date.now() / 1000)}:R>`
                    },
                    { type: 14, divider: false, spacing: 2 },
                    {
                        type: 1,
                        components: [
                            {
                                type: 2, style: 2, label: 'รับเรื่อง',
                                emoji: { animated: true, name: EMOJIS.claim.name, id: EMOJIS.claim.id },
                                custom_id: 'ticket_claim',
                            },
                            {
                                type: 2, style: 2, label: 'บันทึกบทสนทนา',
                                emoji: { animated: true, name: EMOJIS.transcript.name, id: EMOJIS.transcript.id },
                                custom_id: 'ticket_transcript',
                            },
                            {
                                type: 2, style: 2, label: 'ปิด Ticket',
                                emoji: { animated: true, name: EMOJIS.close.name, id: EMOJIS.close.id },
                                custom_id: 'ticket_close',
                            },
                        ]
                    }
                ]
            }
        ]
    };
}

// ============================================================
// ==================== TICKET LOGIC ==========================
// ============================================================
function getCategoryIdForType(typeId) {
    if (TICKET_CATEGORY_IDS[typeId]) return TICKET_CATEGORY_IDS[typeId];
    return TICKET_CATEGORY_ID || null;
}

async function ensureCategory(guild, typeInfo) {
    const existingId = getCategoryIdForType(typeInfo.id);
    if (existingId) {
        const existing = guild.channels.cache.get(existingId);
        if (existing) return existing;
    }

    try {
        const category = await guild.channels.create({
            name: `🎫 ${typeInfo.label}`,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                ...STAFF_ROLE_IDS.map(roleId => ({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                })),
            ],
        });
        console.log(`✅ สร้าง category "${typeInfo.label}" อัตโนมัติ: ${category.id}`);
        return category;
    } catch (err) {
        console.error('Create category error:', err.message);
        return null;
    }
}

function getNextTicketNumber(guild) {
    let maxNum = 0;
    guild.channels.cache.forEach(ch => {
        if (ch.name && ch.name.startsWith(TICKET_PREFIX)) {
            const match = ch.name.match(/^ticket-(\d+)/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) maxNum = num;
            }
        }
    });
    return maxNum + 1;
}

function formatTicketNumber(num) {
    return String(num).padStart(3, '0');
}

async function createTicketChannel(interaction, ticketTypeId) {
    const guild = interaction.guild;
    const user = interaction.user;
    const typeInfo = TICKET_TYPES.find(t => t.id === ticketTypeId) || TICKET_TYPES[0];

    const existingChannels = guild.channels.cache.filter(ch =>
        ch.name.startsWith(TICKET_PREFIX) &&
        ch.type === ChannelType.GuildText &&
        ch.permissionOverwrites.cache.has(user.id)
    );

    if (existingChannels.size >= MAX_TICKETS_PER_USER) {
        throw new Error(`คุณมี Ticket เปิดอยู่แล้ว ${existingChannels.size} ห้อง (สูงสุด ${MAX_TICKETS_PER_USER} ห้อง)\nกรุณาปิด Ticket เก่าก่อน`);
    }

    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        },
    ];

    STAFF_ROLE_IDS.forEach(roleId => {
        permissionOverwrites.push({
            id: roleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
            ],
        });
    });

    const ticketNumber = getNextTicketNumber(guild);
    const ticketNumberStr = formatTicketNumber(ticketNumber);
    const rawName = user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 15);
    const username = rawName || user.id.slice(-6);

    const channelOptions = {
        name: `${TICKET_PREFIX}${ticketNumberStr}-${username}`,
        type: ChannelType.GuildText,
        permissionOverwrites,
        topic: `Ticket #${ticketNumberStr} ของ ${user.tag} ประเภท: ${typeInfo.label}`,
    };

    const category = await ensureCategory(guild, typeInfo);
    if (category) channelOptions.parent = category.id;

    const ticketChannel = await guild.channels.create(channelOptions);

    await ticketChannel.send(buildTicketWelcome({ user, typeInfo, ticketNumber: ticketNumberStr }));

    if (TICKET_LOG_CHANNEL_ID) {
        try {
            const logCh = await client.channels.fetch(TICKET_LOG_CHANNEL_ID);
            if (logCh) {
                await logCh.send({
                    flags: 32768,
                    components: [
                        {
                            type: 17,
                            accent_color: 0x000000,
                            components: [
                                { type: 10, content: `# 🎫 Ticket ใหม่ #${ticketNumberStr}\n**<@${user.id}> เปิด Ticket**` },
                                { type: 14, divider: true, spacing: 1 },
                                {
                                    type: 10,
                                    content:
                                        `- \`👤\` **ผู้เปิด:** <@${user.id}>\n` +
                                        `- \`🔢\` **Ticket #:** ${ticketNumberStr}\n` +
                                        `- \`📁\` **ประเภท:**  ${typeInfo.label}\n` +
                                        `-  **ห้อง:** <#${ticketChannel.id}>`
                                }
                            ]
                        }
                    ]
                });
            }
        } catch (err) {
            console.error('Log error:', err.message);
        }
    }

    return ticketChannel;
}

async function closeTicket(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    const guildIcon = interaction.guild.iconURL({ size: 256 }) ?? null;
    const deleteAt = Math.floor(Date.now() / 1000) + 5;

    const closeEmbed = new EmbedBuilder()
        .setColor(COLORS.danger)
        .setAuthor({
            name: `${interaction.guild.name} • ระบบ Ticket`,
            iconURL: guildIcon ?? undefined,
        })
        .setTitle('🔒 กำลังปิด Ticket')
        .setDescription(
            '- **ขอบคุณที่ใช้บริการค้าบ** `💙`\n' +
            '`ระบบกำลังลบห้องนี้ในอีกไม่กี่วินาที`'
        )
        .addFields(
            { name: '👤 ปิดโดย', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📁 ห้อง', value: `\`${channel.name}\``, inline: true },
            { name: '⏳ ลบห้อง', value: `<t:${deleteAt}:R>`, inline: true }
        )
        .setFooter({ text: interaction.guild.name, iconURL: guildIcon ?? undefined })
        .setTimestamp();

    if (guildIcon) closeEmbed.setThumbnail(guildIcon);

    await interaction.reply({ embeds: [closeEmbed] });

    setTimeout(async () => {
        try { await channel.delete(`Ticket closed by ${interaction.user.tag}`); }
        catch (err) { console.error('Delete channel error:', err.message); }
    }, 5000);
}

async function listMyTickets(interaction) {
    const guild = interaction.guild;
    const user = interaction.user;

    const myTickets = guild.channels.cache.filter(ch =>
        ch.name.startsWith(TICKET_PREFIX) &&
        ch.type === ChannelType.GuildText &&
        ch.permissionOverwrites.cache.has(user.id)
    );

    if (myTickets.size === 0) {
        return interaction.reply({
            flags: 32768 | 64,
            components: [
                {
                    type: 17,
                    accent_color: 0x000000,
                    components: [
                        { type: 10, content: '# \`📭\` **ยังไม่มี Ticket**\n**คุณยังไม่มี Ticket ที่เปิดอยู่**' }
                    ]
                }
            ]
        });
    }

    const ticketLines = myTickets.map(ch =>
        `> • <#${ch.id}> — <t:${Math.floor(ch.createdTimestamp / 1000)}:R>`
    ).join('\n');

    return interaction.reply({
        flags: 32768 | 64,
        components: [
            {
                type: 17,
                accent_color: 0x000000,
                components: [
                    { type: 10, content: `# \`📋\` **Ticket ของคุณ**\n**ทั้งหมด ${myTickets.size} ห้อง**` },
                    { type: 14, divider: true, spacing: 1 },
                    { type: 10, content: ticketLines }
                ]
            }
        ]
    });
}

async function claimTicket(interaction) {
    const channel = interaction.channel;
    const member = interaction.member;

    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    const isStaff = STAFF_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    if (!isStaff && !isAdmin) {
        return interaction.reply({ content: '❌ เฉพาะทีมงานเท่านั้นที่รับเรื่องได้', ephemeral: true });
    }

    return interaction.reply({
        flags: 32768,
        components: [
            {
                type: 17,
                accent_color: 0x000000,
                components: [
                    { type: 10, content: `# \`✋\` **รับเรื่องแล้ว**\n**<@${member.id}> รับผิดชอบ Ticket นี้**` }
                ]
            }
        ]
    });
}

async function fetchAllMessages(channel, maxMessages = 2000) {
    const allMessages = [];
    let lastId = null;

    while (allMessages.length < maxMessages) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;

        allMessages.push(...fetched.values());
        lastId = fetched.last().id;
        if (fetched.size < 100) break;
    }

    return allMessages.reverse();
}

async function transcriptTicket(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith(TICKET_PREFIX)) {
        return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const sorted = await fetchAllMessages(channel, 2000);

    const userMap = {};
    try {
        await interaction.guild.members.fetch();
        interaction.guild.members.cache.forEach(m => {
            userMap[m.id] = m.user.globalName || m.user.username;
        });
    } catch (err) {
        console.error('Fetch members error:', err.message);
    }

    interaction.guild.channels.cache.forEach(ch => {
        userMap[ch.id] = ch.name;
    });

    interaction.guild.roles.cache.forEach(r => {
        userMap[r.id] = r.name;
    });

    sorted.forEach(m => {
        if (m.author && !userMap[m.author.id]) {
            userMap[m.author.id] = m.author.globalName || m.author.username;
        }
    });

    const botId = client.user.id;
    const ownerOverwrite = channel.permissionOverwrites.cache.find(
        ow =>
            ow.type === 1 &&
            ow.id !== botId &&
            !STAFF_ROLE_IDS.includes(ow.id) &&
            ow.allow.has(PermissionFlagsBits.ViewChannel)
    );

    if (!ownerOverwrite) {
        return interaction.editReply({ content: '❌ ไม่พบเจ้าของ Ticket ไม่สามารถส่ง DM ได้' });
    }

    const ownerId = ownerOverwrite.id;

    try {
        const owner = await client.users.fetch(ownerId);

        const html = buildTranscriptHtml({ channel, messages: sorted, owner, userMap });

        const typeMatch = channel.name.match(/^ticket-\d+-(\w+)/);
        const ticketType = typeMatch ? typeMatch[1] : 'unknown';

        const { url } = saveTranscript({
            html,
            channelName: channel.name,
            ownerTag: owner.tag,
            ownerId: owner.id,
            messageCount: sorted.length,
            ticketType,
        });

        const guildIcon = interaction.guild.iconURL({ size: 256 }) ?? null;

        const dmEmbed = new EmbedBuilder()
            .setColor(COLORS.primary)
            .setAuthor({
                name: `${interaction.guild.name} • ระบบ Ticket`,
                iconURL: guildIcon ?? undefined,
            })
            .setTitle('📄 บันทึกบทสนทนา Ticket')
            .setDescription(
                '- **ขอบคุณที่ใช้บริการค้าบ** `💙`\n' +
                '`กดปุ่มด้านล่างเพื่อดูบันทึกบทสนทนาทั้งหมดได้เลย`'
            )
            .addFields(
                { name: '📁 ห้อง', value: `\`${channel.name}\``, inline: true },
                { name: '💬 จำนวนข้อความ', value: `\`${sorted.length}\` ข้อความ`, inline: true },
                { name: '🕒 บันทึกเมื่อ', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setFooter({ text: interaction.guild.name, iconURL: guildIcon ?? undefined })
            .setTimestamp();

        if (guildIcon) dmEmbed.setThumbnail(guildIcon);

        const dmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('ดูบันทึกบทสนทนา')
                .setEmoji('<a:13071f514:1543925599331160094>')
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        await owner.send({ embeds: [dmEmbed], components: [dmRow] });

        const successEmbed = new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('✅ ส่งบันทึกสำเร็จ')
            .setDescription(`- **ส่งลิงก์บันทึกไปที่ DM ของ** <@${ownerId}> **เรียบร้อยแล้ว**`)
            .addFields(
                { name: '📁 ห้อง', value: `\`${channel.name}\``, inline: true },
                { name: '💬 ข้อความ', value: `\`${sorted.length}\``, inline: true }
            )
            .setTimestamp();

        const successRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('เปิดดูบันทึก')
                .setEmoji('<a:13071f514:1543925599331160094>')
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );

        return interaction.editReply({
            content: '',
            embeds: [successEmbed],
            components: [successRow],
        });
    } catch (err) {
        console.error('Transcript error:', err.message);
        const errorEmbed = new EmbedBuilder()
            .setColor(COLORS.danger)
            .setTitle('❌ ส่ง DM ไม่สำเร็จ')
            .setDescription(
                `ไม่สามารถส่งข้อความไปหา <@${ownerId}> ได้\n` +
                `> อาจปิดรับข้อความส่วนตัวจากเซิร์ฟเวอร์`
            )
            .setTimestamp();

        return interaction.editReply({
            content: '',
            embeds: [errorEmbed],
            components: [],
        });
    }
}

// ============================================================
// ==================== EVENT HANDLERS ========================
// ============================================================
client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'ticket-panel') {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: '❌ เฉพาะแอดมินเท่านั้น', ephemeral: true });
                }
                await interaction.channel.send(buildTicketPanel());
                return interaction.reply({ content: '✅ ส่งแผง Ticket สำเร็จ!', ephemeral: true });
            }

            if (interaction.commandName === 'ticket-close') return closeTicket(interaction);

            if (interaction.commandName === 'ticket-add') {
                const targetUser = interaction.options.getUser('user');
                const channel = interaction.channel;
                if (!channel.name.startsWith(TICKET_PREFIX)) {
                    return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
                }
                await channel.permissionOverwrites.edit(targetUser.id, {
                    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
                });
                return interaction.reply({ content: `✅ เพิ่ม <@${targetUser.id}> เข้า Ticket แล้ว` });
            }

            if (interaction.commandName === 'ticket-remove') {
                const targetUser = interaction.options.getUser('user');
                const channel = interaction.channel;
                if (!channel.name.startsWith(TICKET_PREFIX)) {
                    return interaction.reply({ content: '❌ ห้องนี้ไม่ใช่ Ticket', ephemeral: true });
                }
                await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: false });
                return interaction.reply({ content: `✅ ลบ <@${targetUser.id}> ออกจาก Ticket แล้ว` });
            }
        }

        if (interaction.isButton()) {
            if (interaction.customId === 'ticket_create') {
                const payload = buildTypeSelectMessage();
                payload.flags = 32768 | 64;
                return interaction.reply(payload);
            }
            if (interaction.customId === 'ticket_close') return closeTicket(interaction);
            if (interaction.customId === 'ticket_claim') return claimTicket(interaction);
            if (interaction.customId === 'ticket_transcript') return transcriptTicket(interaction);
            if (interaction.customId === 'ticket_my_list') return listMyTickets(interaction);
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'ticket_type_select') {
                const typeId = interaction.values[0];
                await interaction.deferUpdate();

                if (typeId === 'clear') {
                    const payload = buildTypeSelectMessage();
                    payload.flags = 32768 | 64;
                    return interaction.editReply(payload);
                }

                try {
                    const ticketChannel = await createTicketChannel(interaction, typeId);
                    await interaction.editReply({
                        flags: 32768 | 64,
                        components: [
                            {
                                type: 17,
                                accent_color: 0x000000,
                                components: [
                                    { type: 10, content: `# ✅ สร้าง Ticket สำเร็จ!\n**ห้องของคุณ: <#${ticketChannel.id}>**` }
                                ]
                            }
                        ]
                    });
                } catch (err) {
                    console.error('Create ticket error:', err);
                    await interaction.editReply({
                        flags: 32768 | 64,
                        components: [
                            {
                                type: 17,
                                accent_color: 0x000000,
                                components: [
                                    { type: 10, content: `# ❌ ไม่สามารถสร้าง Ticket ได้\n${err.message}` }
                                ]
                            }
                        ]
                    });
                }
            }
        }
    } catch (err) {
        console.error('Interaction error:', err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: '❌ เกิดข้อผิดพลาด', ephemeral: true }).catch(() => { });
        }
    }
});

client.once(Events.ClientReady, async (c) => {
    console.log(`✅ Ticket Bot online: ${c.user.tag}`);

    c.user.setPresence({
        activities: [{ name: 'Vendetta Shop', type: ActivityType.Watching }],
        status: Status.Online,
    });

    try {
        const rest = new REST({ version: '10' }).setToken(TICKET_BOT_TOKEN);
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            {
                body: [
                    new SlashCommandBuilder()
                        .setName('ticket-panel')
                        .setDescription('ส่งแผงเปิด Ticket')
                        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
                        .toJSON(),
                ]
            }
        );
        console.log('✅ Slash commands synced');
    } catch (err) {
        console.error('❌ Sync commands failed:', err.message);
    }
});

// ============================================================
// ==================== WEB SERVER ============================
// ============================================================
const app = express();

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/transcript/:id', (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = path.join(TRANSCRIPT_DIR, `${id}.html`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html><head><meta charset="UTF-8"><title>404 — Not Found</title>
            <style>
                body{font-family:'Inter',-apple-system,sans-serif;background:#0f0f17;color:#f5f5f7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}
                .box{max-width:400px}
                .code{font-size:96px;font-weight:800;background:linear-gradient(135deg,#6366f1,#a855f7,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:16px;letter-spacing:-0.05em;line-height:1}
                h1{font-size:22px;color:#f5f5f7;margin-bottom:12px;font-weight:600;letter-spacing:-0.01em}
                p{color:#8a8a99;font-size:14px;line-height:1.6}
                a{display:inline-block;margin-top:32px;background:linear-gradient(135deg,#6366f1,#a855f7,#ec4899);color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;transition:all 0.2s;box-shadow:0 8px 24px rgba(168,85,247,0.35)}
                a:hover{transform:translateY(-2px);box-shadow:0 12px 32px rgba(168,85,247,0.5)}
            </style></head>
            <body><div class="box">
            <div class="code">404</div>
            <h1>ไม่พบ Transcript</h1>
            <p>ลิงก์นี้อาจหมดอายุ ถูกลบไปแล้ว หรือ ID ไม่ถูกต้อง</p>
            <a href="/">← กลับหน้าแรก</a>
            </div></body></html>
        `);
    }
    res.sendFile(filePath);
});

app.get('/', (req, res) => {
    let data = { transcripts: [] };
    try { data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch { }

    const byType = {};
    data.transcripts.forEach(t => {
        const type = t.ticketType || 'unknown';
        if (!byType[type]) byType[type] = [];
        byType[type].push(t);
    });

    Object.keys(byType).forEach(k => {
        byType[k].sort((a, b) => b.createdAt - a.createdAt);
    });

    const typeLabels = {
        purchase: 'Purchase',
        general: 'General',
        unknown: 'Other',
    };

    let sidebarHtml = '';
    Object.keys(byType).forEach(type => {
        const count = byType[type].length;
        sidebarHtml += `
            <div class="channel-category">
                <span>${escapeHtml(typeLabels[type] || type)}</span>
                <span class="cat-count">${count}</span>
            </div>
        `;
        byType[type].forEach(t => {
            const ago = timeAgo(t.createdAt);
            sidebarHtml += `
                <a class="channel-item" href="/transcript/${t.id}">
                    <span class="hash">#</span>
                    <div class="item-content">
                        <span class="name">${escapeHtml(t.channelName)}</span>
                        <span class="item-sub">${escapeHtml(t.ownerTag)} · ${ago}</span>
                    </div>
                    <span class="item-count">${t.messageCount}</span>
                </a>
            `;
        });
    });

    res.send(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Transcripts</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>">
<style>
    :root {
        --bg-primary: #0f0f17;
        --bg-secondary: #16161f;
        --bg-tertiary: #1e1e2a;
        --bg-hover: #252535;
        --border: rgba(255, 255, 255, 0.06);
        --border-hover: rgba(168, 85, 247, 0.4);
        --text-primary: #f5f5f7;
        --text-secondary: #b8b8c4;
        --text-muted: #8a8a99;
        --text-faint: #5a5a6a;
        --accent-1: #6366f1;
        --accent-2: #a855f7;
        --accent-3: #ec4899;
        --gradient: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
        --gradient-subtle: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.1), rgba(236,72,153,0.08));
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
        font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: 15px;
        line-height: 1.55;
        overflow: hidden;
        -webkit-font-smoothing: antialiased;
    }
    .app { display: flex; height: 100vh; overflow: hidden; }
    .sidebar {
        width: 340px;
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        border-right: 1px solid var(--border);
        position: relative;
    }
    .sidebar::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 4px;
        background: var(--gradient);
        z-index: 2;
    }
    .sidebar-header {
        padding: 26px 20px 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        border-bottom: 1px solid var(--border);
        background: var(--gradient-subtle);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
        width: 44px; height: 44px; border-radius: 12px;
        background: var(--gradient); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 22px; flex-shrink: 0;
        box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
        animation: pulse 3s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% { box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4); }
        50% { box-shadow: 0 8px 32px rgba(236, 72, 153, 0.6); }
    }
    .brand-text h1 {
        font-size: 16px; font-weight: 700;
        color: var(--text-primary); letter-spacing: -0.02em;
        background: var(--gradient); -webkit-background-clip: text;
        -webkit-text-fill-color: transparent; background-clip: text;
    }
    .brand-text p { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .search-box { position: relative; }
    .search-box input {
        width: 100%; background: var(--bg-primary);
        border: 1px solid var(--border); color: var(--text-primary);
        padding: 10px 12px 10px 38px; border-radius: 10px;
        font-size: 13px; font-family: inherit; outline: none;
        transition: all 0.2s;
    }
    .search-box input:focus {
        border-color: var(--accent-2); background: var(--bg-tertiary);
        box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.15);
    }
    .search-box input::placeholder { color: var(--text-faint); }
    .search-box .search-icon {
        position: absolute; left: 14px; top: 50%;
        transform: translateY(-50%); color: var(--text-faint);
        font-size: 13px; pointer-events: none;
    }
    .sidebar-scroll { flex: 1; overflow-y: auto; padding: 12px 10px 24px; }
    .sidebar-scroll::-webkit-scrollbar { width: 6px; }
    .sidebar-scroll::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, var(--accent-1), var(--accent-2));
        border-radius: 3px;
    }
    .sidebar-scroll::-webkit-scrollbar-thumb:hover {
        background: linear-gradient(180deg, var(--accent-2), var(--accent-3));
    }
    .channel-category {
        padding: 16px 10px 6px; font-size: 11px; font-weight: 700;
        text-transform: uppercase; color: var(--accent-2);
        letter-spacing: 0.08em; display: flex;
        align-items: center; justify-content: space-between;
        opacity: 0.8;
    }
    .channel-category .cat-count {
        background: rgba(168, 85, 247, 0.15);
        padding: 1px 8px; border-radius: 10px;
        font-size: 10px; font-weight: 600;
        color: var(--accent-2); letter-spacing: 0;
    }
    .channel-item {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; margin: 2px 0; border-radius: 10px;
        color: var(--text-secondary); text-decoration: none;
        font-size: 14px; font-weight: 500; cursor: pointer;
        transition: all 0.2s; border: 1px solid transparent;
        position: relative; overflow: hidden;
    }
    .channel-item::before {
        content: ''; position: absolute; left: 0; top: 0; bottom: 0;
        width: 3px; background: var(--gradient);
        transform: translateX(-100%); transition: transform 0.25s;
    }
    .channel-item:hover {
        background: var(--bg-hover); color: var(--text-primary);
        border-color: var(--border-hover); transform: translateX(2px);
    }
    .channel-item:hover::before { transform: translateX(0); }
    .channel-item .hash {
        font-size: 16px; color: var(--accent-2);
        flex-shrink: 0; font-weight: 400; opacity: 0.7;
    }
    .channel-item .item-content {
        flex: 1; min-width: 0; display: flex;
        flex-direction: column; gap: 2px;
    }
    .channel-item .name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        color: var(--text-primary); font-weight: 500; font-size: 13px;
    }
    .channel-item .item-sub {
        font-size: 11px; color: var(--text-faint);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .channel-item .item-count {
        background: rgba(168, 85, 247, 0.15);
        padding: 2px 8px; border-radius: 10px;
        font-size: 10px; font-weight: 600;
        color: var(--accent-2); flex-shrink: 0;
    }
    .empty-state {
        padding: 60px 20px; text-align: center; color: var(--text-faint);
    }
    .empty-state .icon {
        font-size: 40px; margin-bottom: 16px; opacity: 0.4;
    }
    .empty-state p { font-size: 13px; line-height: 1.6; }
    .main {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; padding: 40px;
        background: var(--bg-primary); position: relative; overflow: hidden;
    }
    .main::before {
        content: ''; position: absolute; inset: 0;
        background:
            radial-gradient(ellipse at top right, rgba(99, 102, 241, 0.15), transparent 50%),
            radial-gradient(ellipse at bottom left, rgba(236, 72, 153, 0.12), transparent 50%),
            radial-gradient(ellipse at center, rgba(168, 85, 247, 0.08), transparent 70%);
        pointer-events: none;
    }
    .main::after {
        content: ''; position: absolute; inset: 0;
        background-image:
            linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
        background-size: 40px 40px;
        pointer-events: none;
        mask-image: radial-gradient(ellipse at center, black, transparent 70%);
    }
    .main-content {
        position: relative; z-index: 1;
        animation: fadeIn 0.6s ease; max-width: 600px;
    }
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(16px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .hero-icon {
        width: 96px; height: 96px; border-radius: 24px;
        background: var(--gradient); display: flex;
        align-items: center; justify-content: center;
        font-size: 44px; margin: 0 auto 24px; color: #fff;
        box-shadow: 0 20px 60px rgba(168, 85, 247, 0.45);
        animation: float 4s ease-in-out infinite;
    }
    @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
    }
    .main h1 {
        font-size: 44px; font-weight: 800; color: var(--text-primary);
        margin-bottom: 12px; letter-spacing: -0.03em; line-height: 1.1;
    }
    .main h1 .accent {
        background: var(--gradient); -webkit-background-clip: text;
        -webkit-text-fill-color: transparent; background-clip: text;
    }
    .main .subtitle {
        color: var(--text-muted); font-size: 15px;
        margin-bottom: 40px; line-height: 1.6;
    }
    .stats {
        display: flex; gap: 14px; margin-bottom: 40px;
        flex-wrap: wrap; justify-content: center;
    }
    .stat-card {
        background: rgba(22, 22, 31, 0.7);
        backdrop-filter: blur(20px);
        padding: 22px 30px; border-radius: 16px;
        min-width: 140px; border: 1px solid var(--border);
        transition: all 0.25s; text-align: left;
        position: relative; overflow: hidden;
    }
    .stat-card::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0;
        height: 2px; background: var(--gradient);
        opacity: 0; transition: opacity 0.25s;
    }
    .stat-card:hover {
        border-color: var(--border-hover);
        transform: translateY(-4px);
        box-shadow: 0 16px 40px rgba(168, 85, 247, 0.25);
    }
    .stat-card:hover::before { opacity: 1; }
    .stat-card .num {
        font-size: 34px; font-weight: 800;
        background: var(--gradient); -webkit-background-clip: text;
        -webkit-text-fill-color: transparent; background-clip: text;
        margin-bottom: 6px; line-height: 1; letter-spacing: -0.03em;
    }
    .stat-card .label {
        font-size: 11px; color: var(--text-faint);
        text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;
    }
    .hint {
        display: inline-flex; align-items: center; gap: 10px;
        background: rgba(22, 22, 31, 0.7);
        backdrop-filter: blur(20px);
        padding: 12px 20px; border-radius: 999px;
        border: 1px solid var(--border);
        font-size: 12px; color: var(--text-muted);
    }
    .hint kbd {
        background: var(--bg-tertiary); padding: 3px 9px;
        border-radius: 6px; font-family: 'SF Mono', Consolas, monospace;
        font-size: 11px; color: var(--accent-2);
        border: 1px solid rgba(168, 85, 247, 0.25); font-weight: 600;
    }
    @media (max-width: 900px) {
        .main { display: none; }
        .sidebar { width: 100%; max-width: 100%; }
        .app { flex-direction: column; }
        .sidebar { height: 100vh; }
    }
</style>
</head>
<body>
<div class="app">
    <aside class="sidebar">
        <div class="sidebar-header">
            <div class="brand">
                <div class="brand-logo">💬</div>
                <div class="brand-text">
                    <h1>Transcripts</h1>
                    <p>${data.transcripts.length} บันทึก</p>
                </div>
            </div>
            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="searchInput" placeholder="ค้นหา...">
            </div>
        </div>
        <div class="sidebar-scroll" id="sidebarScroll">
            ${sidebarHtml || `
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>ยังไม่มี transcript</p>
                </div>
            `}
        </div>
    </aside>

    <main class="main">
        <div class="main-content">
            <div class="hero-icon">💬</div>
            <h1>Ticket <span class="accent">Transcripts</span></h1>
            <p class="subtitle">เลือกห้องจากแถบด้านซ้ายเพื่อดูบันทึกบทสนทนา</p>

            <div class="stats">
                <div class="stat-card">
                    <div class="num">${data.transcripts.length}</div>
                    <div class="label">Transcripts</div>
                </div>
                <div class="stat-card">
                    <div class="num">${Object.keys(byType).length}</div>
                    <div class="label">Categories</div>
                </div>
                <div class="stat-card">
                    <div class="num">${data.transcripts.reduce((s, t) => s + (t.messageCount || 0), 0)}</div>
                    <div class="label">Messages</div>
                </div>
            </div>

            <div class="hint">
                <span>💡</span>
                <span>กด <kbd>Ctrl</kbd> <kbd>K</kbd> เพื่อค้นหา</span>
            </div>
        </div>
    </main>
</div>

<script>
    const searchInput = document.getElementById('searchInput');
    const sidebarScroll = document.getElementById('sidebarScroll');

    searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const items = sidebarScroll.querySelectorAll('.channel-item');
        const cats = sidebarScroll.querySelectorAll('.channel-category');

        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(q) ? '' : 'none';
        });

        cats.forEach(cat => {
            let next = cat.nextElementSibling;
            let hasVisible = false;
            while (next && !next.classList.contains('channel-category')) {
                if (next.classList.contains('channel-item') && next.style.display !== 'none') {
                    hasVisible = true;
                    break;
                }
                next = next.nextElementSibling;
            }
            cat.style.display = hasVisible || q === '' ? '' : 'none';
        });
    });

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
        }
    });

    sidebarScroll.querySelectorAll('.channel-item').forEach((item, i) => {
        item.style.opacity = '0';
        item.style.transform = 'translateX(-10px)';
        setTimeout(() => {
            item.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            item.style.opacity = '1';
            item.style.transform = 'translateX(0)';
        }, i * 30);
    });
</script>
</body>
</html>
    `);
});

app.listen(WEB_PORT, () => {
    console.log(`✅ Web server online: ${WEB_BASE_URL}`);
});

client.login(TICKET_BOT_TOKEN).catch(err => {
    console.error('❌ Ticket bot login failed:', err.message);
    process.exit(1);
});
