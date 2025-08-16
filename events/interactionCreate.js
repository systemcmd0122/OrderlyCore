const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // 対応するインタラクションタイプでなければ早期リターン
        if (!interaction.isChatInputCommand() && !interaction.isAutocomplete() && !interaction.isButton()) return;

        try {
            // 1. スラッシュコマンドの処理
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);

                if (!command) {
                    console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                    // 応答済みでないことを確認してから返信
                    if (!interaction.replied) {
                        await interaction.reply({
                            content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                            ephemeral: true
                        });
                    }
                    return;
                }

                try {
                    console.log(`🎯 コマンド実行: /${interaction.commandName} | ユーザー: ${interaction.user.tag} | サーバー: ${interaction.guild?.name || 'DM'}`);
                    // コマンドファイルに実行を移譲
                    await command.execute(interaction);
                } catch (error) {
                    console.error(`❌ コマンド実行エラー (${interaction.commandName}):`, error);

                    const errorMessage = {
                        content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                        ephemeral: true
                    };

                    // 応答が保留中か、既に応答済みかによって対応を分ける
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMessage).catch(console.error);
                    } else {
                        await interaction.reply(errorMessage).catch(console.error);
                    }
                }
                return;
            }

            // 2. オートコンプリートの処理
            if (interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);
                if (!command || !command.autocomplete) return;

                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error(`❌ オートコンプリートエラー (${interaction.commandName}):`, error);
                }
                return;
            }

            // 3. ボタンインタラクションの処理
            if (interaction.isButton()) {
                 // ロールパネル用のボタンか判定
                if (interaction.customId.startsWith('role_')) {
                    // 先に遅延応答をしてタイムアウトを防ぐ
                    await interaction.deferReply({ ephemeral: true });

                    const roleId = interaction.customId.replace('role_', '');
                    const role = interaction.guild.roles.cache.get(roleId);
                    const member = interaction.member;

                    // --- 安全性チェック ---
                    if (!role) {
                        return await interaction.editReply({ content: '❌ このロールはサーバーに存在しないため、操作できません。' });
                    }

                    const botMember = interaction.guild.members.cache.get(client.user.id);
                    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        return await interaction.editReply({ content: '❌ ボットにロールを管理する権限がありません。サーバー管理者にご連絡ください。' });
                    }

                    if (role.position >= botMember.roles.highest.position) {
                        return await interaction.editReply({ content: '❌ このロールはボットより上位のため、操作できません。' });
                    }

                    // --- ロール付与・削除処理 ---
                    try {
                        let embed;
                        if (member.roles.cache.has(roleId)) {
                            await member.roles.remove(role);
                            embed = new EmbedBuilder()
                                .setColor(0xff6b6b)
                                .setTitle('🗑️ ロールを削除しました')
                                .setDescription(`**${role.name}** ロールをあなたから削除しました。`);
                            console.log(`🔄 ロール削除: ${member.user.tag} から ${role.name} を削除`);
                        } else {
                            await member.roles.add(role);
                            embed = new EmbedBuilder()
                                .setColor(0x4caf50)
                                .setTitle('✅ ロールを付与しました')
                                .setDescription(`**${role.name}** ロールをあなたに付与しました。`);
                            console.log(`🔄 ロール付与: ${member.user.tag} に ${role.name} を付与`);
                        }
                        await interaction.editReply({ embeds: [embed] });

                    } catch (roleError) {
                        console.error(`❌ ロール操作エラー (${member.user.tag} -> ${role.name}):`, roleError);
                        await interaction.editReply({ content: '❌ ロールの操作中にエラーが発生しました。ボットの権限が正しいか確認してください。' });
                    }
                }
                // (他のボタン処理はここに 'else if' を追加)
                return;
            }

        } catch (error) {
            console.error('❌ インタラクション処理の包括的なエラー:', error);
            // 最終的なフォールバック
             try {
                const finalErrorMessage = { content: '⚠️ 予期せぬエラーが発生しました。', ephemeral: true };
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply(finalErrorMessage);
                } else if (interaction.deferred) {
                    await interaction.editReply(finalErrorMessage);
                }
            } catch (finalError) {
                console.error('❌ 最終エラーメッセージの送信にも失敗しました:', finalError);
            }
        }
    }
};