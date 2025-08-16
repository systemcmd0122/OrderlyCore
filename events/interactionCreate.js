// events/interactionCreate.js
const { EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { doc, getDoc, runTransaction } = require('firebase/firestore');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        // メインのtry...catchですべてのインタラクションエラーを捕捉
        try {
            // 1. スラッシュコマンドの処理
            if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);

                if (!command) {
                    console.error(`❌ 未知のコマンド: ${interaction.commandName}`);
                    if (interaction.isChatInputCommand()) {
                        await interaction.reply({ 
                            content: `❌ コマンド「${interaction.commandName}」が見つかりません。`,
                            flags: MessageFlags.Ephemeral 
                        });
                    }
                    return;
                }

                // 各コマンドファイル内の処理に委譲
                try {
                    if (interaction.isAutocomplete()) {
                        if (command.autocomplete) {
                            await command.autocomplete(interaction);
                        }
                    } else if (interaction.isChatInputCommand()) {
                        console.log(`🎯 コマンド実行: /${interaction.commandName} | ユーザー: ${interaction.user.tag}`);
                        await command.execute(interaction);
                    }
                } catch (error) {
                    console.error(`❌ コマンド実行エラー (${interaction.commandName}):`, error);
                    const errorMessage = {
                        content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。',
                        flags: MessageFlags.Ephemeral
                    };
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp(errorMessage).catch(e => console.error('Error sending follow-up:', e));
                    } else {
                        await interaction.reply(errorMessage).catch(e => console.error('Error sending reply:', e));
                    }
                }
                return;
            }
            
            // 2. ボタンインタラクションの処理
            if (interaction.isButton()) {
                // --- ロールパネル用ボタン ---
                if (interaction.customId.startsWith('role_')) {
                    const roleId = interaction.customId.replace('role_', '');
                    const role = interaction.guild.roles.cache.get(roleId);
                    
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    if (!role || !interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= interaction.guild.members.me.roles.highest.position) {
                        await interaction.editReply({ content: '❌ このロールは操作できません。' });
                        return;
                    }
                    
                    const hasRole = interaction.member.roles.cache.has(roleId);
                    if (hasRole) {
                        await interaction.member.roles.remove(role);
                        await interaction.editReply({ content: `🗑️ ロール **${role.name}** を削除しました。` });
                    } else {
                        await interaction.member.roles.add(role);
                        await interaction.editReply({ content: `✅ ロール **${role.name}** を付与しました。` });
                    }
                    return;
                }

                // --- 投票ボタン用 ---
                if (interaction.customId.startsWith('poll_')) {
                    const pollCommand = client.commands.get('poll');
                    if (pollCommand && pollCommand.handleButton) await pollCommand.handleButton(interaction);
                    return;
                }

                // --- Giveawayボタン用 ---
                if (interaction.customId.startsWith('giveaway_')) {
                    const giveawayCommand = client.commands.get('giveaway');
                    if (giveawayCommand && giveawayCommand.handleButton) await giveawayCommand.handleButton(interaction);
                    return;
                }
                
                // --- チケット作成ボタン用 ---
                if (interaction.customId === 'create_ticket') {
                    const ticketCommand = client.commands.get('ticket');
                    if (ticketCommand && ticketCommand.handleCreateTicket) await ticketCommand.handleCreateTicket(interaction);
                    return;
                }
                
                // --- チケット閉じるボタン用 ---
                if (interaction.customId.startsWith('close_ticket_')) {
                    const ticketCommand = client.commands.get('ticket');
                    if (ticketCommand && ticketCommand.handleCloseTicket) await ticketCommand.handleCloseTicket(interaction);
                    return;
                }

                // --- Shop購入ボタン用 ---
                if (interaction.customId.startsWith('buy_item_')) {
                    await interaction.deferReply({ ephemeral: true });
                    const itemId = interaction.customId.split('_')[2];
                    const guildId = interaction.guild.id;
                    const userId = interaction.user.id;
                    const db = client.db;
                    
                    try {
                        await runTransaction(db, async (transaction) => {
                            const itemRef = doc(db, `shop_items/${guildId}/items`, itemId);
                            const userRef = doc(db, 'levels', `${guildId}_${userId}`);

                            const itemDoc = await transaction.get(itemRef);
                            const userDoc = await transaction.get(userRef);

                            if (!itemDoc.exists()) { throw new Error('商品が見つかりません。'); }
                            
                            const item = itemDoc.data();
                            const userCoins = userDoc.exists() ? (userDoc.data().coins || 0) : 0;

                            if (userCoins < item.price) { throw new Error('コインが不足しています。'); }
                            
                            const member = await interaction.guild.members.fetch(userId);
                            if (member.roles.cache.has(item.roleId)) { throw new Error('既にこのロールを所持しています。'); }

                            transaction.set(userRef, { coins: userCoins - item.price }, { merge: true });
                            await member.roles.add(item.roleId);
                            await interaction.editReply(`✅ **${item.name}** を購入しました！`);
                        });
                    } catch (error) {
                        console.error('購入処理エラー:', error);
                        await interaction.editReply(`❌ 購入に失敗しました: ${error.message}`);
                    }
                    return;
                }
                return;
            }
            
            // 3. その他のインタラクション (セレクトメニュー、モーダルなど)
            // 必要に応じてここに処理を追加
            
        } catch (error) {
            console.error('❌ インタラクション処理の包括的なエラー:', error);
             try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '⚠️ 予期せぬエラーが発生しました。', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.followUp({ content: '⚠️ 予期せぬエラーが発生しました。', flags: MessageFlags.Ephemeral });
                }
            } catch (finalError) {
                console.error('❌ 最終エラーメッセージの送信にも失敗しました:', finalError);
            }
        }
    }
};