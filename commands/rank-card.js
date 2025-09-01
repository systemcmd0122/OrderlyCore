// systemcmd0122/orderlycore/OrderlyCore-0952a29494b13fadb3d53fc470ecdb1ede3f7840/commands/rank-card.js
const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { doc, getDoc, setDoc, collection, query, where, orderBy, getDocs } = require('firebase/firestore');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// フォントを登録 (プロジェクトのルートにフォントファイルを配置想定)
try {
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Bold.otf'), 'NotoSansJP-Bold');
    GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.otf'), 'NotoSansJP-Regular');
} catch (e) {
    console.error("フォントの読み込みに失敗しました。`fonts`ディレクトリにフォントファイルがあるか確認してください。");
}


const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// ユーザーのランクカード設定を取得
async function getCardSettings(db, userId) {
    const settingsRef = doc(db, 'rank_card_settings', userId);
    const docSnap = await getDoc(settingsRef);
    if (docSnap.exists()) {
        return docSnap.data();
    }
    return {
        background: 'https://i.imgur.com/IFi8h2s.png', // デフォルト背景
        primaryColor: '#00e5ff',
        secondaryColor: '#ffffff'
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank-card')
        .setDescription('カスタマイズ可能なランクカードを生成・設定します。')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('あなたのランクカードを表示します。')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('他のユーザーのランクカードを表示します')
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-background')
                .setDescription('ランクカードの背景画像URLを設定します。')
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('画像のURL (推奨サイズ: 934x282px)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-color')
                .setDescription('ランクカードのメインカラーを設定します。')
                .addStringOption(option =>
                    option.setName('hex_color')
                        .setDescription('16進数カラーコード (例: #FF0000)')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        const db = interaction.client.db;

        if (subcommand === 'view') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            const guildId = interaction.guild.id;

            try {
                // ユーザーデータ取得
                const userRef = doc(db, 'levels', `${guildId}_${targetUser.id}`);
                const userSnap = await getDoc(userRef);

                if (!userSnap.exists()) {
                    return interaction.editReply({ content: `${targetUser.displayName} にはまだランクデータがありません。` });
                }
                const userData = userSnap.data();
                const requiredXp = calculateRequiredXp(userData.level);

                // ランキング取得
                const usersRef = collection(db, 'levels');
                const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
                const snapshot = await getDocs(q);
                let rank = snapshot.docs.findIndex(doc => doc.data().userId === targetUser.id) + 1;
                if (rank === 0) rank = snapshot.size + 1;

                // カード設定取得
                const cardSettings = await getCardSettings(db, targetUser.id);
                
                // --- Canvasで画像生成 ---
                const canvas = createCanvas(934, 282);
                const ctx = canvas.getContext('2d');

                // 背景
                try {
                    const background = await loadImage(cardSettings.background);
                    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
                } catch (e) {
                     // 背景画像の読み込みに失敗した場合、単色で塗りつぶす
                    ctx.fillStyle = '#23272A';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    console.warn(`背景画像の読み込みに失敗: ${cardSettings.background}`);
                }


                // 半透明の背景
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.fillRect(20, 20, canvas.width - 40, canvas.height - 40);

                // アバター
                const avatar = await loadImage(targetUser.displayAvatarURL({ format: 'png', size: 256 }));
                ctx.save();
                ctx.beginPath();
                ctx.arc(150, 141, 100, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(avatar, 50, 41, 200, 200);
                ctx.restore();
                
                // プログレスバー背景
                ctx.fillStyle = '#484b4e';
                ctx.beginPath();
                ctx.roundRect(280, 180, 600, 40, 20);
                ctx.closePath();
                ctx.fill();
                
                // プログレスバー
                const progress = Math.max(0.01, Math.min(userData.xp / requiredXp, 1));
                ctx.fillStyle = cardSettings.primaryColor;
                ctx.beginPath();
                ctx.roundRect(280, 180, 600 * progress, 40, 20);
                ctx.closePath();
                ctx.fill();

                // テキスト
                ctx.fillStyle = cardSettings.secondaryColor;
                ctx.font = '35px "NotoSansJP-Regular"';
                const xpText = `${userData.xp.toLocaleString()} / ${requiredXp.toLocaleString()} XP`;
                const xpTextWidth = ctx.measureText(xpText).width;
                ctx.fillText(xpText, 880 - xpTextWidth, 150);

                ctx.font = 'bold 50px "NotoSansJP-Bold"';
                ctx.fillText(targetUser.displayName, 280, 150);
                
                ctx.fillStyle = cardSettings.primaryColor;
                ctx.font = 'bold 50px "NotoSansJP-Bold"';
                ctx.textAlign = 'right';
                ctx.fillText(`LEVEL ${userData.level}`, 880, 80);
                
                ctx.fillStyle = cardSettings.secondaryColor;
                ctx.font = 'bold 50px "NotoSansJP-Bold"';
                const rankText = `#${rank}`;
                const rankTextWidth = ctx.measureText(rankText).width;
                ctx.fillText(rankText, 880 - (ctx.measureText(`LEVEL ${userData.level}`).width + 20), 80);
                ctx.fillText('RANK', 880 - (ctx.measureText(`LEVEL ${userData.level}`).width + 20) - rankTextWidth - 15, 80);


                const attachment = new AttachmentBuilder(await canvas.encode('png'), { name: 'rank-card.png' });
                await interaction.editReply({ files: [attachment] });

            } catch (error) {
                console.error('ランクカード生成エラー:', error);
                await interaction.editReply({ content: '❌ ランクカードの生成中にエラーが発生しました。' });
            }

        } else if (subcommand === 'set-background') {
            const url = interaction.options.getString('url');
            try {
                // URLの有効性を簡易的にチェック
                await loadImage(url);
                const settingsRef = doc(db, 'rank_card_settings', interaction.user.id);
                await setDoc(settingsRef, { background: url }, { merge: true });
                await interaction.editReply({ content: '✅ 背景画像を設定しました！ `/rank-card view` で確認してください。' });
            } catch (e) {
                await interaction.editReply({ content: '❌ 無効な画像URLです。URLが正しいか、画像が直接表示されるか確認してください。' });
            }

        } else if (subcommand === 'set-color') {
            const color = interaction.options.getString('hex_color');
            if (!/^#[0-9A-F]{6}$/i.test(color)) {
                return interaction.editReply({ content: '❌ 無効なカラーコードです。`#RRGGBB`の形式で入力してください。' });
            }
            const settingsRef = doc(db, 'rank_card_settings', interaction.user.id);
            await setDoc(settingsRef, { primaryColor: color }, { merge: true });
            await interaction.editReply({ content: `✅ メインカラーを **${color}** に設定しました！` });
        }
    }
};