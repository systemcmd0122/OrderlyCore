const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { doc, getDoc, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// --- フォントの登録 ---
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'ShareTechMono-Regular.ttf'), 'ShareTechMono');
    // 日本語表示用のフォントを登録
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf'), 'NotoSansJP');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.ttf'), 'NotoSansJP-Bold');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリに指定のフォントファイルがあるか確認してください。");
}

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// 角丸の四角形を描画するヘルパー関数
function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
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


module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank-card')
        .setDescription('カスタマイズ可能なランクカードを生成します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーのランクカードを表示します（省略時は自分）')),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        const db = interaction.client.db;
        const guildId = interaction.guild.id;

        try {
            // ユーザーデータ取得
            const userRef = doc(db, 'levels', `${guildId}_${targetUser.id}`);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                return interaction.editReply({ content: `**${targetUser.displayName}** にはまだランクデータがありません。` });
            }
            const userData = userSnap.data();
            const requiredXp = calculateRequiredXp(userData.level);

            // ランキング取得
            const usersRef = collection(db, 'levels');
            const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
            const snapshot = await getDocs(q);
            let rank = snapshot.docs.findIndex(doc => doc.data().userId === targetUser.id) + 1;
            if (rank === 0) rank = snapshot.size + 1;

            // --- Canvasで画像生成 ---
            const canvas = createCanvas(934, 282);
            const ctx = canvas.getContext('2d');

            // 背景
            ctx.fillStyle = '#2C2F33';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // ユーザー名 (日本語対応フォントに変更)
            ctx.font = 'bold 45px "NotoSansJP-Bold"';
            ctx.fillStyle = '#FFFFFF';
            const shortenedName = shortenText(ctx, member.displayName, 650);
            ctx.fillText(shortenedName, 270, 140);
            
            // ランク & レベル (日本語対応)
            ctx.font = 'bold 40px "NotoSansJP-Bold"';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(`ランク`, 270, 80);
            const rankLabelWidth = ctx.measureText('ランク').width;

            ctx.font = 'bold 40px "ShareTechMono"';
            ctx.fillText(`#${rank}`, 270 + rankLabelWidth + 10, 80);
            const rankWidth = ctx.measureText(`#${rank}`).width;
            
            const levelX = 270 + rankLabelWidth + 10 + rankWidth + 40;
            ctx.font = 'bold 40px "NotoSansJP-Bold"';
            ctx.fillStyle = '#00e5ff';
            ctx.fillText(`レベル`, levelX, 80);
            const levelLabelWidth = ctx.measureText('レベル').width;

            ctx.font = 'bold 40px "ShareTechMono"';
            ctx.fillText(`${userData.level}`, levelX + levelLabelWidth + 10, 80);

            // XP プログレスバー背景
            ctx.fillStyle = '#484B4E';
            roundRect(ctx, 270, 190, 620, 40, 20).fill();

            // XP プログレスバー
            const progress = Math.max(0.01, Math.min(userData.xp / requiredXp, 1));
            ctx.fillStyle = '#00e5ff';
            roundRect(ctx, 270, 190, 620 * progress, 40, 20).fill();

            // XP テキスト
            ctx.font = '30px "ShareTechMono"';
            ctx.fillStyle = '#FFFFFF';
            const xpText = `${userData.xp.toLocaleString()} / ${requiredXp.toLocaleString()} XP`;
            const xpTextMetrics = ctx.measureText(xpText);
            ctx.fillText(xpText, 890 - xpTextMetrics.width, 140);
            
            // アバター
            ctx.save();
            ctx.beginPath();
            ctx.arc(141, 141, 100, 0, Math.PI * 2, true);
            ctx.closePath();
            ctx.clip();
            
            try {
                const avatar = await loadImage(targetUser.displayAvatarURL({ extension: 'png', size: 256 }));
                ctx.drawImage(avatar, 41, 41, 200, 200);
            } catch (e) {
                const defaultAvatar = await loadImage('https://cdn.discordapp.com/embed/avatars/0.png');
                ctx.drawImage(defaultAvatar, 41, 41, 200, 200);
            }
            ctx.restore();

            const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'rank-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('ランクカード生成エラー:', error);
            await interaction.editReply({ content: '❌ ランクカードの生成中にエラーが発生しました。' });
        }
    }
};