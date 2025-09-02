const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getFirestore, collection, query, where, orderBy, getDocs, doc, getDoc, getCountFromServer } = require('firebase/firestore');
const { getDatabase, ref, get } = require('firebase/database');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォントの登録 ---
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'ShareTechMono-Regular.ttf'), 'ShareTechMono');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリに指定のフォントファイルがあるか確認してください。");
}


// --- ヘルパー関数 ---

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

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
    return result.trim() || '0秒';
}

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
            const [levelData, voiceData, warnCount, rank] = await Promise.all([
                getDoc(doc(db, 'levels', `${guild.id}_${targetUser.id}`)),
                getDoc(doc(db, 'voice_stats', `${guild.id}_${targetUser.id}`)),
                getCountFromServer(query(collection(db, 'warnings'), where('guildId', '==', guild.id), where('userId', '==', targetUser.id))),
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

            const { level = 0, xp = 0, messageCount = 0 } = levelData.data();
            const requiredXp = calculateRequiredXp(level);
            
            let totalStayTime = voiceData.exists() ? voiceData.data().totalStayTime : 0;
            const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${targetUser.id}`);
            const sessionSnapshot = await get(sessionRef);
            if (sessionSnapshot.exists()) {
                totalStayTime += (Date.now() - sessionSnapshot.val().joinedAt);
            }

            const canvas = createCanvas(1000, 400);
            const ctx = canvas.getContext('2d');

            const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, '#23272A');
            gradient.addColorStop(1, '#1c1f22');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.strokeStyle = member.displayHexColor === '#000000' ? '#00e5ff' : member.displayHexColor;
            ctx.lineWidth = 10;
            roundRect(ctx, 5, 5, canvas.width - 10, canvas.height - 10, 20).stroke();

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
            
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 50px "NotoSansJP-Bold"';
            const shortenedName = shortenText(ctx, member.displayName, 650);
            ctx.fillText(shortenedName, 300, 120);

            ctx.fillStyle = '#8b949e';
            ctx.font = '24px "NotoSansJP"';
            ctx.fillText(`参加日: ${member.joinedAt.toLocaleDateString('ja-JP')}`, 300, 160);

            // --- 統計情報 (日本語化) ---
            const stats = [
                { label: 'メッセージ', value: messageCount.toLocaleString() },
                { label: 'VC時間', value: formatDuration(totalStayTime) },
                { label: '警告', value: warnCount.data().count.toString() }
            ];
            let statX = 300;
            stats.forEach(stat => {
                ctx.font = 'bold 36px "ShareTechMono"';
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText(stat.value, statX, 230);
                const valueWidth = ctx.measureText(stat.value).width;
                
                ctx.font = '30px "NotoSansJP-Bold"';
                ctx.fillStyle = '#8b949e';
                ctx.fillText(stat.label, statX + valueWidth + 10, 230);
                statX += valueWidth + ctx.measureText(stat.label).width + 50;
            });
            
            // --- レベルとランク (日本語化) ---
            ctx.textAlign = 'right';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 40px "NotoSansJP-Bold"';
            ctx.fillText(`レベル`, 950 - 60, 80);
            const levelLabelWidth = ctx.measureText(`レベル`).width;
            ctx.font = 'bold 40px "ShareTechMono"';
            ctx.fillText(`${level}`, 950, 80);

            ctx.font = '30px "NotoSansJP-Bold"';
            ctx.fillStyle = '#8b949e';
            ctx.fillText(`ランク`, 950 - 60, 120);
            const rankLabelWidth = ctx.measureText(`ランク`).width;
            ctx.font = '30px "ShareTechMono"';
            ctx.fillText(`#${rank}`, 950, 120);
            ctx.textAlign = 'left';

            // --- XPプログレスバー ---
            const barX = 50;
            const barY = 320;
            const barWidth = canvas.width - 100;
            const barHeight = 40;
            
            ctx.fillStyle = '#484B4E';
            roundRect(ctx, barX, barY, barWidth, barHeight, 20).fill();

            const progress = Math.max(0.01, Math.min(xp / requiredXp, 1));
            ctx.fillStyle = member.displayHexColor === '#000000' ? '#00e5ff' : member.displayHexColor;
            roundRect(ctx, barX, barY, barWidth * progress, barHeight, 20).fill();

            ctx.font = '24px "ShareTechMono"';
            ctx.fillStyle = '#FFFFFF';
            const xpText = `${xp.toLocaleString()} / ${requiredXp.toLocaleString()} XP`;
            ctx.textAlign = 'center';
            ctx.fillText(xpText, canvas.width / 2, barY + 28);

            const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'profile-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('プロフィールカード生成エラー:', error);
            await interaction.editReply({ content: '❌ カードの生成中にエラーが発生しました。' });
        }
    }
};