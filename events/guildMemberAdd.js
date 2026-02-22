// ===== guildMemberAdd.js =====
const { PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { generateWelcomeWithGemini, replacePlaceholders } = require('../src/services/welcomeService');
const { createStandardEmbed } = require('../src/utils/embedBuilder');


module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        try {
            const guildId = member.guild.id;
            const user = member.user;

            // Firestoreからサーバー設定を取得
            const guildSettingsRef = doc(client.db, 'guild_settings', guildId);
            const guildConfigRef = doc(client.db, 'guilds', guildId); // For welcome messages
            const [guildSettingsSnap, guildConfigSnap] = await Promise.all([
                getDoc(guildSettingsRef),
                getDoc(guildConfigRef)
            ]);

            const guildSettings = guildSettingsSnap.exists() ? guildSettingsSnap.data() : {};
            let guildConfig = guildConfigSnap.exists() ? guildConfigSnap.data() : {};

            // ▼▼▼ Bot用の自動ロール付与機能 ▼▼▼
            if (user.bot) {
                console.log(`🤖 Bot ${user.tag} が ${member.guild.name} に参加しました`);
                if (guildSettings.botAutoroleId) {
                    const role = member.guild.roles.cache.get(guildSettings.botAutoroleId);
                    if (role) {
                        try {
                            if (member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles) && role.position < member.guild.members.me.roles.highest.position) {
                                await member.roles.add(role);
                                console.log(`✅ ${user.tag} にBot用ロール ${role.name} を付与しました`);
                            } else {
                                console.log(`⚠️ Botロール(${role.name})の付与に失敗しました。権限またはロール階層を確認してください。`);
                            }
                        } catch (error) {
                            console.error(`❌ Botへのロール付与エラー:`, error.message);
                        }
                    } else {
                        console.log(`⚠️ 設定されているBot用ロール（ID: ${guildSettings.botAutoroleId}）が見つかりません`);
                    }
                }
                return; // Botの場合は以降のウェルカム処理をスキップ
            }
            // ▲▲▲ Bot用の自動ロール付与機能ここまで ▲▲▲

            console.log(`🎉 ${user.tag} が ${member.guild.name} に参加しました`);

            // ウェルカムチャンネルが設定されていない場合は何もしない
            if (!guildConfig.welcomeChannelId) {
                console.log(`📝 ${member.guild.name} にはウェルカムチャンネルが設定されていません`);
                return;
            }

            const welcomeChannel = member.guild.channels.cache.get(guildConfig.welcomeChannelId);
            if (!welcomeChannel) {
                console.log(`⚠️ ウェルカムチャンネル ${guildConfig.welcomeChannelId} が見つかりません`);
                return;
            }

            // 権限チェック
            if (!welcomeChannel.permissionsFor(client.user).has([
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
            ])) {
                console.log(`❌ ${welcomeChannel.name} に送信権限がありません`);
                return;
            }

            const welcomeMsgConfig = guildSettings.welcomeMessage || { enabled: false };

            if (welcomeMsgConfig.enabled) {
                let title, description;

                if (welcomeMsgConfig.type === 'gemini') {
                    const generated = await generateWelcomeWithGemini(client, member);
                    title = generated.title;
                    description = generated.description;
                } else {
                    title = replacePlaceholders(welcomeMsgConfig.title, member, guildConfig.rulesChannelId);
                    description = replacePlaceholders(welcomeMsgConfig.description, member, guildConfig.rulesChannelId);
                }

                const welcomeEmbed = createStandardEmbed({
                    color: 0x00ff00,
                    title: title,
                    description: description,
                    thumbnail: user.displayAvatarURL({ dynamic: true, size: 256 }),
                    image: welcomeMsgConfig.imageUrl || null
                });

                await welcomeChannel.send({
                    content: guildConfig.mentionOnWelcome ? `<@${user.id}>` : null,
                    embeds: [welcomeEmbed]
                });
                
                console.log(`💌 ${user.tag} のカスタムウェルカムメッセージを送信しました`);

            } else {
                const welcomeEmbed = createStandardEmbed({
                    color: 0x00ff00,
                    title: `🎉 ${member.guild.name} へようこそ！`,
                    description: `**${user.displayName}** さん、サーバーへのご参加ありがとうございます！`,
                    thumbnail: user.displayAvatarURL({ dynamic: true, size: 256 })
                });
                
                if (guildConfig.rulesChannelId) {
                    const rulesChannel = member.guild.channels.cache.get(guildConfig.rulesChannelId);
                    if (rulesChannel) {
                        welcomeEmbed.addFields([{ name: '📋 重要', value: `まずは ${rulesChannel} をご確認ください！` }]);
                    }
                }
                
                await welcomeChannel.send({
                    content: guildConfig.mentionOnWelcome ? `<@${user.id}>` : null,
                    embeds: [welcomeEmbed]
                });
                console.log(`🎉 ${user.tag} のデフォルトウェルカムメッセージを送信しました`);
            }
            // ★★★★★【ここまで追加・変更】★★★★★

            // ウェルカムロールがある場合は付与
            if (guildConfig.welcomeRoleId) {
                const welcomeRole = member.guild.roles.cache.get(guildConfig.welcomeRoleId);
                if (welcomeRole && member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    try {
                        if (welcomeRole.position < member.guild.members.me.roles.highest.position) {
                            await member.roles.add(welcomeRole);
                            console.log(`✅ ${user.tag} に ${welcomeRole.name} ロールを付与しました`);
                        } else {
                            console.log(`⚠️ ${welcomeRole.name} はボットより上位のロールです`);
                        }
                    } catch (error) {
                        console.error(`❌ ロール付与エラー:`, error.message);
                    }
                }
            }

            // 統計情報を更新
            try {
                const currentStats = guildConfig.statistics || {};
                await setDoc(guildConfigRef, {
                    statistics: {
                        ...currentStats,
                        totalJoins: (currentStats.totalJoins || 0) + 1,
                        lastJoin: {
                            userId: user.id,
                            username: user.tag,
                            displayName: user.displayName,
                            timestamp: Date.now()
                        },
                        updatedAt: Date.now()
                    }
                }, { merge: true });
                console.log(`📊 ${user.tag} の参加統計を更新しました`);
            } catch (error) {
                console.error(`❌ 統計情報更新エラー:`, error.message);
            }

        } catch (error) {
            console.error('❌ guildMemberAdd イベントエラー:', error);
        }
    },
};