const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorole-config')
        .setDescription('Bot用の自動ロール付与を設定します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Botに自動で付与するロールを設定または作成します。')
                .addStringOption(option => // RoleOptionからStringOptionに変更
                    option.setName('role-name')
                        .setDescription('Botに付与するロール名（存在しない場合は新規作成）')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Bot用の自動ロール付与を無効化します。')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('現在のBot用自動ロール設定を表示します。')
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        const settingsRef = doc(db, 'guild_settings', guildId);

        try {
            if (subcommand === 'set') {
                const roleName = interaction.options.getString('role-name');
                let role = interaction.guild.roles.cache.find(r => r.name === roleName);

                // Botの権限チェック
                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return await interaction.editReply({ content: '❌ ボットに「ロールの管理」権限がありません。' });
                }

                // ロールが存在しない場合は作成
                if (!role) {
                    try {
                        role = await interaction.guild.roles.create({
                            name: roleName,
                            color: '#a9cce3', // 薄い青色
                            permissions: [], // 権限なし
                            reason: `Overseer: Bot用自動ロールとして ${interaction.user.tag} によって作成されました。`
                        });
                        await interaction.followUp({ content: `✅ ロール「${role.name}」が存在しなかったため、新しく作成しました。`, ephemeral: true });
                    } catch (error) {
                        console.error('ロールの作成に失敗:', error);
                        return await interaction.editReply({ content: '❌ ロールの作成に失敗しました。権限設定を確認してください。' });
                    }
                }

                // ロール階層チェック
                if (role.position >= interaction.guild.members.me.roles.highest.position) {
                    return await interaction.editReply({ content: `❌ ${role} はボットより上位のロールのため、設定できません。` });
                }

                await setDoc(settingsRef, {
                    botAutoroleId: role.id
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ 設定完了')
                    .setDescription(`Botが参加した際に、自動的に ${role} ロールを付与します。`);
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'disable') {
                await setDoc(settingsRef, {
                    botAutoroleId: null
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0xffcc00)
                    .setTitle('設定解除')
                    .setDescription('Bot用の自動ロール付与を無効化しました。');
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'view') {
                const docSnap = await getDoc(settingsRef);
                const settings = docSnap.exists() ? docSnap.data() : {};
                const roleId = settings.botAutoroleId;

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('現在のBot用自動ロール設定');

                if (roleId) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    embed.setDescription(`Bot用の自動ロールは ${role || '不明なロール'} に設定されています。`);
                } else {
                    embed.setDescription('Bot用の自動ロールは設定されていません。');
                }
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('autorole-config コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};