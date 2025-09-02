const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getFirestore, collection, query, where, orderBy, getDocs, doc, getDoc, getCountFromServer } = require('firebase/firestore');
const { getDatabase, ref, get } = require('firebase/database');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォントの登録 ---
try {
    // 既存のShareTechMonoフォント
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'ShareTechMono-Regular.ttf'), 'ShareTechMono');
    
    // Noto Sans JPフォントの拡張子を.ttfに変更
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリに`ShareTechMono-Regular.ttf`とNoto Sans JPの`.ttf`フォントファイルがあるか確認してください。");
}


// --- ヘルパー関数 ---

// レベルアップに必要なXPを計算
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// 時間を分かりやすい形式に変換
function formatDuration(milliseconds) {
    if (milliseconds < 60000) {
        return `${Math.floor(milliseconds / 1000)}秒`;
    }
    const totalMinutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    let result = '';
    if (hours > 0) result += `${hours}時間 `;
    if (minutes > 0) result += `${minutes}分`;
    return result.trim();
}

// 角丸の四角形を描画
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
    return ctx;
}

// テキストの長さを調整して省略記号を付与
function shortenText(ctx, text, maxWidth) {
    let newText = text;
    while (ctx.measureText(newText).width > maxWidth && newText.length > 0) {
        newText = newText.slice(0, -1);
    }
    return newText + (newText.length < text.length ? '...' : '');
}


// --- コマンド本体 ---

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile-card')
        .setDescription('サーバー内活動をまとめたプロフィールカードを生成します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーのカードを表示します（省略時は自分）')),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (!member) {
            return interaction.editReply({ content: '対象のユーザーはこのサーバーにいません。' });
        }

        const { client, guild } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;

        try {
            // --- データの並行取得 ---
            const [
                levelData,
                voiceData,
                warnCount,
                rank
            ] = await Promise.all([
                // 1. レベルデータ
                getDoc(doc(db, 'levels', `${guild.id}_${targetUser.id}`)),
                // 2. VC滞在時間データ
                getDoc(doc(db, 'voice_stats', `${guild.id}_${targetUser.id}`)),
                // 3. 警告回数
                getCountFromServer(query(collection(db, 'warnings'), where('guildId', '==', guild.id), where('userId', '==', targetUser.id))),
                // 4. ランキング
                (async () => {
                    const q = query(collection(db, 'levels'), where('guildId', '==', guild.id), orderBy('level', 'desc'), orderBy('xp', 'desc'));
                    const snapshot = await getDocs(q);
                    const rankIndex = snapshot.docs.findIndex(d => d.data().userId === targetUser.id);
                    return rankIndex === -1 ? snapshot.size + 1 : rankIndex + 1;
                })()
            ]);

            if (!levelData.exists()) {
                return interaction.editReply({ content: `**${targetUser.displayName}** にはまだ活動データがありません。` });
            }

            // --- データの整理 ---
            const { level = 0, xp = 0, messageCount = 0 } = levelData.data();
            const requiredXp = calculateRequiredXp(level);
            
            let totalStayTime = voiceData.exists() ? voiceData.data().totalStayTime : 0;
            const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${targetUser.id}`);
            const sessionSnapshot = await get(sessionRef);
            if (sessionSnapshot.exists()) {
                totalStayTime += (Date.now() - sessionSnapshot.val().joinedAt);
            }

            // --- Canvasで画像生成 ---
            const canvas = createCanvas(1000, 400);
            const ctx = canvas.getContext('2d');

            // 背景グラデーション
            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, '#23272A');
            gradient.addColorStop(1, '#1c1f22');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // ボーダー
            ctx.strokeStyle = member.displayHexColor === '#000000' ? '#00e5ff' : member.displayHexColor;
            ctx.lineWidth = 10;
            roundRect(ctx, 5, 5, canvas.width - 10, canvas.height - 10, 20).stroke();

            // アバター
            ctx.save();
            ctx.beginPath();
            ctx.arc(150, 150, 100, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            try {
                const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.drawImage(avatar, 50, 50, 200, 200);
            } catch {
                const defaultAvatar = await loadImage('https://cdn.discordapp.com/embed/avatars/0.png');
                ctx.drawImage(defaultAvatar, 50, 50, 200, 200);
            }
            ctx.restore();
            
            // ユーザー名
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 50px "NotoSansJP-Bold"';
            const shortenedName = shortenText(ctx, member.displayName, 650);
            ctx.fillText(shortenedName, 300, 120);

            // 参加日
            ctx.fillStyle = '#8b949e';
            ctx.font = '24px "NotoSansJP"';
            ctx.fillText(`Joined: ${member.joinedAt.toLocaleDateString('ja-JP')}`, 300, 160);

            // --- 統計情報 ---
            const stats = [
                { label: 'Messages', value: messageCount.toLocaleString() },
                { label: 'VC Time', value: formatDuration(totalStayTime) },
                { label: 'Warnings', value: warnCount.data().count.toString() }
            ];
            ctx.font = '36px "ShareTechMono"';
            let statX = 300;
            stats.forEach(stat => {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(stat.value, statX, 230);
                const valueWidth = ctx.measureText(stat.value).width;
                ctx.fillStyle = '#8b949e';
                ctx.fillText(stat.label, statX + valueWidth + 10, 230);
                statX += valueWidth + ctx.measureText(stat.label).width + 50;
            });
            
            // --- レベルとランク ---
            ctx.textAlign = 'right';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 40px "ShareTechMono"';
            ctx.fillText(`LEVEL ${level}`, 950, 80);

            ctx.fillStyle = '#8b949e';
            ctx.font = '30px "ShareTechMono"';
            ctx.fillText(`RANK #${rank}`, 950, 120);
            ctx.textAlign = 'left';

            // --- XPプログレスバー ---
            const barX = 50;
            const barY = 320;
            const barWidth = canvas.width - 100;
            const barHeight = 40;
            
            // 背景
            ctx.fillStyle = '#484B4E';
            roundRect(ctx, barX, barY, barWidth, barHeight, 20).fill();

            // プログレス
            const progress = Math.max(0.01, Math.min(xp / requiredXp, 1));
            ctx.fillStyle = member.displayHexColor === '#000000' ? '#00e5ff' : member.displayHexColor;
            roundRect(ctx, barX, barY, barWidth * progress, barHeight, 20).fill();

            // XPテキスト
            ctx.font = '24px "ShareTechMono"';
            ctx.fillStyle = '#FFFFFF';
            const xpText = `${xp.toLocaleString()} / ${requiredXp.toLocaleString()} XP`;
            ctx.textAlign = 'center';
            ctx.fillText(xpText, canvas.width / 2, barY + 28);


            // --- 画像を送信 ---
            const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'profile-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('プロフィールカード生成エラー:', error);
            await interaction.editReply({ content: '❌ カードの生成中にエラーが発生しました。' });
        }
    }
};