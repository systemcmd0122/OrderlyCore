const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp-boost-config')
        .setDescription('XPブースト機能の設定を管理します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('機能を有効にするか無効にするか')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('boost_role')
                .setDescription('XPブースト用のロール (指定しない場合は自動生成/検索)')
                .setRequired(false)), // ★★★★★ 必須ではなくなりました ★★★★★

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const { guild, client } = interaction;
        const db = client.db;
        let boostRole = interaction.options.getRole('boost_role');
        const isEnabled = interaction.options.getBoolean('enabled');

        try {
            // ★★★★★【ここから変更】★★★★★
            // ロールが指定されなかった場合の自動処理
            if (!boostRole) {
                // サーバー内に "XP Boost" ロールが既に存在するか検索
                const existingRole = guild.roles.cache.find(role => role.name === 'XP Boost');
                
                if (existingRole) {
                    boostRole = existingRole;
                    console.log(chalk.blue(`[XP Boost Config] Found existing 'XP Boost' role in ${guild.name}.`));
                } else {
                    // 存在しない場合は自動生成
                    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        return interaction.editReply({
                            content: '❌ ボットに「ロールの管理」権限がないため、ブーストロールを自動生成できません。先に権限を付与するか、手動でロールを作成して指定してください。'
                        });
                    }
                    boostRole = await guild.roles.create({
                        name: 'XP Boost',
                        color: '#FFD700', // Gold color
                        reason: 'Role for XP Boost feature automatically created by OrderlyCore.',
                        hoist: true // メンバーリストで分離して表示
                    });
                    console.log(chalk.green(`[XP Boost Config] Automatically created 'XP Boost' role in ${guild.name}.`));
                }
            }
            // ★★★★★【ここまで変更】★★★★★

            // ボットがロールを管理できるかチェック
            if (boostRole.position >= interaction.guild.members.me.roles.highest.position) {
                return interaction.editReply({
                    content: `❌ ロール「${boostRole.name}」はボットより上位のため、管理できません。`
                });
            }

            const settingsRef = doc(db, 'guild_settings', guild.id);
            const boostSettings = {
                xpBoost: {
                    enabled: isEnabled,
                    roleId: boostRole.id,
                    costs: { // デフォルトのコスト設定
                        '1_2': 5000,
                        '7_2': 30000,
                        '1_5': 20000,
                        '7_5': 120000,
                        '1_10': 50000,
                        '7_10': 300000
                    }
                }
            };

            await setDoc(settingsRef, boostSettings, { merge: true });

            const embed = new EmbedBuilder()
                .setTitle('✅ XPブースト設定完了')
                .setColor(isEnabled ? 0x00ff00 : 0xffcc00)
                .setDescription(interaction.options.getRole('boost_role') ? '指定されたロールで設定を更新しました。' : 'ブースト用のロールを自動的に設定しました。')
                .addFields(
                    { name: 'ステータス', value: isEnabled ? '🟢 有効' : '🔴 無効', inline: true },
                    { name: 'ブーストロール', value: `${boostRole}`, inline: true }
                );
            
            await interaction.editReply({ embeds: [embed] });
            console.log(chalk.blue(`[XP Boost Config] Settings updated for ${guild.name}. Enabled: ${isEnabled}`));

        } catch (error) {
            console.error('XPブースト設定エラー:', error);
            await interaction.editReply({ content: '❌ 設定の保存中にエラーが発生しました。' });
        }
    }
};