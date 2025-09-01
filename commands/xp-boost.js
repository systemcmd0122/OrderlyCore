const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const chalk = require('chalk');

// ユーザーデータを取得または新規作成する関数
async function getLevelData(db, guildId, userId) {
    const userRef = doc(db, 'levels', `${guildId}_${userId}`);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        return {
            xp: data.xp || 0,
            boost: data.boost || { active: false, expiresAt: null },
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
        boost: { active: false, expiresAt: null }
    };
}

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
                    option.setName('duration')
                        .setDescription('購入するブーストの期間')
                        .setRequired(true)
                        .addChoices(
                            { name: '1日間 (2.0x XP)', value: '1' },
                            { name: '7日間 (2.0x XP)', value: '7' },
                            { name: '30日間 (2.0x XP)', value: '30' }
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
        if (!settings.costs) {
            return interaction.editReply({ content: '❌ XPブーストの価格が設定されていません。サーバー管理者に連絡してください。' });
        }

        const boostRole = await guild.roles.fetch(settings.roleId);
        if (!boostRole) {
            return interaction.editReply({ content: '❌ XPブースト用のロールが見つかりませんでした。サーバー管理者に連絡してください。' });
        }

        const userData = await getLevelData(db, guild.id, user.id);

        if (subcommand === 'shop') {
            const shopEmbed = new EmbedBuilder()
                .setTitle('🚀 XPブーストストア')
                .setDescription('XPを消費して、期間限定でXP獲得量を**2倍**にするブーストを購入できます。')
                .setColor(0x5865F2)
                .addFields(
                    { name: 'ブースト (1日間)', value: `**${settings.costs['1'].toLocaleString()}** XP`, inline: true },
                    { name: 'ブースト (7日間)', value: `**${settings.costs['7'].toLocaleString()}** XP`, inline: true },
                    { name: 'ブースト (30日間)', value: `**${settings.costs['30'].toLocaleString()}** XP`, inline: true },
                    { name: 'あなたの所持XP', value: `**${Math.floor(userData.xp).toLocaleString()}** XP` }
                )
                .setFooter({ text: '`/xp-boost buy` で購入できます。' });
            await interaction.editReply({ embeds: [shopEmbed] });

        } else if (subcommand === 'buy') {
            const duration = interaction.options.getString('duration');
            const cost = settings.costs[duration];

            if (userData.boost && userData.boost.active && userData.boost.expiresAt > Date.now()) {
                return interaction.editReply({ content: '❌ 既に有効なブーストがあります。期間が終了してから再度購入してください。' });
            }
            if (userData.xp < cost) {
                return interaction.editReply({ content: `❌ XPが不足しています。このブーストには **${cost.toLocaleString()}** XPが必要です。` });
            }

            const newXp = userData.xp - cost;
            const expiresAt = Date.now() + (parseInt(duration) * 24 * 60 * 60 * 1000);

            try {
                const userRef = doc(db, 'levels', `${guild.id}_${user.id}`);
                await updateDoc(userRef, {
                    xp: newXp,
                    boost: {
                        active: true,
                        expiresAt: expiresAt
                    }
                });

                await interaction.member.roles.add(boostRole);

                const embed = new EmbedBuilder()
                    .setTitle('✅ ブースト購入完了！')
                    .setDescription(`**${duration}日間**のXPブーストを購入しました！`)
                    .setColor(0x00ff00)
                    .addFields(
                        { name: '消費XP', value: cost.toLocaleString(), inline: true },
                        { name: '残りXP', value: Math.floor(newXp).toLocaleString(), inline: true },
                        { name: '有効期限', value: `<t:${Math.floor(expiresAt / 1000)}:F>` }
                    );
                await interaction.editReply({ embeds: [embed] });
                console.log(chalk.green(`[XP Boost] ${user.tag} purchased a ${duration}-day boost in ${guild.name}.`));

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
                        { name: '有効期限', value: `<t:${Math.floor(userData.boost.expiresAt / 1000)}:R>` }
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