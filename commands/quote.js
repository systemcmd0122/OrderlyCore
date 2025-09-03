const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォントの登録 ---
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Light.ttf'), 'NotoSansJP-Light');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリにNoto Sans JPフォントファイルがあるか確認してください。");
}

// --- 背景テーマ設定 ---
const themes = [
    {
        name: 'gradient_blue',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#667eea');
            gradient.addColorStop(1, '#764ba2');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
    },
    {
        name: 'gradient_sunset',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#ff9a9e');
            gradient.addColorStop(0.5, '#fecfef');
            gradient.addColorStop(1, '#fecfef');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
    },
    {
        name: 'gradient_ocean',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#2193b0');
            gradient.addColorStop(1, '#6dd5ed');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
    },
    {
        name: 'dark_modern',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#1a1a1a');
            gradient.addColorStop(1, '#2d2d2d');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
    },
    {
        name: 'light_minimal',
        background: (ctx, width, height) => {
            const gradient = ctx.createLinearGradient(0, 0, width, height);
            gradient.addColorStop(0, '#f8f9fa');
            gradient.addColorStop(1, '#e9ecef');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);
        }
    }
];

// --- ヘルパー関数 ---

/**
 * テキストを折り返した後の行配列を返す関数
 * @param {CanvasRenderingContext2D} ctx - Canvasの2Dコンテキスト
 * @param {string} text - 処理するテキスト
 * @param {number} maxWidth - テキストの最大幅
 * @returns {string[]} - 折り返されたテキストの行配列
 */
function getWrappedLines(ctx, text, maxWidth) {
    let lines = [];
    let currentLine = '';

    for (const char of text) {
        if (char === '\n') {
            lines.push(currentLine);
            currentLine = '';
            continue;
        }
        const testLine = currentLine + char;
        if (ctx.measureText(testLine).width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = char;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);
    return lines;
}

/**
 * テキストの長さに基づいて適切なフォントサイズを決定
 * @param {number} textLength - テキストの長さ
 * @returns {object} - フォントサイズと行間の設定
 */
function getFontSettings(textLength) {
    if (textLength <= 20) {
        return { fontSize: 72, lineHeight: 90, maxLines: 3 };
    } else if (textLength <= 50) {
        return { fontSize: 56, lineHeight: 70, maxLines: 4 };
    } else if (textLength <= 100) {
        return { fontSize: 44, lineHeight: 56, maxLines: 5 };
    } else {
        return { fontSize: 36, lineHeight: 48, maxLines: 6 };
    }
}

/**
 * テキストの色を背景に応じて自動調整
 * @param {string} themeName - テーマ名
 * @returns {string} - テキストカラー
 */
function getTextColor(themeName) {
    const darkThemes = ['dark_modern', 'gradient_blue', 'gradient_ocean'];
    return darkThemes.includes(themeName) ? '#ffffff' : '#2c3e50';
}

/**
 * 署名エリアの色を背景に応じて自動調整
 * @param {string} themeName - テーマ名
 * @returns {object} - 署名エリアの色設定
 */
function getSignatureColors(themeName) {
    const darkThemes = ['dark_modern', 'gradient_blue', 'gradient_ocean'];
    if (darkThemes.includes(themeName)) {
        return {
            lineColor: 'rgba(255, 255, 255, 0.3)',
            nameColor: '#ffffff',
            dateColor: '#b0b0b0'
        };
    } else {
        return {
            lineColor: 'rgba(0, 0, 0, 0.2)',
            nameColor: '#2c3e50',
            dateColor: '#7f8c8d'
        };
    }
}

/**
 * ランダムにテーマを選択
 * @returns {object} - 選択されたテーマ
 */
function getRandomTheme() {
    return themes[Math.floor(Math.random() * themes.length)];
}

/**
 * 角丸の四角形を描画
 * @param {CanvasRenderingContext2D} ctx - Canvasの2Dコンテキスト
 * @param {number} x - X座標
 * @param {number} y - Y座標
 * @param {number} width - 幅
 * @param {number} height - 高さ
 * @param {number} radius - 角の半径
 */
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// --- コマンド本体 ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('メッセージを引用してモダンな名言画像を生成します。')
        .addStringOption(option =>
            option.setName('message_id_or_url')
                .setDescription('引用したいメッセージのIDまたはURL')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('theme')
                .setDescription('画像のテーマを選択')
                .setRequired(false)
                .addChoices(
                    { name: 'グラデーション（ブルー）', value: 'gradient_blue' },
                    { name: 'グラデーション（サンセット）', value: 'gradient_sunset' },
                    { name: 'グラデーション（オーシャン）', value: 'gradient_ocean' },
                    { name: 'ダークモダン', value: 'dark_modern' },
                    { name: 'ライトミニマル', value: 'light_minimal' },
                    { name: 'ランダム', value: 'random' }
                )),

    async execute(interaction) {
        await interaction.deferReply();

        const input = interaction.options.getString('message_id_or_url');
        const themeOption = interaction.options.getString('theme') || 'random';

        // メッセージIDの抽出
        let messageId;
        const urlMatch = input.match(/\/(\d+)$/);
        if (urlMatch) {
            messageId = urlMatch[1];
        } else if (/^\d+$/.test(input)) {
            messageId = input;
        } else {
            return interaction.editReply({ content: '❌ 無効なメッセージIDまたはURLです。' });
        }

        // メッセージの検索
        let targetMessage = null;
        try {
            const channels = interaction.guild.channels.cache.filter(c => c.isTextBased());
            for (const channel of channels.values()) {
                try {
                    targetMessage = await channel.messages.fetch(messageId);
                    if (targetMessage) break;
                } catch {}
            }
        } catch (error) {
            console.error('メッセージ検索中にエラー:', error);
            return interaction.editReply({ content: '❌ メッセージの検索中にエラーが発生しました。' });
        }

        if (!targetMessage) {
            return interaction.editReply({ content: '❌ サーバー内で指定されたメッセージを見つけることができませんでした。' });
        }
        
        if (!targetMessage.content) {
            return interaction.editReply({ content: '❌ このメッセージには引用できるテキストがありません。' });
        }

        // テーマの選択
        let selectedTheme;
        if (themeOption === 'random') {
            selectedTheme = getRandomTheme();
        } else {
            selectedTheme = themes.find(t => t.name === themeOption) || getRandomTheme();
        }

        const author = targetMessage.author;
        const member = await interaction.guild.members.fetch(author.id).catch(() => null);

        try {
            // --- Canvas設定 ---
            const canvasWidth = 1200;
            const canvasHeight = 675;
            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            // --- 背景の描画 ---
            selectedTheme.background(ctx, canvasWidth, canvasHeight);

            // --- テキスト設定 ---
            const textContent = targetMessage.content;
            const fontSettings = getFontSettings(textContent.length);
            const textColor = getTextColor(selectedTheme.name);
            const signatureColors = getSignatureColors(selectedTheme.name);

            // --- メインテキストの描画 ---
            ctx.font = `${fontSettings.fontSize}px "NotoSansJP-Bold"`;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // テキストの折り返し
            const maxTextWidth = canvasWidth - 200;
            const lines = getWrappedLines(ctx, textContent, maxTextWidth);
            
            // 最大行数を超える場合は省略
            let displayLines = lines;
            if (lines.length > fontSettings.maxLines) {
                displayLines = lines.slice(0, fontSettings.maxLines - 1);
                displayLines.push(lines[fontSettings.maxLines - 1] + '...');
            }

            // テキストブロック全体の高さを計算
            const totalTextHeight = displayLines.length * fontSettings.lineHeight;
            const textStartY = (canvasHeight - totalTextHeight - 150) / 2 + fontSettings.fontSize / 2;

            // テキストの背景（半透明のオーバーレイ）
            const padding = 40;
            const bgX = (canvasWidth - maxTextWidth) / 2 - padding;
            const bgY = textStartY - fontSettings.fontSize / 2 - padding;
            const bgWidth = maxTextWidth + padding * 2;
            const bgHeight = totalTextHeight + padding * 2;

            ctx.fillStyle = selectedTheme.name.includes('light') ? 
                'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
            roundRect(ctx, bgX, bgY, bgWidth, bgHeight, 20);
            ctx.fill();

            // テキストの描画
            ctx.fillStyle = textColor;
            for (let i = 0; i < displayLines.length; i++) {
                const y = textStartY + (i * fontSettings.lineHeight);
                ctx.fillText(displayLines[i], canvasWidth / 2, y);
            }

            // --- 装飾的な引用符 ---
            ctx.fillStyle = selectedTheme.name.includes('light') ? 
                'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)';
            ctx.font = '200px "NotoSansJP-Bold"';
            ctx.textAlign = 'left';
            ctx.fillText('「', 20, textStartY);
            ctx.textAlign = 'right';
            ctx.fillText('」', canvasWidth - 20, textStartY + totalTextHeight - fontSettings.lineHeight);

            // --- 署名エリア ---
            const signatureY = canvasHeight - 120;

            // 署名エリアの線
            ctx.beginPath();
            ctx.moveTo(60, signatureY);
            ctx.lineTo(canvasWidth - 60, signatureY);
            ctx.strokeStyle = signatureColors.lineColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // アバターの描画（円形クリップ）
            const avatarSize = 60;
            const avatarX = 80;
            const avatarY = signatureY + 20;

            ctx.save();
            ctx.beginPath();
            ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();

            try {
                const avatar = await loadImage(author.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
            } catch (error) {
                // アバターの読み込みに失敗した場合のデフォルト描画
                ctx.fillStyle = signatureColors.nameColor;
                ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
                ctx.fillStyle = selectedTheme.name.includes('light') ? '#ffffff' : '#000000';
                ctx.font = '24px "NotoSansJP-Bold"';
                ctx.textAlign = 'center';
                ctx.fillText('?', avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 8);
            }
            ctx.restore();

            // ユーザー名
            ctx.textAlign = 'left';
            ctx.fillStyle = signatureColors.nameColor;
            ctx.font = 'bold 28px "NotoSansJP-Bold"';
            const displayName = member ? member.displayName : author.username;
            ctx.fillText(`- ${displayName}`, avatarX + avatarSize + 20, signatureY + 35);

            // 日付
            ctx.fillStyle = signatureColors.dateColor;
            ctx.font = '20px "NotoSansJP"';
            const dateStr = new Date(targetMessage.createdTimestamp).toLocaleString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            ctx.fillText(dateStr, avatarX + avatarSize + 20, signatureY + 65);

            // 透かし
            ctx.fillStyle = selectedTheme.name.includes('light') ? 
                'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
            ctx.font = '16px "NotoSansJP"';
            ctx.textAlign = 'right';
            ctx.fillText('Make it a Quote', canvasWidth - 20, canvasHeight - 20);

            // --- 画像を送信 ---
            const buffer = await canvas.encode('png');
            const attachment = new AttachmentBuilder(buffer, { name: 'quote.png' });
            
            await interaction.editReply({ 
                content: `📸 **${displayName}** の名言を生成しました！\n🎨 テーマ: ${selectedTheme.name.replace(/_/g, ' ')}`,
                files: [attachment] 
            });

        } catch (error) {
            console.error('名言カード生成エラー:', error);
            await interaction.editReply({ content: '❌ カードの生成中にエラーが発生しました。詳細: ' + error.message });
        }
    }
};