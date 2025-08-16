// ===== guildMemberAdd.js =====
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        try {
            const guildId = member.guild.id;
            const user = member.user;
            
            // Botの場合は処理しない
            if (user.bot) return;
            
            console.log(`🎉 ${user.tag} が ${member.guild.name} に参加しました`);
            
            // Firestoreからサーバー設定を取得
            const guildConfigRef = doc(client.db, 'guilds', guildId);
            const guildConfigSnap = await getDoc(guildConfigRef);
            
            let guildConfig = {};
            if (guildConfigSnap.exists()) {
                guildConfig = guildConfigSnap.data();
            }
            
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
            
            // メンバー情報の取得
            const memberCount = member.guild.memberCount;
            const joinedDate = member.joinedAt;
            const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
            
            // ウェルカムメッセージのEmbed作成
            const welcomeEmbed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle(`🎉 ${member.guild.name} へようこそ！`)
                .setDescription([
                    `**${user.displayName}** さん、サーバーへのご参加ありがとうございます！`,
                    '',
                    '🌟 **サーバーでの過ごし方**',
                    '• チャンネルを確認して、適切な場所で会話を楽しんでください',
                    '• 他のメンバーとの交流を大切にしましょう',
                    '• サーバールールを守って、楽しい時間をお過ごしください',
                    '',
                    '何かご質問がございましたら、お気軽にスタッフまでお声がけください！'
                ].join('\n'))
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields([
                    {
                        name: '👤 あなたの情報',
                        value: [
                            `**ユーザー名**: ${user.tag}`,
                            `**表示名**: ${user.displayName}`,
                            `**アカウント作成**: <t:${Math.floor(user.createdAt.getTime() / 1000)}:R>`,
                            `**アカウント年数**: ${accountAge}日`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 サーバー統計',
                        value: [
                            `**総メンバー数**: ${memberCount.toLocaleString()}人`,
                            `**あなたは**: ${memberCount}番目の参加者`,
                            `**参加日時**: <t:${Math.floor(joinedDate.getTime() / 1000)}:F>`
                        ].join('\n'),
                        inline: true
                    }
                ])
                .setFooter({
                    text: `ユーザーID: ${user.id} | メンバー数: ${memberCount}`,
                    iconURL: member.guild.iconURL() || null
                })
                .setTimestamp();
            
            // サーバールールチャンネルがある場合
            if (guildConfig.rulesChannelId) {
                const rulesChannel = member.guild.channels.cache.get(guildConfig.rulesChannelId);
                if (rulesChannel) {
                    welcomeEmbed.addFields([
                        {
                            name: '📋 重要なお知らせ',
                            value: `まずは ${rulesChannel} をお読みください！\nサーバーを快適にご利用いただくためのルールが記載されています。`,
                            inline: false
                        }
                    ]);
                }
            }
            
            // ウェルカムロールがある場合は付与
            if (guildConfig.welcomeRoleId) {
                const welcomeRole = member.guild.roles.cache.get(guildConfig.welcomeRoleId);
                if (welcomeRole && member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                    try {
                        // ボットのロール階層チェック
                        if (welcomeRole.position < member.guild.members.me.roles.highest.position) {
                            await member.roles.add(welcomeRole);
                            console.log(`✅ ${user.tag} に ${welcomeRole.name} ロールを付与しました`);
                            
                            welcomeEmbed.addFields([
                                {
                                    name: '🎭 ロール付与完了',
                                    value: `${welcomeRole} ロールを付与しました！`,
                                    inline: false
                                }
                            ]);
                        } else {
                            console.log(`⚠️ ${welcomeRole.name} はボットより上位のロールです`);
                        }
                    } catch (error) {
                        console.error(`❌ ロール付与エラー:`, error.message);
                    }
                }
            }
            
            // ウェルカムメッセージをチャンネルに送信
            try {
                const messageContent = guildConfig.mentionOnWelcome ? `<@${user.id}>` : null;
                
                await welcomeChannel.send({ 
                    content: messageContent,
                    embeds: [welcomeEmbed] 
                });
                
                console.log(`🎉 ${user.tag} のウェルカムメッセージを ${welcomeChannel.name} に送信しました`);
            } catch (error) {
                console.error(`❌ ウェルカムメッセージ送信エラー:`, error.message);
            }
            
            // 統計情報を更新
            try {
                const currentStats = guildConfig.statistics || {};
                
                await setDoc(guildConfigRef, {
                    ...guildConfig,
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