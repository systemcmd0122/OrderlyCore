const { SlashCommandBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォントの登録 ---
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリにNoto Sans JPフォントファイルがあるか確認してください。");
}


// --- ヘルパー関数 ---

/**
 * Canvas上でテキストを折り返して描画する関数
 * @param {CanvasRenderingContext2D} ctx - Canvasの2Dコンテキスト
 * @param {string} text - 描画するテキスト
 * @param {number} x - 描画を開始するX座標
 * @param {number} y - 描画を開始するY座標
 * @param {number} maxWidth - テキストの最大幅
 * @param {number} lineHeight - 行の高さ
 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    let lines = [];
    let currentLine = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
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
    lines.push(currentLine);

    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + (i * lineHeight));
    }
    return lines.length; // 描画した行数を返す
}


// --- コマンド本体 ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('メッセージを引用して名言風の画像を生成します。')
        .addStringOption(option =>
            option.setName('message_id_or_url')
                .setDescription('引用したいメッセージのIDまたはURL')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply();

        const input = interaction.options.getString('message_id_or_url');

        // URLからIDを抽出、またはIDをそのまま利用
        let messageId;
        const urlMatch = input.match(/\/(\d+)$/);
        if (urlMatch) {
            messageId = urlMatch[1];
        } else if (/^\d+$/.test(input)) {
            messageId = input;
        } else {
            return interaction.editReply({ content: '❌ 無効なメッセージIDまたはURLです。' });
        }

        // --- メッセージの検索 ---
        let targetMessage = null;
        try {
            // 先に現在のチャンネルを試す
            try {
                targetMessage = await interaction.channel.messages.fetch(messageId);
            } catch {}

            // 見つからない場合は全チャンネルを検索
            if (!targetMessage) {
                const channels = interaction.guild.channels.cache.filter(c => c.isTextBased());
                for (const channel of channels.values()) {
                    try {
                        targetMessage = await channel.messages.fetch(messageId);
                        if (targetMessage) break;
                    } catch {}
                }
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
        
        const author = targetMessage.author;
        const member = await interaction.guild.members.fetch(author.id).catch(() => null);

        try {
            // --- Canvasで画像生成 ---
            const canvasWidth = 1200;
            const canvasHeight = 675; // 16:9比率
            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            // 背景
            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            
            // 引用符
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.font = '300px "NotoSansJP-Bold"';
            ctx.textAlign = 'left';
            ctx.fillText('「', 40, 280);
            ctx.textAlign = 'right';
            ctx.fillText('」', canvasWidth - 40, canvasHeight - 50);
            
            // メインテキスト
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.font = '50px "NotoSansJP-Bold"';
            wrapText(ctx, targetMessage.content, canvasWidth / 2, 150, canvasWidth - 200, 70);

            // 署名エリア
            const signatureY = canvasHeight - 100;
            ctx.beginPath();
            ctx.moveTo(40, signatureY - 20);
            ctx.lineTo(canvasWidth - 40, signatureY - 20);
            ctx.strokeStyle = '#4A4A4A';
            ctx.lineWidth = 2;
            ctx.stroke();

            // アバター
            ctx.save();
            ctx.beginPath();
            ctx.arc(100, signatureY, 40, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            try {
                const avatar = await loadImage(author.displayAvatarURL({ extension: 'png', size: 128 }));
                ctx.drawImage(avatar, 60, signatureY - 40, 80, 80);
            } catch {
                // アバター読み込み失敗時は何もしない
            }
            ctx.restore();

            // ユーザー名と日付
            ctx.textAlign = 'left';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '32px "NotoSansJP-Bold"';
            ctx.fillText(member ? member.displayName : author.username, 160, signatureY + 15);
            
            ctx.fillStyle = '#8b949e';
            ctx.font = '24px "NotoSansJP"';
            ctx.fillText(new Date(targetMessage.createdTimestamp).toLocaleString('ja-JP'), 160, signatureY + 50);

            // --- 画像を送信 ---
            const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'quote.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('名言カード生成エラー:', error);
            await interaction.editReply({ content: '❌ カードの生成中にエラーが発生しました。' });
        }
    }
};