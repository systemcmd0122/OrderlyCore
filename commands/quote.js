const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
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

        let messageId;
        const urlMatch = input.match(/\/(\d+)$/);
        if (urlMatch) {
            messageId = urlMatch[1];
        } else if (/^\d+$/.test(input)) {
            messageId = input;
        } else {
            return interaction.editReply({ content: '❌ 無効なメッセージIDまたはURLです。' });
        }

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
        
        const author = targetMessage.author;
        const member = await interaction.guild.members.fetch(author.id).catch(() => null);

        try {
            // --- Canvasで画像生成 ---
            const canvasWidth = 1200;
            const canvasHeight = 675;
            const canvas = createCanvas(canvasWidth, canvasHeight);
            const ctx = canvas.getContext('2d');

            // 背景
            ctx.fillStyle = '#23272A';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            
            // --- テキストの長さに応じてフォントサイズと行の高さを動的に変更 ---
            const textContent = targetMessage.content;
            let fontSize, lineHeight;
            if (textContent.length <= 10) {
                fontSize = 120;
                lineHeight = 140;
            } else if (textContent.length <= 50) {
                fontSize = 80;
                lineHeight = 100;
            } else {
                fontSize = 60;
                lineHeight = 80;
            }
            
            ctx.font = `bold ${fontSize}px "NotoSansJP-Bold"`;
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';

            const lines = getWrappedLines(ctx, textContent, canvasWidth - 200);
            const totalTextHeight = lines.length * lineHeight;
            
            // テキストブロックを垂直方向に中央揃えするための開始Y座標を計算
            const mainAreaHeight = canvasHeight - 250; // 上下の余白を考慮
            let startY = 100 + (mainAreaHeight - totalTextHeight) / 2;
            
            // テキストを描画
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], canvasWidth / 2, startY + (i * lineHeight));
            }

            // 引用符
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.font = '300px "NotoSansJP-Bold"';
            ctx.textAlign = 'left';
            ctx.fillText('「', 40, startY + (fontSize * 0.5));
            ctx.textAlign = 'right';
            ctx.fillText('」', canvasWidth - 40, startY + totalTextHeight);
            
            // 署名エリアの線
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
            ctx.arc(100, signatureY + 20, 40, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            try {
                const avatar = await loadImage(author.displayAvatarURL({ extension: 'png', size: 128 }));
                ctx.drawImage(avatar, 60, signatureY - 20, 80, 80);
            } catch {}
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