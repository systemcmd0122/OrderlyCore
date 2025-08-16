const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // ボタンインタラクション以外は処理しない
        if (!interaction.isButton()) return;
        
        // ロールボタンかどうかチェック
        if (!interaction.customId.startsWith('role_')) return;

        try {
            const roleId = interaction.customId.split('_')[1];
            const guild = interaction.guild;
            const member = interaction.member;
            const user = interaction.user;

            // ロールの存在確認
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return interaction.reply({
                    content: '❌ このロールは削除されているか、見つかりません。',
                    ephemeral: true
                });
            }

            // ボットの権限チェック
            if (!guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return interaction.reply({
                    content: '❌ ボットにロール管理権限がありません。サーバー管理者に連絡してください。',
                    ephemeral: true
                });
            }

            // ロール階層チェック
            const botHighestRole = guild.members.me.roles.highest;
            if (role.position >= botHighestRole.position) {
                return interaction.reply({
                    content: `❌ ${role.name} はボットより上位のロールのため、操作できません。`,
                    ephemeral: true
                });
            }

            // @everyone ロールのチェック
            if (role.id === guild.id) {
                return interaction.reply({
                    content: '❌ @everyone ロールは操作できません。',
                    ephemeral: true
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
                return interaction.reply({
                    content: '❌ 管理権限を含むロールは自動付与できません。',
                    ephemeral: true
                });
            }

            // ロールボードの設定を取得（ログ用）
            let roleboardConfig = null;
            try {
                // メッセージからロールボード情報を取得
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

            try {
                if (hasRole) {
                    // ロールを削除
                    await member.roles.remove(role);
                    
                    embed.setColor(0xff6b6b)
                        .setTitle('🗑️ ロールを削除しました')
                        .setDescription(`**${role.name}** ロールを削除しました。`)
                        .addFields([
                            {
                                name: '📋 詳細情報',
                                value: [
                                    `**操作**: ロール削除`,
                                    `**ロール**: ${role}`,
                                    `**ユーザー**: ${user}`,
                                    `**実行日時**: <t:${Math.floor(Date.now() / 1000)}:F>`
                                ].join('\n'),
                                inline: false
                            }
                        ]);

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

                await interaction.reply({ embeds: [embed], ephemeral: true });

            } catch (roleError) {
                console.error(`❌ ロール操作エラー (${user.tag} -> ${role.name}):`, roleError);
                
                let errorMessage = '❌ ロールの操作中にエラーが発生しました。';
                
                // エラーの種類に応じたメッセージ
                if (roleError.code === 50013) {
                    errorMessage = '❌ ボットに十分な権限がありません。サーバー管理者に連絡してください。';
                } else if (roleError.code === 50001) {
                    errorMessage = '❌ このロールにアクセスする権限がありません。';
                } else if (roleError.message.includes('hierarchy')) {
                    errorMessage = '❌ ロールの階層が原因で操作できませんでした。';
                }

                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ エラーが発生しました')
                    .setDescription(errorMessage)
                    .addFields([
                        {
                            name: '🔧 対処方法',
                            value: [
                                '• サーバー管理者にボットの権限を確認してもらってください',
                                '• ボットのロールがより上位にあることを確認してください',
                                '• しばらく時間をおいてから再度お試しください'
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: '📝 エラー詳細',
                            value: `エラーコード: ${roleError.code || 'Unknown'}\nロール: ${role.name}`,
                            inline: false
                        }
                    ])
                    .setFooter({
                        text: `ユーザー: ${user.tag}`,
                        iconURL: user.displayAvatarURL()
                    })
                    .setTimestamp();

                await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
            }

        } catch (error) {
            console.error('❌ ロールボードインタラクションエラー:', error);
            
            try {
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ システムエラー')
                    .setDescription('予期しないエラーが発生しました。しばらく時間をおいてから再度お試しください。')
                    .addFields([
                        {
                            name: '🛠️ サポート情報',
                            value: [
                                'このエラーが続く場合は、サーバー管理者に以下の情報をお伝えください：',
                                `• エラー時刻: <t:${Math.floor(Date.now() / 1000)}:F>`,
                                `• ユーザー: ${interaction.user.tag}`,
                                `• ボタンID: ${interaction.customId}`
                            ].join('\n'),
                            inline: false
                        }
                    ])
                    .setTimestamp();

                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [errorEmbed], ephemeral: true });
                } else {
                    await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
                }
            } catch (replyError) {
                console.error('❌ エラーメッセージの送信にも失敗しました:', replyError);
            }
        }
    },
}