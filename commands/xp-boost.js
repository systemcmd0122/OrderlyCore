const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { doc, getDoc, updateDoc } = require('firebase/firestore');
const chalk = require('chalk');

// ユーザーデータを取得または新規作成する関数
async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        return {
            xp: data.xp || 0,
            boost: data.boost || { active: false, expiresAt: null, multiplier: 1 },
            ...data
        };
    }
    return {
        guildId,
        userId,
        xp: 0,
        level: 0,
        messageCount: 0,
        lastMessageTimestamp: 0,
        boost: { active: false, expiresAt: null, multiplier: 1 }
    };
}

// ★★★★★【ここから修正】★★★★★
// 価格設定を調整
const BOOST_OPTIONS = {
    '1_2': { name: '1日間 (2x XP)', duration: 1, multiplier: 2, cost: 1000 },
    '7_2': { name: '7日間 (2x XP)', duration: 7, multiplier: 2, cost: 6000 },
    '1_5': { name: '1日間 (5x XP)', duration: 1, multiplier: 5, cost: 4000 },
    '7_5': { name: '7日間 (5x XP)', duration: 7, multiplier: 5, cost: 25000 },
    '1_10': { name: '1日間 (10x XP)', duration: 1, multiplier: 10, cost: 10000 },
    '7_10': { name: '7日間 (10x XP)', duration: 7, multiplier: 10, cost: 60000 },
};
// ★★★★★【ここまで修正】★★★★★


module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp-boost')
        .setDescription('XPを消費して、一定期間XPブーストを購入します。')
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop')
                .setDescription('XPブーストストアを表示します。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('buy')
                .setDescription('XPブーストを購入します。')
                .addStringOption(option =>
                    option.setName('item')
                        .setDescription('購入するブーストアイテム')
                        .setRequired(true)
                        .addChoices(
                            ...Object.entries(BOOST_OPTIONS).map(([key, value]) => ({
                                name: `${value.name} - ${value.cost.toLocaleString()} XP`,
                                value: key
                            }))
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('現在のブースト状況を確認します。')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const { guild, user, client } = interaction;
        const db = client.db;

        const settingsRef = doc(db, 'guild_settings', guild.id);
        const settingsSnap = await getDoc(settingsRef);
        const settings = settingsSnap.exists() ? settingsSnap.data().xpBoost || {} : {};

        if (!settings.enabled) {
            return interaction.editReply({ content: '❌ このサーバーではXPブースト機能が無効になっています。' });
        }
        if (!settings.roleId) {
            return interaction.editReply({ content: '❌ XPブースト用のロールが設定されていません。サーバー管理者に連絡してください。' });
        }
        
        const boostRole = await guild.roles.fetch(settings.roleId);
        if (!boostRole) {
            return interaction.editReply({ content: '❌ XPブースト用のロールが見つかりませんでした。サーバー管理者に連絡してください。' });
        }

        const userData = await getLevelData(db, guild.id, user.id);

        if (subcommand === 'shop') {
            const shopEmbed = new EmbedBuilder()
                .setTitle('🚀 XPブーストストア')
                .setDescription('XPを消費して、期間限定でXP獲得量を増加させるブーストを購入できます。')
                .setColor(0x5865F2)
                .addFields(
                    { name: '🔥 ブーストアイテム一覧 🔥', value: '----------------------------------------' },
                    { name: 'ブースト (1日間 | 2倍)', value: `**${BOOST_OPTIONS['1_2'].cost.toLocaleString()}** XP`, inline: true },
                    { name: 'ブースト (7日間 | 2倍)', value: `**${BOOST_OPTIONS['7_2'].cost.toLocaleString()}** XP`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: 'ブースト (1日間 | 5倍)', value: `**${BOOST_OPTIONS['1_5'].cost.toLocaleString()}** XP`, inline: true },
                    { name: 'ブースト (7日間 | 5倍)', value: `**${BOOST_OPTIONS['7_5'].cost.toLocaleString()}** XP`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: 'ブースト (1日間 | 10倍)', value: `**${BOOST_OPTIONS['1_10'].cost.toLocaleString()}** XP`, inline: true },
                    { name: 'ブースト (7日間 | 10倍)', value: `**${BOOST_OPTIONS['7_10'].cost.toLocaleString()}** XP`, inline: true },
                    { name: '\u200B', value: '\u200B', inline: true },
                    { name: '💰 あなたの所持XP', value: `**${Math.floor(userData.xp).toLocaleString()}** XP` }
                )
                .setFooter({ text: '`/xp-boost buy` で購入できます。' });
            await interaction.editReply({ embeds: [shopEmbed] });

        } else if (subcommand === 'buy') {
            const itemKey = interaction.options.getString('item');
            const selectedBoost = BOOST_OPTIONS[itemKey];

            if (!selectedBoost) {
                 return interaction.editReply({ content: '❌ 無効なアイテムが選択されました。' });
            }

            const cost = selectedBoost.cost;

            if (userData.boost && userData.boost.active && userData.boost.expiresAt > Date.now()) {
                return interaction.editReply({ content: '❌ 既に有効なブーストがあります。期間が終了してから再度購入してください。' });
            }
            if (userData.xp < cost) {
                return interaction.editReply({ content: `❌ XPが不足しています。このブーストには **${cost.toLocaleString()}** XPが必要です。` });
            }

            const newXp = userData.xp - cost;
            const expiresAt = Date.now() + (selectedBoost.duration * 24 * 60 * 60 * 1000);

            try {
                const userRef = doc(db, 'levels', `${guild.id}_${user.id}`);
                await updateDoc(userRef, {
                    xp: newXp,
                    boost: {
                        active: true,
                        expiresAt: expiresAt,
                        multiplier: selectedBoost.multiplier
                    }
                });

                await interaction.member.roles.add(boostRole);

                const embed = new EmbedBuilder()
                    .setTitle('✅ ブースト購入完了！')
                    .setDescription(`**${selectedBoost.name}** を購入しました！`)
                    .setColor(0x00ff00)
                    .addFields(
                        { name: '消費XP', value: cost.toLocaleString(), inline: true },
                        { name: '残りXP', value: Math.floor(newXp).toLocaleString(), inline: true },
                        { name: 'ブースト倍率', value: `**${selectedBoost.multiplier}倍**`, inline: true},
                        { name: '有効期限', value: `<t:${Math.floor(expiresAt / 1000)}:F>` }
                    );
                await interaction.editReply({ embeds: [embed] });
                console.log(chalk.green(`[XP Boost] ${user.tag} purchased a ${selectedBoost.name} boost in ${guild.name}.`));

            } catch (error) {
                console.error('XPブースト購入エラー:', error);
                await interaction.editReply({ content: '❌ 購入処理中にエラーが発生しました。' });
            }

        } else if (subcommand === 'status') {
            if (userData.boost && userData.boost.active && userData.boost.expiresAt > Date.now()) {
                const embed = new EmbedBuilder()
                    .setTitle('🚀 あなたのブースト状況')
                    .setColor(0x00ff00)
                    .setDescription('現在、XPブーストが有効です！')
                    .addFields(
                        { name: 'ブースト倍率', value: `**${userData.boost.multiplier}倍**`, inline: true },
                        { name: '有効期限', value: `<t:${Math.floor(userData.boost.expiresAt / 1000)}:R>`, inline: true }
                    );
                await interaction.editReply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle('🚀 あなたのブースト状況')
                    .setColor(0xffcc00)
                    .setDescription('現在、有効なXPブーストはありません。');
                await interaction.editReply({ embeds: [embed] });
            }
        }
    }
};