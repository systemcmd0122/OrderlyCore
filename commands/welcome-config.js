const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome-config')
        .setDescription('ウェルカム・お別れメッセージの設定を管理します')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('ウェルカム機能の基本設定を行います')
                .addChannelOption(option =>
                    option
                        .setName('welcome-channel')
                        .setDescription('ウェルカムメッセージを送信するチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('goodbye-channel')
                        .setDescription('お別れメッセージを送信するチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option
                        .setName('welcome-role')
                        .setDescription('参加時に自動付与するロール')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option
                        .setName('rules-channel')
                        .setDescription('ルールチャンネル（ウェルカムメッセージで案内）')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('各機能のON/OFF切り替えを行います')
                .addStringOption(option =>
                    option
                        .setName('feature')
                        .setDescription('切り替える機能')
                        .setRequired(true)
                        .addChoices(
                            { name: 'ウェルカムでメンション', value: 'mention' },
                            { name: '退出時DM送信', value: 'goodbye-dm' }
                        )
                )
                .addBooleanOption(option =>
                    option
                        .setName('enabled')
                        .setDescription('機能を有効にするかどうか')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('現在のウェルカム設定を表示します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription('ウェルカムメッセージをテスト送信します')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('テスト対象のユーザー（省略時は実行者）')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('ウェルカム設定をリセットします')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('サーバーの参加・退出統計を表示します')
        ),

    async execute(interaction) {
        // 権限チェック
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return await interaction.reply({
                content: '❌ この機能を使用するには「サーバー管理」権限が必要です。',
                flags: 64 // ephemeral flag
            });
        }

        // 即座にdeferReplyを送信（3秒のタイムアウトを防ぐ）
        await interaction.deferReply({ ephemeral: false });

        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const guildConfigRef = doc(interaction.client.db, 'guilds', guildId);

        try {
            switch (subcommand) {
                case 'setup':
                    await handleSetup(interaction, guildConfigRef);
                    break;
                case 'toggle':
                    await handleToggle(interaction, guildConfigRef);
                    break;
                case 'view':
                    await handleView(interaction, guildConfigRef);
                    break;
                case 'test':
                    await handleTest(interaction, guildConfigRef);
                    break;
                case 'reset':
                    await handleReset(interaction, guildConfigRef);
                    break;
                case 'stats':
                    await handleStats(interaction, guildConfigRef);
                    break;
            }
        } catch (error) {
            console.error('❌ welcome-config コマンドエラー:', error);
            
            const errorMessage = {
                content: '❌ 設定の処理中にエラーが発生しました。',
                flags: 64 // ephemeral flag
            };

            try {
                if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply(errorMessage);
                } else if (!interaction.replied) {
                    await interaction.reply(errorMessage);
                }
            } catch (replyError) {
                console.error('❌ エラーレスポンス送信失敗:', replyError);
            }
        }
    },
};

// セットアップ処理
async function handleSetup(interaction, guildConfigRef) {
    try {
        const welcomeChannel = interaction.options.getChannel('welcome-channel');
        const goodbyeChannel = interaction.options.getChannel('goodbye-channel');
        const welcomeRole = interaction.options.getRole('welcome-role');
        const rulesChannel = interaction.options.getChannel('rules-channel');

        // 現在の設定を取得
        const guildConfigSnap = await getDoc(guildConfigRef);
        const currentConfig = guildConfigSnap.exists() ? guildConfigSnap.data() : {};

        const updates = { ...currentConfig };
        const changesLog = [];

        if (welcomeChannel) {
            // チャンネル権限チェック
            if (!welcomeChannel.permissionsFor(interaction.guild.members.me).has([
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
            ])) {
                return await interaction.editReply({
                    content: `❌ ${welcomeChannel} に必要な権限がありません（メッセージ送信、埋め込みリンク）。`
                });
            }
            updates.welcomeChannelId = welcomeChannel.id;
            changesLog.push(`✅ ウェルカムチャンネル: ${welcomeChannel}`);
        }

        if (goodbyeChannel) {
            // チャンネル権限チェック
            if (!goodbyeChannel.permissionsFor(interaction.guild.members.me).has([
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks
            ])) {
                return await interaction.editReply({
                    content: `❌ ${goodbyeChannel} に必要な権限がありません（メッセージ送信、埋め込みリンク）。`
                });
            }
            updates.goodbyeChannelId = goodbyeChannel.id;
            changesLog.push(`✅ お別れチャンネル: ${goodbyeChannel}`);
        }

        if (welcomeRole) {
            // ボットがロール管理権限を持っているかチェック
            if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return await interaction.editReply({
                    content: '❌ ボットに「ロールの管理」権限がないため、ウェルカムロールを設定できません。'
                });
            }

            // ボットのロールより低い位置のロールかチェック
            const botHighestRole = interaction.guild.members.me.roles.highest;
            if (welcomeRole.position >= botHighestRole.position) {
                return await interaction.editReply({
                    content: `❌ ${welcomeRole} はボットのロール（${botHighestRole}）より上位にあるため設定できません。`
                });
            }

            // @everyone ロールは設定不可
            if (welcomeRole.id === interaction.guild.id) {
                return await interaction.editReply({
                    content: '❌ @everyone ロールはウェルカムロールに設定できません。'
                });
            }

            updates.welcomeRoleId = welcomeRole.id;
            changesLog.push(`✅ ウェルカムロール: ${welcomeRole}`);
        }

        if (rulesChannel) {
            updates.rulesChannelId = rulesChannel.id;
            changesLog.push(`✅ ルールチャンネル: ${rulesChannel}`);
        }

        if (changesLog.length === 0) {
            return await interaction.editReply({
                content: '❌ 少なくとも1つの設定項目を指定してください。'
            });
        }

        // 設定を保存
        updates.updatedAt = Date.now();
        updates.updatedBy = interaction.user.id;
        
        await setDoc(guildConfigRef, updates, { merge: true });

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎉 ウェルカム設定が更新されました！')
            .setDescription('以下の設定が保存されました：')
            .addFields([
                {
                    name: '📝 変更された設定',
                    value: changesLog.join('\n'),
                    inline: false
                },
                {
                    name: '💡 次のステップ',
                    value: [
                        '• `/welcome-config test` でメッセージをテストできます',
                        '• `/welcome-config view` で全設定を確認できます',
                        '• `/welcome-config toggle` で機能のON/OFFを切り替えできます'
                    ].join('\n'),
                    inline: false
                }
            ])
            .setFooter({
                text: `設定者: ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ handleSetup エラー:', error);
        throw error;
    }
}

// トグル設定処理
async function handleToggle(interaction, guildConfigRef) {
    try {
        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');

        // 現在の設定を取得
        const guildConfigSnap = await getDoc(guildConfigRef);
        const currentConfig = guildConfigSnap.exists() ? guildConfigSnap.data() : {};

        const updates = { ...currentConfig };
        let featureName = '';
        let description = '';

        switch (feature) {
            case 'mention':
                updates.mentionOnWelcome = enabled;
                featureName = 'ウェルカム時メンション';
                description = enabled ? '新規参加者をメンションして通知します' : '新規参加者をメンションしません';
                break;
            case 'goodbye-dm':
                updates.sendGoodbyeDM = enabled;
                featureName = '退出時DM送信';
                description = enabled ? '退出者にお別れDMを送信します' : '退出者にDMを送信しません';
                break;
        }

        updates.updatedAt = Date.now();
        updates.updatedBy = interaction.user.id;

        await setDoc(guildConfigRef, updates, { merge: true });

        const embed = new EmbedBuilder()
            .setColor(enabled ? 0x00ff00 : 0xff6b6b)
            .setTitle(`${enabled ? '✅' : '❌'} 機能設定が更新されました！`)
            .addFields([
                {
                    name: '🔧 変更された機能',
                    value: `**${featureName}**: ${enabled ? '有効' : '無効'}`,
                    inline: false
                },
                {
                    name: '📄 説明',
                    value: description,
                    inline: false
                }
            ])
            .setFooter({
                text: `設定者: ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ handleToggle エラー:', error);
        throw error;
    }
}

// 設定表示処理
async function handleView(interaction, guildConfigRef) {
    try {
        const guildConfigSnap = await getDoc(guildConfigRef);
        
        if (!guildConfigSnap.exists()) {
            return await interaction.editReply({
                content: '❌ まだウェルカム設定が行われていません。`/welcome-config setup` で設定を開始してください。'
            });
        }

        const config = guildConfigSnap.data();
        const guild = interaction.guild;

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🔧 現在のウェルカム設定')
            .setThumbnail(guild.iconURL({ dynamic: true }));

        // チャンネル設定
        const channelSettings = [];
        if (config.welcomeChannelId) {
            const welcomeChannel = guild.channels.cache.get(config.welcomeChannelId);
            const status = welcomeChannel ? '✅' : '❌ チャンネルが見つかりません';
            channelSettings.push(`**ウェルカム**: ${welcomeChannel || '削除済み'} ${status}`);
        } else {
            channelSettings.push('**ウェルカム**: 未設定');
        }

        if (config.goodbyeChannelId) {
            const goodbyeChannel = guild.channels.cache.get(config.goodbyeChannelId);
            const status = goodbyeChannel ? '✅' : '❌ チャンネルが見つかりません';
            channelSettings.push(`**お別れ**: ${goodbyeChannel || '削除済み'} ${status}`);
        } else {
            channelSettings.push('**お別れ**: 未設定');
        }

        if (config.rulesChannelId) {
            const rulesChannel = guild.channels.cache.get(config.rulesChannelId);
            const status = rulesChannel ? '✅' : '❌ チャンネルが見つかりません';
            channelSettings.push(`**ルール**: ${rulesChannel || '削除済み'} ${status}`);
        } else {
            channelSettings.push('**ルール**: 未設定');
        }

        embed.addFields([
            {
                name: '📺 チャンネル設定',
                value: channelSettings.join('\n'),
                inline: false
            }
        ]);

        // ロール設定
        if (config.welcomeRoleId) {
            const welcomeRole = guild.roles.cache.get(config.welcomeRoleId);
            const status = welcomeRole ? '✅' : '❌ ロールが見つかりません';
            embed.addFields([
                {
                    name: '🎭 ロール設定',
                    value: `**ウェルカムロール**: ${welcomeRole || '削除済み'} ${status}`,
                    inline: false
                }
            ]);
        }

        // 機能設定
        const featureSettings = [
            `**ウェルカム時メンション**: ${config.mentionOnWelcome ? '✅ 有効' : '❌ 無効'}`,
            `**退出時DM送信**: ${config.sendGoodbyeDM !== false ? '✅ 有効' : '❌ 無効'}`
        ];

        embed.addFields([
            {
                name: '⚙️ 機能設定',
                value: featureSettings.join('\n'),
                inline: false
            }
        ]);

        // 統計情報
        if (config.statistics) {
            const stats = config.statistics;
            const statsText = [
                `**総参加数**: ${(stats.totalJoins || 0).toLocaleString()}人`,
                `**総退出数**: ${(stats.totalLeaves || 0).toLocaleString()}人`,
                `**今月の参加**: ${(stats.monthlyJoins || 0).toLocaleString()}人`,
                `**今月の退出**: ${(stats.monthlyLeaves || 0).toLocaleString()}人`
            ];

            if (stats.lastJoin) {
                statsText.push(`**最後の参加**: ${stats.lastJoin.displayName} (<t:${Math.floor(stats.lastJoin.timestamp / 1000)}:R>)`);
            }

            if (stats.lastLeave) {
                statsText.push(`**最後の退出**: ${stats.lastLeave.displayName} (<t:${Math.floor(stats.lastLeave.timestamp / 1000)}:R>)`);
            }

            embed.addFields([
                {
                    name: '📊 統計情報',
                    value: statsText.join('\n'),
                    inline: false
                }
            ]);
        }

        embed.setFooter({
            text: `サーバー: ${guild.name} | 最終更新: ${config.updatedAt ? new Date(config.updatedAt).toLocaleString('ja-JP') : '不明'}`,
            iconURL: guild.iconURL()
        })
        .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ handleView エラー:', error);
        throw error;
    }
}

// テスト送信処理
async function handleTest(interaction, guildConfigRef) {
    try {
        const testUser = interaction.options.getUser('user') || interaction.user;
        
        const guildConfigSnap = await getDoc(guildConfigRef);
        if (!guildConfigSnap.exists() || !guildConfigSnap.data().welcomeChannelId) {
            return await interaction.editReply({
                content: '❌ ウェルカムチャンネルが設定されていません。まず `/welcome-config setup` で設定してください。'
            });
        }

        const config = guildConfigSnap.data();
        const welcomeChannel = interaction.guild.channels.cache.get(config.welcomeChannelId);

        if (!welcomeChannel) {
            return await interaction.editReply({
                content: '❌ 設定されたウェルカムチャンネルが見つかりません。'
            });
        }

        // 権限チェック
        if (!welcomeChannel.permissionsFor(interaction.client.user).has([
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.EmbedLinks
        ])) {
            return await interaction.editReply({
                content: `❌ ${welcomeChannel} に送信権限がありません。`
            });
        }

        // テスト用のウェルカムメッセージを作成
        const memberCount = interaction.guild.memberCount;
        const accountAge = Math.floor((Date.now() - testUser.createdAt.getTime()) / (1000 * 60 * 60 * 24));

        const welcomeEmbed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(`🎉 ${interaction.guild.name} へようこそ！【テスト】`)
            .setDescription([
                `**${testUser.displayName}** さん、サーバーへのご参加ありがとうございます！`,
                '',
                '🌟 **サーバーでの過ごし方**',
                '• チャンネルを確認して、適切な場所で会話を楽しんでください',
                '• 他のメンバーとの交流を大切にしましょう',
                '• サーバールールを守って、楽しい時間をお過ごしください',
                '',
                '何かご質問がございましたら、お気軽にスタッフまでお声がけください！'
            ].join('\n'))
            .setThumbnail(testUser.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields([
                {
                    name: '👤 あなたの情報',
                    value: [
                        `**ユーザー名**: ${testUser.tag}`,
                        `**表示名**: ${testUser.displayName}`,
                        `**アカウント作成**: <t:${Math.floor(testUser.createdAt.getTime() / 1000)}:R>`,
                        `**アカウント年数**: ${accountAge}日`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 サーバー統計',
                    value: [
                        `**総メンバー数**: ${memberCount.toLocaleString()}人`,
                        `**あなたは**: ${memberCount}番目の参加者`,
                        `**参加日時**: <t:${Math.floor(Date.now() / 1000)}:F>`
                    ].join('\n'),
                    inline: true
                }
            ]);

        // ルールチャンネルがある場合
        if (config.rulesChannelId) {
            const rulesChannel = interaction.guild.channels.cache.get(config.rulesChannelId);
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

        welcomeEmbed.addFields([
            {
                name: '🧪 テストモード',
                value: 'これはテスト送信です。実際の参加時とは表示が異なる場合があります。',
                inline: false
            }
        ])
        .setFooter({
            text: `ユーザーID: ${testUser.id} | テスト実行者: ${interaction.user.tag}`,
            iconURL: interaction.guild.iconURL()
        })
        .setTimestamp();

        try {
            const messageContent = config.mentionOnWelcome ? `<@${testUser.id}> 【テスト】` : '【テスト】';
            
            await welcomeChannel.send({ 
                content: messageContent,
                embeds: [welcomeEmbed] 
            });

            await interaction.editReply({
                content: `✅ テスト用ウェルカムメッセージを ${welcomeChannel} に送信しました！`
            });
        } catch (sendError) {
            console.error('テストメッセージ送信エラー:', sendError);
            await interaction.editReply({
                content: `❌ テストメッセージの送信に失敗しました: ${sendError.message}`
            });
        }
    } catch (error) {
        console.error('❌ handleTest エラー:', error);
        throw error;
    }
}

// リセット処理
async function handleReset(interaction, guildConfigRef) {
    try {
        const guildConfigSnap = await getDoc(guildConfigRef);
        
        if (!guildConfigSnap.exists()) {
            return await interaction.editReply({
                content: '❌ リセットする設定が存在しません。'
            });
        }

        // 統計情報以外をリセット
        const config = guildConfigSnap.data();
        const resetConfig = {
            statistics: config.statistics || {}, // 統計情報は保持
            resetAt: Date.now(),
            resetBy: interaction.user.id
        };

        await setDoc(guildConfigRef, resetConfig);

        const embed = new EmbedBuilder()
            .setColor(0xff6b6b)
            .setTitle('🔄 設定がリセットされました')
            .setDescription('ウェルカム設定がすべてクリアされました。統計情報は保持されています。')
            .addFields([
                {
                    name: '📝 リセットされた項目',
                    value: [
                        '• ウェルカムチャンネル',
                        '• お別れチャンネル',
                        '• ウェルカムロール',
                        '• ルールチャンネル',
                        '• 機能設定（メンション、DM送信）'
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '💡 次のステップ',
                    value: '`/welcome-config setup` で新しい設定を開始してください。',
                    inline: false
                }
            ])
            .setFooter({
                text: `実行者: ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ handleReset エラー:', error);
        throw error;
    }
}

// 統計表示処理
async function handleStats(interaction, guildConfigRef) {
    try {
        const guildConfigSnap = await getDoc(guildConfigRef);
        
        const stats = guildConfigSnap.exists() ? (guildConfigSnap.data().statistics || {}) : {};
        const guild = interaction.guild;

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('📊 サーバー統計情報')
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .setDescription(`${guild.name} の参加・退出統計データです`);

        // 基本統計
        const totalJoins = stats.totalJoins || 0;
        const totalLeaves = stats.totalLeaves || 0;
        const monthlyJoins = stats.monthlyJoins || 0;
        const monthlyLeaves = stats.monthlyLeaves || 0;
        const currentMembers = guild.memberCount;
        const netGrowth = totalJoins - totalLeaves;

        embed.addFields([
            {
                name: '📈 全期間統計',
                value: [
                    `**総参加者数**: ${totalJoins.toLocaleString()}人`,
                    `**総退出者数**: ${totalLeaves.toLocaleString()}人`,
                    `**純増加数**: ${netGrowth >= 0 ? '+' : ''}${netGrowth.toLocaleString()}人`,
                    `**現在のメンバー数**: ${currentMembers.toLocaleString()}人`
                ].join('\n'),
                inline: true
            },
            {
                name: '📅 今月の統計',
                value: [
                    `**今月の参加**: ${monthlyJoins.toLocaleString()}人`,
                    `**今月の退出**: ${monthlyLeaves.toLocaleString()}人`,
                    `**今月の純増**: ${(monthlyJoins - monthlyLeaves) >= 0 ? '+' : ''}${(monthlyJoins - monthlyLeaves).toLocaleString()}人`,
                    `**参加率**: ${totalJoins > 0 ? ((totalJoins - totalLeaves) / totalJoins * 100).toFixed(1) : '0'}%`
                ].join('\n'),
                inline: true
            }
        ]);

        // 最近のアクティビティ
        const recentActivity = [];
        if (stats.lastJoin) {
            recentActivity.push(`**最後の参加**: ${stats.lastJoin.displayName || stats.lastJoin.username}`);
            recentActivity.push(`　<t:${Math.floor(stats.lastJoin.timestamp / 1000)}:R>`);
        }

        if (stats.lastLeave) {
            recentActivity.push(`**最後の退出**: ${stats.lastLeave.displayName || stats.lastLeave.username}`);
            recentActivity.push(`　<t:${Math.floor(stats.lastLeave.timestamp / 1000)}:R>`);
            if (stats.lastLeave.stayDuration) {
                recentActivity.push(`　滞在期間: ${stats.lastLeave.stayDuration}日間`);
            }
        }

        if (recentActivity.length > 0) {
            embed.addFields([
                {
                    name: '🕒 最近のアクティビティ',
                    value: recentActivity.join('\n'),
                    inline: false
                }
            ]);
        }

        // 設定状況
        const config = guildConfigSnap.exists() ? guildConfigSnap.data() : {};
        const configStatus = [];
        configStatus.push(`**ウェルカム機能**: ${config.welcomeChannelId ? '✅ 有効' : '❌ 無効'}`);
        configStatus.push(`**お別れ機能**: ${config.goodbyeChannelId ? '✅ 有効' : '❌ 無効'}`);
        configStatus.push(`**自動ロール**: ${config.welcomeRoleId ? '✅ 有効' : '❌ 無効'}`);

        embed.addFields([
            {
                name: '⚙️ 機能設定状況',
                value: configStatus.join('\n'),
                inline: false
            }
        ]);

        embed.setFooter({
            text: `データ更新: ${stats.updatedAt ? new Date(stats.updatedAt).toLocaleString('ja-JP') : '未更新'}`,
            iconURL: guild.iconURL()
        })
        .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('❌ handleStats エラー:', error);
        throw error;
    }
}