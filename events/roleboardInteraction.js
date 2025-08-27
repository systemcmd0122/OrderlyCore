const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // ボタンインタラクション以外、またはロールボタン以外は処理しない
        if (!interaction.isButton() || !interaction.customId.startsWith('role_')) return;

        // 先に応答を保留し、タイムアウトを防ぐ
        // ephemeral: true にすることで、応答はユーザーにのみ表示される
        await interaction.deferReply({ ephemeral: true });

        try {
            const roleId = interaction.customId.split('_')[1];
            const guild = interaction.guild;
            const member = interaction.member;
            const user = interaction.user;

            // ロールの存在確認
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return interaction.editReply({
                    content: '❌ このロールは削除されているか、見つかりません。',
                });
            }

            // ボットの権限チェック
            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.editReply({
                    content: '❌ ボットにロール管理権限がありません。サーバー管理者に連絡してください。',
                });
            }

            // ロール階層チェック
            const botHighestRole = guild.members.me.roles.highest;
            if (role.position >= botHighestRole.position) {
                return interaction.editReply({
                    content: `❌ ${role.name} はボットより上位のロールのため、操作できません。`,
                });
            }
            
            // @everyone ロールのチェック
            if (role.id === guild.id) {
                return interaction.editReply({
                    content: '❌ @everyone ロールは操作できません。',
                });
            }

            // 危険なロール（管理者権限など）のチェック
            if (role.permissions.has([
                PermissionsBitField.Flags.Administrator,
                PermissionsBitField.Flags.ManageGuild,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.BanMembers,
                PermissionsBitField.Flags.KickMembers
            ])) {
                return interaction.editReply({
                    content: '❌ 管理権限を含むロールは自動付与できません。',
                });
            }


            // ロールボードの設定を取得（ログ用）
            let roleboardConfig = null;
            try {
                const messageEmbed = interaction.message.embeds[0];
                if (messageEmbed && messageEmbed.footer && messageEmbed.footer.text) {
                    const footerText = messageEmbed.footer.text;
                    const boardIdMatch = footerText.match(/ロールボードID: (.+?) \|/);
                    if (boardIdMatch) {
                        const boardId = boardIdMatch[1];
                        const boardDoc = await getDoc(doc(client.db, 'roleboards', boardId));
                        if (boardDoc.exists()) {
                            roleboardConfig = { id: boardId, ...boardDoc.data() };
                        }
                    }
                }
            } catch (error) {
                console.log('ロールボード設定の取得に失敗しましたが、処理を継続します:', error.message);
            }

            // ロールの付与/削除処理
            const hasRole = member.roles.cache.has(roleId);
            const embed = new EmbedBuilder()
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 128 }))
                .setFooter({
                    text: `ユーザー: ${user.tag} | ロール: ${role.name}`,
                    iconURL: guild.iconURL()
                })
                .setTimestamp();

            if (hasRole) {
                // ロールを削除
                await member.roles.remove(role);
                embed.setColor(0xff6b6b)
                    .setTitle('🗑️ ロールを削除しました')
                    .setDescription(`**${role.name}** ロールを削除しました。`);
                console.log(`✅ ${user.tag} から ${role.name} ロールを削除しました`);
            } else {
                // ロールを付与
                await member.roles.add(role);
                embed.setColor(0x4caf50)
                    .setTitle('✅ ロールを付与しました')
                    .setDescription(`**${role.name}** ロールを付与しました。`);
                console.log(`✅ ${user.tag} に ${role.name} ロールを付与しました`);
            }

            // ロールの説明や特典がある場合は追加情報を表示
            if (roleboardConfig && roleboardConfig.roles && roleboardConfig.roles[roleId]) {
                const roleData = roleboardConfig.roles[roleId];
                if (roleData.genre) {
                    embed.addFields([
                        {
                            name: '🏷️ ロール情報',
                            value: `**カテゴリ**: ${roleData.genre}`,
                            inline: true
                        }
                    ]);
                }
            }

            // 現在のロール数を表示
            const userRoleCount = member.roles.cache.filter(r => r.id !== guild.id).size;
            embed.addFields([
                {
                    name: '📊 現在の状況',
                    value: `あなたが持っているロール数: **${userRoleCount}個**`,
                    inline: false
                }
            ]);

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ ロールボードインタラクションエラー:', error);
            
            // エラーの種類に応じたメッセージを作成
            let errorMessage = '❌ ロールの操作中に予期しないエラーが発生しました。';
            if (error.code === 50013) { // Missing Permissions
                errorMessage = '❌ ボットに十分な権限がありません。サーバー管理者に連絡してください。';
            } else if (error.code === 10008) { // Unknown Message
                 errorMessage = '❌ 元のメッセージが見つかりませんでした。再度コマンドを実行してください。';
            }

            const errorEmbed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('❌ エラーが発生しました')
                .setDescription(errorMessage)
                .addFields([
                    {
                        name: '🔧 対処方法',
                        value: [
                            '• サーバー管理者にボットの権限を確認してもらってください。',
                            '• ボットのロールが対象ロールより上位にあることを確認してください。',
                            '• しばらく時間をおいてから再度お試しください。'
                        ].join('\n'),
                    },
                    {
                        name: '📝 エラー詳細',
                        value: `\`\`\`${error.message}\`\`\``
                    }
                ])
                .setTimestamp();

            // deferReply後なので、editReplyでエラーメッセージを送信
            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};