const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォント登録 ---
try {
    const fontPath = path.join(__dirname, '..', 'fonts');
    GlobalFonts.registerFromPath(path.join(fontPath, 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(fontPath, 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
    GlobalFonts.registerFromPath(path.join(fontPath, 'NotoSansJP-Regular.ttf'), 'NotoSansJP-Light');
    console.log('[OK] フォントが正常に読み込まれました');
} catch (error) {
    console.error('[ERROR] フォントの読み込みエラー:', error.message);
    console.error('[INFO] `fonts`ディレクトリにNoto Sans JPフォントファイルを配置してください');
}

// --- 最新のモダンテーマ ---
const themes = [
    {
        name: 'neon_cyber',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#0f0f23');
            gradient.addColorStop(0.5, '#1a1a3e');
            gradient.addColorStop(1, '#16213e');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
            
            // サイバーグロー効果
            ctx.fillStyle = 'rgba(0, 255, 255, 0.03)';
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#00ffff',
        isDark: true
    },
    {
        name: 'aurora_dream',
        background: (ctx, width, height) => {
            const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width);
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(0.4, '#764ba2');
            gradient.addColorStop(0.7, '#f093fb');
            gradient.addColorStop(1, '#4facfe');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#ffffff',
        isDark: true
    },
    {
        name: 'sunset_bliss',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#fa709a');
            gradient.addColorStop(0.5, '#fee140');
            gradient.addColorStop(1, '#ff6b6b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#ffffff',
        isDark: false
    },
    {
        name: 'ocean_depths',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#141e30');
            gradient.addColorStop(0.5, '#243b55');
            gradient.addColorStop(1, '#0f2027');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#4facfe',
        isDark: true
    },
    {
        name: 'emerald_forest',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#134e4a');
            gradient.addColorStop(0.5, '#065f46');
            gradient.addColorStop(1, '#022c22');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#10b981',
        isDark: true
    },
    {
        name: 'royal_purple',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#1e1b4b');
            gradient.addColorStop(0.5, '#4c1d95');
            gradient.addColorStop(1, '#581c87');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#a78bfa',
        isDark: true
    },
    {
        name: 'minimalist_light',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#fafafa');
            gradient.addColorStop(1, '#f1f5f9');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#6366f1',
        isDark: false
    },
    {
        name: 'cherry_blossom',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#fce7f3');
            gradient.addColorStop(0.5, '#fbcfe8');
            gradient.addColorStop(1, '#f9a8d4');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        },
        accentColor: '#ec4899',
        isDark: false
    }
];

// --- ヘルパー関数 ---

/**
 * テキストを指定幅で折り返す
 */
function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let currentLine = '';

    for (const char of text) {
        if (char === '\n') {
            lines.push(currentLine);
            currentLine = '';
            continue;
        }
        
        const testLine = currentLine + char;
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = char;
        } else {
            currentLine = testLine;
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
    }
    
    return lines;
}

/**
 * テキスト長に基づいてフォント設定を決定
 */
function getFontSettings(textLength) {
    if (textLength <= 30) {
        return { fontSize: 68, lineHeight: 88, maxLines: 3 };
    } else if (textLength <= 60) {
        return { fontSize: 54, lineHeight: 70, maxLines: 4 };
    } else if (textLength <= 120) {
        return { fontSize: 42, lineHeight: 56, maxLines: 5 };
    } else if (textLength <= 200) {
        return { fontSize: 36, lineHeight: 48, maxLines: 6 };
    } else {
        return { fontSize: 32, lineHeight: 44, maxLines: 7 };
    }
}

/**
 * テーマに応じたテキストカラーを取得
 */
function getTextColor(theme) {
    return theme.isDark ? '#ffffff' : '#1f2937';
}

/**
 * 署名エリアのカラー設定
 */
function getSignatureColors(theme) {
    if (theme.isDark) {
        return {
            lineColor: 'rgba(255, 255, 255, 0.2)',
            nameColor: '#ffffff',
            dateColor: '#9ca3af',
            subtleAccent: theme.accentColor
        };
    } else {
        return {
            lineColor: 'rgba(0, 0, 0, 0.15)',
            nameColor: '#1f2937',
            dateColor: '#6b7280',
            subtleAccent: theme.accentColor
        };
    }
}

/**
 * ランダムテーマ選択
 */
function getRandomTheme() {
    return themes[Math.floor(Math.random() * themes.length)];
}

/**
 * 角丸矩形を描画
 */
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

/**
 * グロー効果を追加
 */
function addGlowEffect(ctx, color, blur = 20) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
}

/**
 * メッセージIDを抽出
 */
function extractMessageId(input) {
    // URL形式: https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
    const urlMatch = input.match(/\/channels\/\d+\/\d+\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    
    // 数字のみ
    if (/^\d+$/.test(input)) return input;
    
    return null;
}

/**
 * サーバー内のメッセージを検索
 */
async function findMessage(guild, messageId) {
    const textChannels = guild.channels.cache.filter(channel => 
        channel.isTextBased() && !channel.isVoiceBased()
    );
    
    for (const [, channel] of textChannels) {
        try {
            const message = await channel.messages.fetch(messageId);
            if (message) return message;
        } catch (error) {
            // チャンネルで見つからない場合は次へ
            continue;
        }
    }
    
    return null;
}

// --- メインコマンド ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('メッセージを美しい名言画像に変換します')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('メッセージIDまたはURL')
                .setRequired(true))
        .addStringOption(option =>
            option
                .setName('theme')
                .setDescription('デザインテーマを選択')
                .setRequired(false)
                .addChoices(
                    { name: 'ネオンサイバー', value: 'neon_cyber' },
                    { name: 'オーロラドリーム', value: 'aurora_dream' },
                    { name: 'サンセットブリス', value: 'sunset_bliss' },
                    { name: 'オーシャンデプス', value: 'ocean_depths' },
                    { name: 'エメラルドフォレスト', value: 'emerald_forest' },
                    { name: 'ロイヤルパープル', value: 'royal_purple' },
                    { name: 'ミニマリストライト', value: 'minimalist_light' },
                    { name: 'チェリーブロッサム', value: 'cherry_blossom' },
                    { name: 'ランダム', value: 'random' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const input = interaction.options.getString('message');
            const themeChoice = interaction.options.getString('theme') || 'random';

            // メッセージID抽出
            const messageId = extractMessageId(input);
            if (!messageId) {
                return await interaction.editReply({
                    content: '[ERROR] 無効なメッセージIDまたはURLです。\n[INFO] メッセージを右クリック→「IDをコピー」または、メッセージリンクをコピーしてください。',
                    ephemeral: true
                });
            }

            // メッセージ検索
            const targetMessage = await findMessage(interaction.guild, messageId);
            
            if (!targetMessage) {
                return await interaction.editReply({
                    content: '[ERROR] メッセージが見つかりませんでした。\n[INFO] このサーバー内のメッセージか確認してください。',
                    ephemeral: true
                });
            }

            if (!targetMessage.content || targetMessage.content.trim() === '') {
                return await interaction.editReply({
                    content: '[ERROR] このメッセージには引用できるテキストがありません。',
                    ephemeral: true
                });
            }

            // テーマ選択
            const selectedTheme = themeChoice === 'random' 
                ? getRandomTheme() 
                : themes.find(t => t.name === themeChoice) || getRandomTheme();

            // ユーザー情報取得
            const author = targetMessage.author;
            const member = await interaction.guild.members.fetch(author.id).catch(() => null);
            const displayName = member?.displayName || author.username;

            // --- Canvas生成 ---
            const canvasWidth = 1200;
            const canvasHeight = 675;
            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            // 背景描画
            selectedTheme.background(ctx, canvasWidth, canvasHeight);

            // テキスト設定
            const textContent = targetMessage.content;
            const fontSettings = getFontSettings(textContent.length);
            const textColor = getTextColor(selectedTheme);
            const signatureColors = getSignatureColors(selectedTheme);

            // メインテキスト描画
            ctx.font = `${fontSettings.fontSize}px "NotoSansJP-Bold", sans-serif`;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // テキスト折り返し
            const maxTextWidth = canvasWidth - 220;
            const lines = wrapText(ctx, textContent, maxTextWidth);
            
            let displayLines = lines.slice(0, fontSettings.maxLines);
            if (lines.length > fontSettings.maxLines) {
                displayLines[fontSettings.maxLines - 1] = 
                    displayLines[fontSettings.maxLines - 1].slice(0, -3) + '...';
            }

            // テキストブロック配置計算
            const totalTextHeight = displayLines.length * fontSettings.lineHeight;
            const textStartY = (canvasHeight - totalTextHeight - 140) / 2;

            // 装飾的な背景カード
            const padding = 50;
            const cardX = (canvasWidth - maxTextWidth) / 2 - padding;
            const cardY = textStartY - padding;
            const cardWidth = maxTextWidth + padding * 2;
            const cardHeight = totalTextHeight + padding * 2;

            // カードシャドウ
            ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
            ctx.shadowBlur = 30;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 10;

            // カード背景
            ctx.fillStyle = selectedTheme.isDark 
                ? 'rgba(255, 255, 255, 0.05)' 
                : 'rgba(255, 255, 255, 0.7)';
            roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 25);
            ctx.fill();

            // シャドウリセット
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;

            // カードボーダー（アクセントカラー）
            ctx.strokeStyle = selectedTheme.accentColor;
            ctx.lineWidth = 3;
            roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 25);
            ctx.stroke();

            // テキスト描画
            ctx.fillStyle = textColor;
            for (let i = 0; i < displayLines.length; i++) {
                const y = textStartY + padding + fontSettings.fontSize / 2 + (i * fontSettings.lineHeight);
                ctx.fillText(displayLines[i], canvasWidth / 2, y);
            }

            // 装飾的引用符（大型・半透明）
            ctx.fillStyle = selectedTheme.isDark 
                ? 'rgba(255, 255, 255, 0.04)' 
                : 'rgba(0, 0, 0, 0.04)';
            ctx.font = '180px "NotoSansJP-Bold"';
            ctx.textAlign = 'left';
            ctx.fillText('「', 40, textStartY + 60);
            ctx.textAlign = 'right';
            ctx.fillText('」', canvasWidth - 40, cardY + cardHeight - 60);

            // --- 署名エリア ---
            const signatureY = canvasHeight - 110;

            // 署名ライン
            ctx.beginPath();
            ctx.moveTo(80, signatureY);
            ctx.lineTo(canvasWidth - 80, signatureY);
            ctx.strokeStyle = signatureColors.lineColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // アバター描画
            const avatarSize = 70;
            const avatarX = 100;
            const avatarY = signatureY + 15;

            try {
                const avatar = await loadImage(
                    author.displayAvatarURL({ extension: 'png', size: 256 })
                );
                
                // 円形クリップ
                ctx.save();
                ctx.beginPath();
                ctx.arc(
                    avatarX + avatarSize / 2, 
                    avatarY + avatarSize / 2, 
                    avatarSize / 2, 
                    0, 
                    Math.PI * 2
                );
                ctx.closePath();
                ctx.clip();
                
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();

                // アバターボーダー
                ctx.beginPath();
                ctx.arc(
                    avatarX + avatarSize / 2, 
                    avatarY + avatarSize / 2, 
                    avatarSize / 2 + 2, 
                    0, 
                    Math.PI * 2
                );
                ctx.strokeStyle = signatureColors.subtleAccent;
                ctx.lineWidth = 3;
                ctx.stroke();

            } catch (error) {
                console.error('アバター読み込みエラー:', error);
                
                // フォールバック: グラデーション円
                const gradient = ctx.createLinearGradient(
                    avatarX, avatarY, 
                    avatarX + avatarSize, avatarY + avatarSize
                );
                gradient.addColorStop(0, signatureColors.subtleAccent);
                gradient.addColorStop(1, selectedTheme.accentColor);
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(
                    avatarX + avatarSize / 2, 
                    avatarY + avatarSize / 2, 
                    avatarSize / 2, 
                    0, 
                    Math.PI * 2
                );
                ctx.fill();
                
                // イニシャル
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 32px "NotoSansJP-Bold"';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(
                    displayName[0].toUpperCase(), 
                    avatarX + avatarSize / 2, 
                    avatarY + avatarSize / 2
                );
            }

            // ユーザー名
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = signatureColors.nameColor;
            ctx.font = 'bold 30px "NotoSansJP-Bold"';
            ctx.fillText(`— ${displayName}`, avatarX + avatarSize + 20, signatureY + 42);

            // 日付
            ctx.fillStyle = signatureColors.dateColor;
            ctx.font = '22px "NotoSansJP"';
            const dateStr = new Date(targetMessage.createdTimestamp).toLocaleString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            ctx.fillText(dateStr, avatarX + avatarSize + 20, signatureY + 72);

            // 透かし
            ctx.fillStyle = selectedTheme.isDark 
                ? 'rgba(255, 255, 255, 0.15)' 
                : 'rgba(0, 0, 0, 0.15)';
            ctx.font = '18px "NotoSansJP-Light"';
            ctx.textAlign = 'right';
            ctx.fillText('Quote Generator', canvasWidth - 30, canvasHeight - 25);

            // --- PNG出力 ---
            const buffer = canvas.toBuffer('image/png');
            const attachment = new AttachmentBuilder(buffer, { name: 'quote.png' });

            // 送信
            await interaction.editReply({
                content: `**${displayName}** の名言を生成しました！\nテーマ: **${selectedTheme.name.replace(/_/g, ' ').toUpperCase()}**`,
                files: [attachment]
            });

        } catch (error) {
            console.error('Quote生成エラー:', error);
            
            const errorMessage = error.message || '不明なエラー';
            await interaction.editReply({
                content: `[ERROR] 画像生成中にエラーが発生しました。\n\`\`\`\n${errorMessage}\n\`\`\``,
                ephemeral: true
            }).catch(console.error);
        }
    }
};