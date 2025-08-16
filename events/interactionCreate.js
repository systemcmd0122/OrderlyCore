const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // メインのtry...catchですべてのインタラクションエラーを捕捉
        try {
            // 1. スラッシュコマンドの処理
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);

                if (!command) {
                    console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                    // deferされていないので、通常のreplyで応答
                    await interaction.reply({ 
                        content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                        flags: [MessageFlags.Ephemeral] 
                    });
                    return;
                }

                // コマンドファイル内のエラーはここで一元管理
                try {
                    console.log(`🎯 コマンド実行: /${interaction.commandName} | ユーザー: ${interaction.user.tag} | サーバー: ${interaction.guild?.name || 'DM'}`);
                    await command.execute(interaction);
                } catch (error) {
                    console.error(`❌ コマンド実行エラー (${interaction.commandName}):`, error);
                    
                    const errorMessage = {
                        content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                        flags: [MessageFlags.Ephemeral]
                    };

                    // 応答が保留中(deferred)か、既に応答済み(replied)かチェック
                    if (interaction.deferred || interaction.replied) {
                        // 追加メッセージとしてエラーを送信
                        await interaction.followUp(errorMessage);
                    } else {
                        // まだ応答していない場合は、通常通りエラーを送信
                        await interaction.reply(errorMessage);
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
                // ロールパネル用のボタンか判定 (customIdが 'role_' で始まる)
                if (interaction.customId.startsWith('role_')) {
                    const roleId = interaction.customId.replace('role_', '');
                    const role = interaction.guild.roles.cache.get(roleId);
                    const member = interaction.member;
                    
                    // 応答は本人にしか見えないように設定
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                    // --- 安全性チェック ---
                    if (!role) {
                        await interaction.editReply({ content: '❌ このロールはサーバーに存在しないため、操作できません。' });
                        return;
                    }
                    
                    const botMember = interaction.guild.members.cache.get(client.user.id);
                    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                        await interaction.editReply({ content: '❌ ボットにロールを管理する権限がありません。サーバー管理者にご連絡ください。' });
                        return;
                    }
                    
                    if (role.position >= botMember.roles.highest.position) {
                        await interaction.editReply({ content: '❌ このロールはボットより上位のため、操作できません。' });
                        return;
                    }
                    
                    // --- ロール付与・削除処理 ---
                    try {
                        let embed;
                        // メンバーが既にロールを持っているか確認
                        if (member.roles.cache.has(roleId)) {
                            // 持っている場合は削除
                            await member.roles.remove(role);
                            embed = new EmbedBuilder()
                                .setColor(0xff6b6b)
                                .setTitle('🗑️ ロールを削除しました')
                                .setDescription(`**${role.name}** ロールをあなたから削除しました。`);
                            
                            console.log(`🔄 ロール削除: ${member.user.tag} から ${role.name} を削除`);
                        } else {
                            // 持っていない場合は付与
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
                // (他のボタン処理が必要な場合は、ここに 'else if' を追加)
                return;
            }
            
            // 4. セレクトメニューの処理 (将来の拡張用)
            if (interaction.isStringSelectMenu()) {
                console.log(`📋 セレクトメニュー操作: ${interaction.customId} by ${interaction.user.tag}`);
                // ここにセレクトメニューの処理を追加
                return;
            }
            
            // 5. モーダル送信の処理 (将来の拡張用)
            if (interaction.isModalSubmit()) {
                console.log(`📝 モーダル送信: ${interaction.customId} by ${interaction.user.tag}`);
                // ここにモーダル送信の処理を追加
                return;
            }
            
        } catch (error) {
            console.error('❌ インタラクション処理の包括的なエラー:', error);
            // 最終的なフォールバックとしてエラーメッセージを送信
             try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: '⚠️ 予期せぬエラーが発生しました。', 
                        flags: [MessageFlags.Ephemeral] 
                    });
                } else {
                    await interaction.followUp({ 
                        content: '⚠️ 予期せぬエラーが発生しました。', 
                        flags: [MessageFlags.Ephemeral] 
                    });
                }
            } catch (finalError) {
                console.error('❌ 最終エラーメッセージの送信にも失敗しました:', finalError);
            }
        }
    }
};