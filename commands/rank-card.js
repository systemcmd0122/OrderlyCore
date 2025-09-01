const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// フォントの登録
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'ShareTechMono-Regular.ttf'), 'ShareTechMono');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。プロジェクトルートの`fonts`ディレクトリに`ShareTechMono-Regular.ttf`を配置してください。");
}

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// 角丸の四角形を描画するヘルパー関数
function roundRect(ctx, x, y, width, height, radius) {
    if (width < 2 * radius) radius = width / 2;
    if (height < 2 * radius) radius = height / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
    return ctx;
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
            ctx.fillStyle = '#2C2F33'; // ダークグレーの背景
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // ユーザー名
            ctx.font = '50px "ShareTechMono"';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(targetUser.displayName, 270, 140);
            
            // ランク & レベル
            const rankText = `RANK #${rank}`;
            const rankTextMetrics = ctx.measureText(rankText);
            ctx.font = 'bold 50px "ShareTechMono"';
            ctx.fillText(rankText, 270, 80);

            ctx.fillStyle = '#00e5ff'; // プライマリカラー
            ctx.fillText(`LEVEL ${userData.level}`, 280 + rankTextMetrics.width, 80);

            // XP プログレスバー背景
            ctx.fillStyle = '#484B4E'; // グレー
            roundRect(ctx, 270, 190, 620, 40, 20).fill();

            // XP プログレスバー
            const progress = Math.max(0.01, Math.min(userData.xp / requiredXp, 1));
            ctx.fillStyle = '#00e5ff'; // プライマリカラー
            roundRect(ctx, 270, 190, 620 * progress, 40, 20).fill();

            // XP テキスト
            ctx.font = '35px "ShareTechMono"';
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
                // アバターの読み込みに失敗した場合、デフォルト画像を描画
                const defaultAvatar = await loadImage('https://cdn.discordapp.com/embed/avatars/0.png');
                ctx.drawImage(defaultAvatar, 41, 41, 200, 200);
            }
            ctx.restore();

            const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'rank-card.png' });
            await interaction.editReply({ files: [attachment] });

        } catch (error) {
            console.error('ランクカード生成エラー:', error);
            await interaction.editReply({ content: '❌ ランクカードの生成中にエラーが発生しました。フォントが正しく配置されているか確認してください。' });
        }
    }
};