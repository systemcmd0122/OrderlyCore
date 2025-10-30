const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
    ComponentType,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Colors,
} = require('discord.js');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

// 🎨 カラーテーマの定数
const COLORS = {
    PRIMARY: Colors.Blurple,
    SUCCESS: Colors.Green,
    WARNING: Colors.Yellow,
    DANGER: Colors.Red,
    INFO: Colors.Blue,
    SECONDARY: Colors.Greyple,
};

// 📊 設定項目の定義
const CONFIG_CATEGORIES = {
    general: { emoji: '👥', name: '一般設定', color: COLORS.PRIMARY },
    logging: { emoji: '📜', name: 'ログ設定', color: COLORS.SECONDARY },
    leveling: { emoji: '🏆', name: 'レベリング', color: COLORS.SUCCESS },
    automod: { emoji: '🛡️', name: 'オートモッド', color: COLORS.DANGER },
    ai: { emoji: '🤖', name: 'AI設定', color: COLORS.INFO },
};

// Firestoreから設定を取得するヘルパー関数（キャッシュ付き）
async function getSettings(db, guildId) {
    try {
        const settingsRef = doc(db, 'guild_settings', guildId);
        const docSnap = await getDoc(settingsRef);
        return docSnap.exists() ? docSnap.data() : {};
    } catch (error) {
        console.error('❌ 設定取得エラー:', error);
        return {};
    }
}

// 設定を安全に更新する関数
async function updateSettings(db, guildId, updates) {
    try {
        const settingsRef = doc(db, 'guild_settings', guildId);
        await setDoc(settingsRef, updates, { merge: true });
        return { success: true };
    } catch (error) {
        console.error('❌ 設定更新エラー:', error);
        return { success: false, error };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('サーバーの各種設定をインタラクティブに行います')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false),

    async execute(interaction) {
        const { client, guild, user } = interaction;
        const db = client.db;

        if (!db) {
            return interaction.reply({
                content: '❌ データベース接続が確立されていません。',
                ephemeral: true,
            });
        }

        // --- メインメニューの生成 ---
        const generateMainMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const completionRate = calculateCompletionRate(settings);

            const mainEmbed = new EmbedBuilder()
                .setColor(COLORS.PRIMARY)
                .setAuthor({
                    name: `${guild.name} 設定パネル`,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle('⚙️ サーバー設定センター')
                .setDescription(
                    '```ansi\n' +
                    '\u001b[1;36m🎯 設定したい項目を下のボタンから選択してください\n' +
                    '\u001b[1;32m💾 全ての設定は自動的に保存されます\n' +
                    '\u001b[1;33m⏰ 操作は5分間有効です\n' +
                    '```'
                )
                .addFields([
                    {
                        name: `${CONFIG_CATEGORIES.general.emoji} ${CONFIG_CATEGORIES.general.name}`,
                        value:
                            `> 参加・退出メッセージや自動ロールなど\n` +
                            `> 基本的な設定を管理します\n` +
                            `\n**現在の設定:**\n` +
                            `🏠 ウェルカムCH: ${settings.welcomeChannelId ? `<#${settings.welcomeChannelId}>` : '`未設定`'}\n` +
                            `👋 お別れCH: ${settings.goodbyeChannelId ? `<#${settings.goodbyeChannelId}>` : '`未設定`'}\n` +
                            `🤖 Bot自動ロール: ${settings.botAutoroleId ? `<@&${settings.botAutoroleId}>` : '`未設定`'}`,
                        inline: false,
                    },
                    {
                        name: `${CONFIG_CATEGORIES.logging.emoji} ${CONFIG_CATEGORIES.logging.name}`,
                        value:
                            `> 監査ログやVCログなど\n` +
                            `> サーバーの動作を記録する設定\n` +
                            `\n**現在の設定:**\n` +
                            `📋 監査ログCH: ${settings.auditLogChannel ? `<#${settings.auditLogChannel}>` : '`未設定`'}`,
                        inline: true,
                    },
                    {
                        name: `${CONFIG_CATEGORIES.leveling.emoji} ${CONFIG_CATEGORIES.leveling.name}`,
                        value:
                            `> サーバー内での活動を評価する\n` +
                            `> レベリングシステムの設定\n` +
                            `\n**現在の設定:**\n` +
                            `🎉 レベルアップCH: ${settings.levelUpChannel ? `<#${settings.levelUpChannel}>` : '`未設定`'}`,
                        inline: true,
                    },
                    {
                        name: `${CONFIG_CATEGORIES.automod.emoji} ${CONFIG_CATEGORIES.automod.name}`,
                        value:
                            `> NGワードや招待リンクなど\n` +
                            `> 自動管理機能の設定\n` +
                            `\n**現在の設定:**\n` +
                            `🚫 招待ブロック: ${settings.automod?.blockInvites !== false ? '`✅ 有効`' : '`❌ 無効`'}\n` +
                            `📝 NGワード: ${settings.automod?.ngWords?.length ? `\`${settings.automod.ngWords.length}件\`` : '`未設定`'}`,
                        inline: true,
                    },
                    {
                        name: `${CONFIG_CATEGORIES.ai.emoji} ${CONFIG_CATEGORIES.ai.name}`,
                        value:
                            `> メンションへの自動応答など\n` +
                            `> AIに関する設定を管理\n` +
                            `\n**現在の設定:**\n` +
                            `💬 メンション応答: ${settings.ai?.mentionReplyEnabled !== false ? '`✅ 有効`' : '`❌ 無効`'}\n` +
                            `🎭 AI性格: ${settings.ai?.aiPersonalityPrompt ? '`✅ 設定済み`' : '`未設定`'}`,
                        inline: true,
                    },
                ])
                .addFields([
                    {
                        name: '📊 設定完了率',
                        value: `\`\`\`\n${'█'.repeat(Math.floor(completionRate / 10))}${'░'.repeat(10 - Math.floor(completionRate / 10))} ${completionRate}%\n\`\`\``,
                        inline: false,
                    },
                ])
                .setFooter({
                    text: `${user.username} によって実行 • 操作は5分間有効`,
                    iconURL: user.displayAvatarURL({ dynamic: true }),
                })
                .setTimestamp();

            const mainRow1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_general')
                    .setLabel('一般設定')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('👥'),
                new ButtonBuilder()
                    .setCustomId('config_logging')
                    .setLabel('ログ設定')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📜'),
                new ButtonBuilder()
                    .setCustomId('config_leveling')
                    .setLabel('レベリング')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🏆')
            );

            const mainRow2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_automod')
                    .setLabel('オートモッド')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🛡️'),
                new ButtonBuilder()
                    .setCustomId('config_ai')
                    .setLabel('AI設定')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🤖'),
                new ButtonBuilder()
                    .setCustomId('config_status')
                    .setLabel('設定状況')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊')
            );

            return {
                embeds: [mainEmbed],
                components: [mainRow1, mainRow2],
                ephemeral: true,
            };
        };

        // --- 各設定画面の生成関数 ---

        // 一般設定
        const generateGeneralMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const embed = new EmbedBuilder()
                .setColor(CONFIG_CATEGORIES.general.color)
                .setAuthor({
                    name: CONFIG_CATEGORIES.general.name,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle(`${CONFIG_CATEGORIES.general.emoji} サーバー基本設定`)
                .setDescription(
                    '```\n' +
                    '新規メンバーの歓迎メッセージやBot用の自動ロールなど\n' +
                    'サーバーの基本的な機能に関する設定を行います\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '🏠 ウェルカムチャンネル',
                        value: settings.welcomeChannelId
                            ? `現在: <#${settings.welcomeChannelId}>\n> 新規メンバーが参加した際に歓迎メッセージを送信します`
                            : '`未設定`\n> 設定すると新規メンバーに歓迎メッセージを自動送信できます',
                        inline: false,
                    },
                    {
                        name: '👋 お別れチャンネル',
                        value: settings.goodbyeChannelId
                            ? `現在: <#${settings.goodbyeChannelId}>\n> メンバーが退出した際にお別れメッセージを送信します`
                            : '`未設定`\n> 設定するとメンバー退出時にお別れメッセージを自動送信できます',
                        inline: false,
                    },
                    {
                        name: '🤖 Bot自動ロール',
                        value: settings.botAutoroleId
                            ? `現在: <@&${settings.botAutoroleId}>\n> Botが参加した際に自動でこのロールを付与します`
                            : '`未設定`\n> 設定するとBot参加時に自動でロールを付与できます',
                        inline: false,
                    },
                    {
                        name: '📢 お知らせチャンネル',
                        value: settings.announcementChannelId
                            ? `現在: <#${settings.announcementChannelId}>\n> Botからの重要なお知らせを受信します`
                            : '`未設定`\n> 設定するとBotからのお知らせを受信できます',
                        inline: false,
                    },
                ])
                .setFooter({ text: 'ドロップダウンメニューから設定したい項目を選択してください' })
                .setTimestamp();

            const components = [];

            // ウェルカムチャンネル選択
            const welcomeChannelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('config_set_welcomeChannelId')
                .setPlaceholder('🏠 ウェルカムメッセージを送信するチャンネルを選択')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
            if (settings.welcomeChannelId) welcomeChannelMenu.setDefaultChannels([settings.welcomeChannelId]);
            components.push(new ActionRowBuilder().addComponents(welcomeChannelMenu));

            // お別れチャンネル選択
            const goodbyeChannelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('config_set_goodbyeChannelId')
                .setPlaceholder('👋 お別れメッセージを送信するチャンネルを選択')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
            if (settings.goodbyeChannelId) goodbyeChannelMenu.setDefaultChannels([settings.goodbyeChannelId]);
            components.push(new ActionRowBuilder().addComponents(goodbyeChannelMenu));

            // Bot自動ロール選択
            const botAutoroleMenu = new RoleSelectMenuBuilder()
                .setCustomId('config_set_botAutoroleId')
                .setPlaceholder('🤖 Bot参加時に付与するロールを選択');
            if (settings.botAutoroleId) botAutoroleMenu.setDefaultRoles([settings.botAutoroleId]);
            components.push(new ActionRowBuilder().addComponents(botAutoroleMenu));

            // お知らせチャンネル選択
            const announcementChannelMenu = new ChannelSelectMenuBuilder()
                .setCustomId('config_set_announcementChannelId')
                .setPlaceholder('📢 Botからのお知らせを受信するチャンネルを選択')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
            if (settings.announcementChannelId) announcementChannelMenu.setDefaultChannels([settings.announcementChannelId]);
            components.push(new ActionRowBuilder().addComponents(announcementChannelMenu));

            // 戻るボタンとクリアボタン
            const navigationRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙'),
                new ButtonBuilder()
                    .setCustomId('config_clear_general')
                    .setLabel('全てクリア')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🗑️')
            );
            components.push(navigationRow);

            return { embeds: [embed], components };
        };

        // ログ設定
        const generateLoggingMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const embed = new EmbedBuilder()
                .setColor(CONFIG_CATEGORIES.logging.color)
                .setAuthor({
                    name: CONFIG_CATEGORIES.logging.name,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle(`${CONFIG_CATEGORIES.logging.emoji} 監査ログ設定`)
                .setDescription(
                    '```\n' +
                    'サーバー内の重要な操作を記録する監査ログの\n' +
                    '送信先チャンネルを設定します\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '📋 監査ログチャンネル',
                        value: settings.auditLogChannel
                            ? `現在の設定: <#${settings.auditLogChannel}>\n\n` +
                              '**記録される内容:**\n' +
                              '```\n' +
                              '• メンバーの参加・退出\n' +
                              '• チャンネルの作成・削除・編集\n' +
                              '• ロールの変更\n' +
                              '• メッセージの削除・編集\n' +
                              '• その他の重要な操作\n' +
                              '```'
                            : '`未設定`\n\n' +
                              '```\n' +
                              '監査ログを有効にすると、サーバーの\n' +
                              '重要な操作履歴を確認できます\n' +
                              '```',
                        inline: false,
                    },
                ])
                .setFooter({ text: 'ドロップダウンメニューからチャンネルを選択してください' })
                .setTimestamp();

            const auditLogMenu = new ChannelSelectMenuBuilder()
                .setCustomId('config_set_auditLogChannel')
                .setPlaceholder('📋 監査ログを送信するチャンネルを選択')
                .addChannelTypes(ChannelType.GuildText);
            if (settings.auditLogChannel) auditLogMenu.setDefaultChannels([settings.auditLogChannel]);

            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙')
            );

            return {
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(auditLogMenu), backButton],
            };
        };

        // レベリング設定
        const generateLevelingMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const embed = new EmbedBuilder()
                .setColor(CONFIG_CATEGORIES.leveling.color)
                .setAuthor({
                    name: CONFIG_CATEGORIES.leveling.name,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle(`${CONFIG_CATEGORIES.leveling.emoji} レベルシステム設定`)
                .setDescription(
                    '```\n' +
                    'メンバーの活動レベルを追跡し、レベルアップ時に\n' +
                    '通知メッセージを送信する設定を行います\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '🎉 レベルアップ通知チャンネル',
                        value: settings.levelUpChannel
                            ? `現在の設定: <#${settings.levelUpChannel}>\n\n` +
                              '**通知される内容:**\n' +
                              '```\n' +
                              '• メンバーのレベルアップ情報\n' +
                              '• 獲得経験値と次のレベルまでの進捗\n' +
                              '• 特別な報酬ロールの付与通知\n' +
                              '```'
                            : '`未設定`\n\n' +
                              '```\n' +
                              'レベルアップ通知を有効にすると、\n' +
                              'メンバーのモチベーション向上に役立ちます\n' +
                              '```',
                        inline: false,
                    },
                ])
                .setFooter({ text: 'ドロップダウンメニューからチャンネルを選択してください' })
                .setTimestamp();

            const levelUpMenu = new ChannelSelectMenuBuilder()
                .setCustomId('config_set_levelUpChannel')
                .setPlaceholder('🎉 レベルアップ通知を送信するチャンネルを選択')
                .addChannelTypes(ChannelType.GuildText);
            if (settings.levelUpChannel) levelUpMenu.setDefaultChannels([settings.levelUpChannel]);

            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙')
            );

            return {
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(levelUpMenu), backButton],
            };
        };

        // オートモッド設定
        const generateAutoModMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const blockInvites = settings.automod?.blockInvites !== false;
            const ngWordsCount = settings.automod?.ngWords?.length || 0;

            const embed = new EmbedBuilder()
                .setColor(CONFIG_CATEGORIES.automod.color)
                .setAuthor({
                    name: CONFIG_CATEGORIES.automod.name,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle(`${CONFIG_CATEGORIES.automod.emoji} 自動管理設定`)
                .setDescription(
                    '```\n' +
                    '不適切な投稿を自動的に管理する機能です\n' +
                    'サーバーの安全性とコミュニティの質を向上させます\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '🚫 招待リンクブロック',
                        value: blockInvites
                            ? '```diff\n+ 有効\n```\n> 他サーバーへの招待リンクを自動削除します\n> ⚠️ 管理者権限を持つメンバーは除外されます'
                            : '```diff\n- 無効\n```\n> 招待リンクの投稿が許可されています\n> 🔓 全てのメンバーが招待リンクを投稿できます',
                        inline: true,
                    },
                    {
                        name: '📝 NGワード設定',
                        value: ngWordsCount > 0
                            ? `\`\`\`\n${ngWordsCount}件のNGワードが設定済み\n\`\`\`\n> 設定されたワードを含む投稿を自動削除\n> 🛡️ サーバーの雰囲気を守ります`
                            : '```\n未設定\n```\n> NGワードによる自動削除は無効です\n> 📝 ワードを設定して自動管理を開始できます',
                        inline: true,
                    },
                ])
                .setFooter({ text: 'ボタンを使用して各機能の設定を行ってください' })
                .setTimestamp();

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_automod_invites')
                    .setLabel(blockInvites ? '招待ブロックを無効化' : '招待ブロックを有効化')
                    .setStyle(blockInvites ? ButtonStyle.Secondary : ButtonStyle.Success)
                    .setEmoji(blockInvites ? '❌' : '✅'),
                new ButtonBuilder()
                    .setCustomId('config_automod_ngword')
                    .setLabel('NGワード設定')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📝')
            );

            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙')
            );

            return { embeds: [embed], components: [row1, backButton] };
        };

        // AI設定
        const generateAiMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const mentionReply = settings.ai?.mentionReplyEnabled !== false;
            const hasPersonality = !!settings.ai?.aiPersonalityPrompt;

            const embed = new EmbedBuilder()
                .setColor(CONFIG_CATEGORIES.ai.color)
                .setAuthor({
                    name: CONFIG_CATEGORIES.ai.name,
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle(`${CONFIG_CATEGORIES.ai.emoji} AI応答設定`)
                .setDescription(
                    '```\n' +
                    'Botにメンションした際にAIが自動で応答する\n' +
                    '機能の設定を行います\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '💬 メンション自動応答',
                        value: mentionReply
                            ? '```diff\n+ 有効\n```\n> Botへのメンションに自動でAIが応答します\n> 🤖 自然な会話が可能です'
                            : '```diff\n- 無効\n```\n> メンションへの自動応答は停止中です\n> 💤 手動でコマンドを使用する必要があります',
                        inline: true,
                    },
                    {
                        name: '🎭 AI性格設定',
                        value: hasPersonality
                            ? '```diff\n+ 設定済み\n```\n> カスタム性格が適用されています\n> ✨ 独自のキャラクターで応答します'
                            : '```diff\n- 未設定\n```\n> デフォルトの性格で応答します\n> 🎨 性格を設定してカスタマイズできます',
                        inline: true,
                    },
                ])
                .addFields([
                    {
                        name: 'ℹ️ 使用方法',
                        value:
                            '```\n' +
                            `1. Botをメンション (@${client.user.username})\n` +
                            '2. 質問やメッセージを送信\n' +
                            '3. AIが自動で応答します\n' +
                            '```',
                        inline: false,
                    },
                ])
                .setFooter({ text: 'ボタンを使用してAI機能の設定を行ってください' })
                .setTimestamp();

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_ai_mention')
                    .setLabel(mentionReply ? 'メンション応答を無効化' : 'メンション応答を有効化')
                    .setStyle(mentionReply ? ButtonStyle.Secondary : ButtonStyle.Success)
                    .setEmoji(mentionReply ? '❌' : '✅'),
                new ButtonBuilder()
                    .setCustomId('config_ai_personality')
                    .setLabel('AI性格を設定')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🎭')
            );

            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙')
            );

            return { embeds: [embed], components: [row1, backButton] };
        };

        // 設定状況表示
        const generateStatusMenu = async () => {
            const settings = await getSettings(db, guild.id);

            const getStatusIcon = (value) => (value ? '✅' : '❌');
            const getChannelDisplay = (channelId) => (channelId ? `<#${channelId}>` : '`未設定`');
            const getRoleDisplay = (roleId) => (roleId ? `<@&${roleId}>` : '`未設定`');

            const completionRate = calculateCompletionRate(settings);

            const embed = new EmbedBuilder()
                .setColor(COLORS.WARNING)
                .setAuthor({
                    name: '設定状況確認',
                    iconURL: guild.iconURL({ dynamic: true }),
                })
                .setTitle('📊 現在の設定状況')
                .setDescription(
                    '```\n' +
                    'サーバーの全設定項目の現在の状況を確認できます\n' +
                    '未設定の項目がある場合は各設定画面から設定してください\n' +
                    '```'
                )
                .addFields([
                    {
                        name: '👥 一般設定',
                        value:
                            `${getStatusIcon(settings.welcomeChannelId)} **ウェルカムCH:** ${getChannelDisplay(settings.welcomeChannelId)}\n` +
                            `${getStatusIcon(settings.goodbyeChannelId)} **お別れCH:** ${getChannelDisplay(settings.goodbyeChannelId)}\n` +
                            `${getStatusIcon(settings.botAutoroleId)} **Bot自動ロール:** ${getRoleDisplay(settings.botAutoroleId)}\n` +
                            `${getStatusIcon(settings.announcementChannelId)} **お知らせCH:** ${getChannelDisplay(settings.announcementChannelId)}`,
                        inline: false,
                    },
                    {
                        name: '📜 ログ設定',
                        value: `${getStatusIcon(settings.auditLogChannel)} **監査ログCH:** ${getChannelDisplay(settings.auditLogChannel)}`,
                        inline: true,
                    },
                    {
                        name: '🏆 レベリング',
                        value: `${getStatusIcon(settings.levelUpChannel)} **レベルアップCH:** ${getChannelDisplay(settings.levelUpChannel)}`,
                        inline: true,
                    },
                    {
                        name: '🛡️ オートモッド',
                        value:
                            `${getStatusIcon(settings.automod?.blockInvites !== false)} **招待ブロック:** ${settings.automod?.blockInvites !== false ? '`有効`' : '`無効`'}\n` +
                            `${getStatusIcon(settings.automod?.ngWords?.length)} **NGワード:** ${settings.automod?.ngWords?.length ? `\`${settings.automod.ngWords.length}件\`` : '`未設定`'}`,
                        inline: false,
                    },
                    {
                        name: '🤖 AI設定',
                        value:
                            `${getStatusIcon(settings.ai?.mentionReplyEnabled !== false)} **メンション応答:** ${settings.ai?.mentionReplyEnabled !== false ? '`有効`' : '`無効`'}\n` +
                            `${getStatusIcon(settings.ai?.aiPersonalityPrompt)} **AI性格:** ${settings.ai?.aiPersonalityPrompt ? '`設定済み`' : '`未設定`'}`,
                        inline: false,
                    },
                ])
                .addFields([
                    {
                        name: '📈 設定完了率',
                        value: `\`\`\`\n${'█'.repeat(Math.floor(completionRate / 10))}${'░'.repeat(10 - Math.floor(completionRate / 10))} ${completionRate}%\n\`\`\``,
                        inline: false,
                    },
                ])
                .setFooter({
                    text: `最終更新: ${new Date().toLocaleString('ja-JP')} • ${user.username}`,
                    iconURL: user.displayAvatarURL({ dynamic: true }),
                })
                .setTimestamp();

            const backButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('config_back_main')
                    .setLabel('メインメニューに戻る')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🔙'),
                new ButtonBuilder()
                    .setCustomId('config_export_settings')
                    .setLabel('設定をエクスポート')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('📤')
            );

            return { embeds: [embed], components: [backButton] };
        };

        try {
            // --- 初期表示 ---
            const reply = await interaction.reply(await generateMainMenu());

            // --- インタラクションコレクター ---
            const collector = reply.createMessageComponentCollector({
                filter: (i) => i.user.id === user.id,
                time: 300000, // 5分
            });

            collector.on('collect', async (i) => {
                try {
                    const [type, action, ...args] = i.customId.split('_');

                    // --- ページ切り替え ---
                    if (action === 'back' && args[0] === 'main') {
                        await i.update(await generateMainMenu());
                        return;
                    }

                    const pageGenerators = {
                        general: generateGeneralMenu,
                        logging: generateLoggingMenu,
                        leveling: generateLevelingMenu,
                        automod: generateAutoModMenu,
                        ai: generateAiMenu,
                        status: generateStatusMenu,
                    };

                    if (pageGenerators[action]) {
                        await i.update(await pageGenerators[action]());
                        return;
                    }

                    // --- 設定保存処理 ---
                    const settingsRef = doc(db, 'guild_settings', guild.id);

                    // セレクトメニューによる設定
                    if (action === 'set') {
                        const key = args[0];
                        const value = i.values && i.values.length > 0 ? i.values[0] : null;

                        await i.deferUpdate();
                        const result = await updateSettings(db, guild.id, { [key]: value });

                        if (result.success) {
                            // フィードバックメッセージを送信
                            await interaction.followUp({
                                embeds: [
                                    new EmbedBuilder()
                                        .setColor(COLORS.SUCCESS)
                                        .setDescription(`✅ **${i.component.placeholder}** を設定しました。`),
                                ],
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));
                        } else {
                            await interaction.followUp({
                                embeds: [
                                    new EmbedBuilder()
                                        .setColor(COLORS.DANGER)
                                        .setDescription('❌ 設定の保存に失敗しました。もう一度お試しください。'),
                                ],
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
                        }

                        // 親メニューを再生成
                        const parentMenuAction = i.message.components[0].components[0].customId.split('_')[1];
                        if (pageGenerators[parentMenuAction]) {
                            await interaction.editReply(await pageGenerators[parentMenuAction]());
                        }
                        return;
                    }

                    // クリアボタン処理
                    if (action === 'clear' && args[0] === 'general') {
                        await i.deferUpdate();
                        await updateSettings(db, guild.id, {
                            welcomeChannelId: null,
                            goodbyeChannelId: null,
                            botAutoroleId: null,
                            announcementChannelId: null,
                        });

                        await interaction.followUp({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(COLORS.WARNING)
                                    .setDescription('🗑️ 一般設定を全てクリアしました。'),
                            ],
                            ephemeral: true,
                        }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));

                        await interaction.editReply(await generateGeneralMenu());
                        return;
                    }

                    // 設定エクスポート
                    if (action === 'export' && args[0] === 'settings') {
                        await i.deferUpdate();
                        const settings = await getSettings(db, guild.id);
                        const settingsJson = JSON.stringify(settings, null, 2);

                        await interaction.followUp({
                            content: '📤 現在の設定をエクスポートしました:',
                            files: [
                                {
                                    attachment: Buffer.from(settingsJson),
                                    name: `${guild.name}_settings_${Date.now()}.json`,
                                },
                            ],
                            ephemeral: true,
                        });
                        return;
                    }

                    // トグルボタンによる設定
                    const toggleActions = {
                        config_automod_invites: 'automod.blockInvites',
                        config_ai_mention: 'ai.mentionReplyEnabled',
                    };

                    if (toggleActions[i.customId]) {
                        await i.deferUpdate();
                        const settings = await getSettings(db, guild.id);
                        const path = toggleActions[i.customId].split('.');
                        const currentVal = path.reduce((o, k) => o && o[k], settings);

                        const update = {};
                        let current = update;
                        for (let j = 0; j < path.length - 1; j++) {
                            current[path[j]] = {};
                            current = current[path[j]];
                        }
                        current[path[path.length - 1]] = !(currentVal !== false);

                        await updateSettings(db, guild.id, update);

                        // 成功メッセージ
                        const newState = !(currentVal !== false);
                        await interaction.followUp({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(newState ? COLORS.SUCCESS : COLORS.SECONDARY)
                                    .setDescription(`${newState ? '✅' : '❌'} 設定を${newState ? '有効' : '無効'}にしました。`),
                            ],
                            ephemeral: true,
                        }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));

                        await interaction.editReply(await pageGenerators[action]());
                        return;
                    }

                    // モーダル表示
                    if (i.customId === 'config_automod_ngword' || i.customId === 'config_ai_personality') {
                        const settings = await getSettings(db, guild.id);
                        let modal;

                        if (i.customId === 'config_automod_ngword') {
                            modal = new ModalBuilder()
                                .setCustomId('config_modal_ngword')
                                .setTitle('🚫 NGワード設定');

                            const ngwordInput = new TextInputBuilder()
                                .setCustomId('ngwords')
                                .setLabel('NGワードをカンマ区切りで入力してください')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('例: バカ, アホ, 死ね\n※一行に一つずつでも入力可能です')
                                .setRequired(false)
                                .setMaxLength(2000)
                                .setValue((settings.automod?.ngWords || []).join(', '));

                            modal.addComponents(new ActionRowBuilder().addComponents(ngwordInput));
                        } else {
                            modal = new ModalBuilder()
                                .setCustomId('config_modal_personality')
                                .setTitle('🎭 AI性格設定');

                            const personalityInput = new TextInputBuilder()
                                .setCustomId('personality')
                                .setLabel('AIへの指示(プロンプト)を入力してください')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('例: あなたは猫のAIです。語尾に「にゃん」をつけて、優しく丁寧に答えてください。')
                                .setRequired(false)
                                .setMaxLength(1000)
                                .setValue(settings.ai?.aiPersonalityPrompt || '');

                            modal.addComponents(new ActionRowBuilder().addComponents(personalityInput));
                        }

                        await i.showModal(modal);

                        // モーダルの応答を待つ
                        try {
                            const submitted = await i.awaitModalSubmit({
                                time: 180000,
                                filter: (m) => m.user.id === user.id && m.customId === modal.data.custom_id,
                            });

                            await submitted.deferUpdate();

                            if (submitted.customId === 'config_modal_ngword') {
                                const ngwordsText = submitted.fields.getTextInputValue('ngwords');
                                const ngwords = ngwordsText
                                    .split(/[,\n]/)
                                    .map((w) => w.trim())
                                    .filter(Boolean);

                                await updateSettings(db, guild.id, {
                                    automod: { ...settings.automod, ngWords: ngwords },
                                });

                                await interaction.followUp({
                                    embeds: [
                                        new EmbedBuilder()
                                            .setColor(COLORS.SUCCESS)
                                            .setDescription(`✅ NGワードを${ngwords.length}件設定しました。`),
                                    ],
                                    ephemeral: true,
                                }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
                            } else if (submitted.customId === 'config_modal_personality') {
                                const personality = submitted.fields.getTextInputValue('personality');
                                await updateSettings(db, guild.id, {
                                    ai: { ...settings.ai, aiPersonalityPrompt: personality },
                                });

                                await interaction.followUp({
                                    embeds: [
                                        new EmbedBuilder()
                                            .setColor(COLORS.SUCCESS)
                                            .setDescription(
                                                personality
                                                    ? '✅ AIの性格を設定しました。次回のメンションから反映されます。'
                                                    : '✅ AIの性格をデフォルトにリセットしました。'
                                            ),
                                    ],
                                    ephemeral: true,
                                }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
                            }

                            await interaction.editReply(await pageGenerators[action]());
                        } catch (modalError) {
                            if (modalError.code !== 'InteractionCollectorError') {
                                console.error('⚠️ モーダル応答エラー:', modalError);
                            }
                            // タイムアウト時は何もしない(ユーザーがモーダルをキャンセルした)
                        }
                        return;
                    }
                } catch (error) {
                    console.error('❌ インタラクション処理エラー:', error);
                    try {
                        const errorEmbed = new EmbedBuilder()
                            .setColor(COLORS.DANGER)
                            .setTitle('❌ エラーが発生しました')
                            .setDescription('設定の処理中にエラーが発生しました。もう一度お試しください。')
                            .setFooter({ text: 'エラーが続く場合は管理者にお問い合わせください' })
                            .setTimestamp();

                        if (!i.replied && !i.deferred) {
                            await i.reply({
                                embeds: [errorEmbed],
                                ephemeral: true,
                            });
                        } else {
                            await interaction.followUp({
                                embeds: [errorEmbed],
                                ephemeral: true,
                            });
                        }
                    } catch (followUpError) {
                        console.error('❌ エラーレスポンス送信失敗:', followUpError);
                    }
                }
            });

            collector.on('end', async (collected, reason) => {
                try {
                    const endEmbed = new EmbedBuilder()
                        .setColor(COLORS.SECONDARY)
                        .setAuthor({
                            name: 'セッション終了',
                            iconURL: guild.iconURL({ dynamic: true }),
                        })
                        .setTitle('⏰ 設定パネル終了')
                        .setDescription(
                            reason === 'time'
                                ? '```\n' +
                                  '操作がなかったため、設定パネルを終了しました\n' +
                                  '再度設定を行う場合は /config コマンドを実行してください\n' +
                                  '```'
                                : '```\n' +
                                  '設定パネルを終了しました\n' +
                                  '```'
                        )
                        .addFields([
                            {
                                name: 'ℹ️ 設定について',
                                value:
                                    '• 設定した内容は自動保存されています\n' +
                                    '• いつでも `/config` で再設定可能です\n' +
                                    '• 不明な点があれば管理者にお尋ねください',
                                inline: false,
                            },
                            {
                                name: '📊 統計情報',
                                value: `• インタラクション数: ${collected.size}回\n• セッション時間: ${Math.floor((Date.now() - interaction.createdTimestamp) / 1000)}秒`,
                                inline: false,
                            },
                        ])
                        .setFooter({
                            text: 'ご利用ありがとうございました',
                            iconURL: user.displayAvatarURL({ dynamic: true }),
                        })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [endEmbed], components: [] });
                } catch (error) {
                    if (error.code !== 10008 && error.code !== 10062) {
                        // Unknown Message / Unknown Interaction
                        console.error('❌ 設定パネル終了時エラー:', error);
                    }
                }
            });
        } catch (error) {
            console.error('❌ 設定パネル初期化エラー:', error);

            const initErrorEmbed = new EmbedBuilder()
                .setColor(COLORS.DANGER)
                .setTitle('❌ 初期化エラー')
                .setDescription('設定パネルの初期化中にエラーが発生しました。')
                .addFields([
                    {
                        name: '考えられる原因',
                        value:
                            '• データベース接続の問題\n' +
                            '• 権限の不足\n' +
                            '• 一時的なサーバーエラー',
                        inline: false,
                    },
                    {
                        name: '対処方法',
                        value:
                            '• 少し時間をおいて再実行してください\n' +
                            '• 問題が続く場合は管理者にご連絡ください',
                        inline: false,
                    },
                ])
                .setFooter({ text: 'エラーコード: INIT_FAILED' })
                .setTimestamp();

            if (!interaction.replied) {
                await interaction.reply({
                    embeds: [initErrorEmbed],
                    ephemeral: true,
                });
            }
        }
    },
};

// 設定完了率を計算するヘルパー関数
function calculateCompletionRate(settings) {
    const totalSettings = 10; // 総設定項目数
    let completedSettings = 0;

    if (settings.welcomeChannelId) completedSettings++;
    if (settings.goodbyeChannelId) completedSettings++;
    if (settings.botAutoroleId) completedSettings++;
    if (settings.announcementChannelId) completedSettings++;
    if (settings.auditLogChannel) completedSettings++;
    if (settings.levelUpChannel) completedSettings++;
    if (settings.automod?.blockInvites !== undefined) completedSettings++;
    if (settings.automod?.ngWords?.length) completedSettings++;
    if (settings.ai?.mentionReplyEnabled !== undefined) completedSettings++;
    if (settings.ai?.aiPersonalityPrompt) completedSettings++;

    return Math.round((completedSettings / totalSettings) * 100);
}