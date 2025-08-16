// ===== guildMemberRemove.js =====
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    name: 'guildMemberRemove',
    async execute(member, client) {
        try {
            const guildId = member.guild.id;
            const user = member.user;
            
            // Botの場合は処理しない
            if (user.bot) return;
            
            console.log(`👋 ${user.tag} が ${member.guild.name} から退出しました`);
            
            // Firestoreからサーバー設定を取得
            const guildConfigRef = doc(client.db, 'guilds', guildId);
            const guildConfigSnap = await getDoc(guildConfigRef);
            
            let guildConfig = {};
            if (guildConfigSnap.exists()) {
                guildConfig = guildConfigSnap.data();
            }
            
            // 各処理を並行して実行
            const promises = [];
            
            // 1. お別れメッセージを送信
            if (guildConfig.goodbyeChannelId) {
                promises.push(sendGoodbyeMessage(member, client, guildConfig));
            }
            
            // 2. ユーザーにDMを送信
            if (guildConfig.sendGoodbyeDM !== false) { // デフォルトは送信する
                promises.push(sendGoodbyeDM(member, client, guildConfig));
            }
            
            // 3. 統計情報を更新
            promises.push(updateLeaveStatistics(guildConfigRef, guildConfig, user, member));
            
            // 全ての処理を並行実行
            const results = await Promise.allSettled(promises);
            
            // エラーログ出力
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    const operations = ['お別れメッセージ送信', 'DM送信', '統計情報更新'];
                    console.error(`❌ ${operations[index]}エラー:`, result.reason);
                }
            });
            
        } catch (error) {
            console.error('❌ guildMemberRemove イベントエラー:', error);
        }
    },
};

// お別れメッセージを送信する関数
async function sendGoodbyeMessage(member, client, guildConfig) {
    try {
        const goodbyeChannel = member.guild.channels.cache.get(guildConfig.goodbyeChannelId);
        if (!goodbyeChannel) {
            console.log(`⚠️ お別れチャンネル ${guildConfig.goodbyeChannelId} が見つかりません`);
            return;
        }
        
        // 権限チェック
        if (!goodbyeChannel.permissionsFor(client.user).has([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks
        ])) {
            console.log(`❌ ${goodbyeChannel.name} に送信権限がありません`);
            return;
        }
        
        const user = member.user;
        const memberCount = member.guild.memberCount;
        const joinedDate = member.joinedAt;
        const stayDuration = joinedDate ? Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        // お別れメッセージのEmbed作成
        const goodbyeEmbed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle(`👋 お疲れ様でした`)
            .setDescription([
                `**${user.displayName}** さんがサーバーを退出されました。`,
                '',
                '💭 **思い出とともに**',
                `${user.displayName}さんとすごした時間は、このサーバーにとって貴重なものでした。`,
                '',
                '🌅 **また会える日まで**',
                'いつの日かまた、このサーバーでお会いできることを願っています。',
                'ご利用いただき、ありがとうございました！'
            ].join('\n'))
            .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: '👤 退出者情報',
                    value: [
                        `**ユーザー名**: ${user.tag}`,
                        `**表示名**: ${user.displayName}`,
                        `**滞在期間**: ${stayDuration.toLocaleString()}日間`,
                        joinedDate ? `**参加日**: <t:${Math.floor(joinedDate.getTime() / 1000)}:D>` : '**参加日**: 不明'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 サーバー統計',
                    value: [
                        `**現在のメンバー数**: ${memberCount.toLocaleString()}人`,
                        `**退出日時**: <t:${Math.floor(Date.now() / 1000)}:F>`,
                        `**今月の退出者**: ${(guildConfig.statistics?.monthlyLeaves || 0) + 1}人`
                    ].join('\n'),
                    inline: true
                }
            ]);
        
        // 滞在期間に応じたメッセージを追加
        if (stayDuration >= 365) {
            goodbyeEmbed.addFields([
                {
                    name: '🏆 長期滞在感謝',
                    value: `${Math.floor(stayDuration / 365)}年以上もの間、サーバーを支えていただき本当にありがとうございました！`,
                    inline: false
                }
            ]);
        } else if (stayDuration >= 30) {
            goodbyeEmbed.addFields([
                {
                    name: '🎖️ 感謝のメッセージ',
                    value: `${stayDuration}日間、サーバーに彩りを添えていただきありがとうございました！`,
                    inline: false
                }
            ]);
        } else if (stayDuration >= 7) {
            goodbyeEmbed.addFields([
                {
                    name: '🌻 ありがとうございました',
                    value: `${stayDuration}日間のご参加、ありがとうございました。短い間でしたが、素敵な時間でした！`,
                    inline: false
                }
            ]);
        }
        
        goodbyeEmbed.setFooter({
            text: `ユーザーID: ${user.id} | 現在のメンバー数: ${memberCount}`,
            iconURL: member.guild.iconURL() || null
        })
        .setTimestamp();
        
        await goodbyeChannel.send({ embeds: [goodbyeEmbed] });
        console.log(`👋 ${user.tag} のお別れメッセージを ${goodbyeChannel.name} に送信しました`);
        
    } catch (error) {
        console.error(`❌ お別れメッセージ送信エラー:`, error.message);
        throw error;
    }
}

// ユーザーにDMを送信する関数
async function sendGoodbyeDM(member, client, guildConfig) {
    try {
        const user = member.user;
        const guild = member.guild;
        
        // 無期限招待リンクを生成
        let inviteURL = null;
        try {
            // 招待作成に適したチャンネルを探す
            const suitableChannel = guild.channels.cache
                .filter(channel => 
                    (channel.isTextBased() || channel.type === 0) && // テキストチャンネル
                    channel.permissionsFor(guild.members.me).has([
                        PermissionsBitField.Flags.CreateInstantInvite
                    ]) &&
                    !channel.name.includes('log') &&
                    !channel.name.includes('bot')
                )
                .first();
            
            if (suitableChannel) {
                const invite = await suitableChannel.createInvite({
                    maxAge: 0, // 無期限
                    maxUses: 0, // 無制限使用
                    unique: false, // 既存の無期限招待があれば再利用
                    reason: `${user.tag} への退出時DM用招待リンク`
                });
                inviteURL = invite.url;
                console.log(`🔗 ${guild.name} の招待リンクを生成しました`);
            } else {
                console.log(`⚠️ ${guild.name} で招待リンク作成可能なチャンネルが見つかりません`);
            }
        } catch (error) {
            console.error(`❌ 招待リンク生成エラー:`, error.message);
        }
        
        // DMのEmbed作成
        const dmEmbed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`💙 ${guild.name} からの感謝メッセージ`)
            .setDescription([
                `**${user.displayName}** さん、`,
                '',
                `${guild.name} をご利用いただき、心より感謝申し上げます。`,
                '',
                '🌟 **サーバーでの日々**',
                'あなたがサーバーで過ごした時間は、私たちにとって貴重なものでした。',
                'コミュニティの一員として参加していただき、本当にありがとうございました。',
                '',
                '💫 **いつでもお待ちしています**',
                'もしまた機会がございましたら、いつでもお気軽にお戻りください。',
                'あなたの再参加を心よりお待ちしております！'
            ].join('\n'))
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }) || null)
            .addFields([
                {
                    name: '📊 あなたのサーバー滞在記録',
                    value: [
                        `**参加日**: ${member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : '不明'}`,
                        `**滞在期間**: ${member.joinedAt ? Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24)).toLocaleString() : '0'}日間`,
                        `**退出日時**: <t:${Math.floor(Date.now() / 1000)}:F>`,
                        `**サーバー**: ${guild.name}`
                    ].join('\n'),
                    inline: false
                }
            ]);
        
        if (inviteURL) {
            dmEmbed.addFields([
                {
                    name: '🚪 再参加リンク',
                    value: [
                        '下記リンクから、いつでもサーバーに再参加していただけます：',
                        `[**${guild.name} に再参加する**](${inviteURL})`,
                        '',
                        '※ このリンクは無期限有効です'
                    ].join('\n'),
                    inline: false
                }
            ]);
        }
        
        dmEmbed.addFields([
            {
                name: '💌 最後に',
                value: [
                    'この度は本当にありがとうございました。',
                    'あなたとの出会いに感謝し、今後のご活躍をお祈りしています。',
                    '',
                    'またお会いできる日を楽しみにしています！ 🌈'
                ].join('\n'),
                inline: false
            }
        ])
        .setFooter({
            text: `${guild.name} スタッフ一同より`,
            iconURL: guild.iconURL() || null
        })
        .setTimestamp();
        
        // DMを送信
        try {
            await user.send({ embeds: [dmEmbed] });
            console.log(`📨 ${user.tag} にお別れDMを送信しました`);
        } catch (dmError) {
            if (dmError.code === 50007) {
                console.log(`⚠️ ${user.tag} はDMを受け取れません（DM無効化済み）`);
            } else {
                console.error(`❌ ${user.tag} へのDM送信エラー:`, dmError.message);
            }
        }
        
    } catch (error) {
        console.error(`❌ 退出DM処理エラー:`, error.message);
        throw error;
    }
}

// 統計情報を更新する関数
async function updateLeaveStatistics(guildConfigRef, guildConfig, user, member) {
    try {
        const currentStats = guildConfig.statistics || {};
        const currentDate = new Date();
        const currentMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
        const stayDuration = member.joinedAt ? Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        // 月次統計をリセット（新しい月の場合）
        const lastUpdateMonth = currentStats.lastUpdateMonth || currentMonth;
        const monthlyLeaves = lastUpdateMonth === currentMonth ? (currentStats.monthlyLeaves || 0) : 0;
        
        await setDoc(guildConfigRef, {
            ...guildConfig,
            statistics: {
                ...currentStats,
                totalLeaves: (currentStats.totalLeaves || 0) + 1,
                monthlyLeaves: monthlyLeaves + 1,
                lastUpdateMonth: currentMonth,
                lastLeave: {
                    userId: user.id,
                    username: user.tag,
                    displayName: user.displayName,
                    stayDuration: stayDuration,
                    joinedAt: member.joinedAt ? member.joinedAt.getTime() : null,
                    timestamp: Date.now()
                },
                updatedAt: Date.now()
            }
        }, { merge: true });
        
        console.log(`📊 ${user.tag} の退出統計を更新しました（滞在期間: ${stayDuration}日）`);
    } catch (error) {
        console.error(`❌ 退出統計更新エラー:`, error.message);
        throw error;
    }
}