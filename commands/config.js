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
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');

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

// カスタム SettingBuilderクラス
class SettingBuilder extends ContainerBuilder {
    addText(content) {
        return this.addTextDisplayComponents(new TextDisplayBuilder({ content }));
    }

    addDropdown(custom_id, options, defaultValue) {
        return this.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(custom_id)
                    .addOptions(
                        Object.entries(options).slice(0, 25).map(([key, value]) => {
                            const option = new StringSelectMenuOptionBuilder()
                                .setLabel(value)
                                .setValue(key);
                            if (key == defaultValue) option.setDefault(true);
                            return option;
                        })
                    )
            )
        );
    }

    addChannelSelect(custom_id, placeholder, defaultChannels = []) {
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(custom_id)
            .setPlaceholder(placeholder)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
        
        if (defaultChannels.length > 0) {
            menu.setDefaultChannels(defaultChannels);
        }
        
        return this.addActionRowComponents(
            new ActionRowBuilder().addComponents(menu)
        );
    }

    addRoleSelect(custom_id, placeholder, defaultRoles = []) {
        const menu = new RoleSelectMenuBuilder()
            .setCustomId(custom_id)
            .setPlaceholder(placeholder);
        
        if (defaultRoles.length > 0) {
            menu.setDefaultRoles(defaultRoles);
        }
        
        return this.addActionRowComponents(
            new ActionRowBuilder().addComponents(menu)
        );
    }

    addToggle(custom_id, text, value) {
        return this.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder({ content: text })
                )
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`${custom_id}:${value}`)
                        .setLabel(!value ? 'OFF' : 'ON')
                        .setStyle(!value ? ButtonStyle.Secondary : ButtonStyle.Success)
                )
        );
    }

    addButtons(buttons) {
        return this.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                ...buttons.map((btn) => {
                    const button = new ButtonBuilder()
                        .setCustomId(btn.id)
                        .setLabel(btn.label)
                        .setStyle(btn.style);
                    if (btn.emoji) button.setEmoji(btn.emoji);
                    return button;
                })
            )
        );
    }

    addSection(content, options = {}) {
        const { prefix = '### ', spacing = 1, addSeparator = true } = options;

        this.addTextDisplayComponents(new TextDisplayBuilder({ content: `${prefix}${content}` }));

        if (addSeparator) this.addSeparatorComponents({ spacing });

        return this;
    }

    addSeparator(spacing = 1) {
        return this.addSeparatorComponents({ spacing });
    }

    // ✅ 修正: toComponents メソッドを追加
    toComponents() {
        return [this];
    }
}

// Firestoreから設定を取得するヘルパー関数
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

// 設定完了率を計算する関数
function calculateCompletionRate(settings) {
    const totalSettings = 10;
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

            const container = new SettingBuilder()
                .addText(`# ⚙️ ${guild.name} 設定パネル`)
                .addSeparator()
                .addText(
                    '```ansi\n' +
                        '\u001b[1;36m🎯 設定したい項目を下のボタンから選択してください\n' +
                        '\u001b[1;32m💾 全ての設定は自動的に保存されます\n' +
                        '\u001b[1;33m⏰ 操作は5分間有効です\n' +
                        '```'
                )
                .addSeparator()
                .addSection('📊 設定完了率', { prefix: '## ' })
                .addText(
                    `\`\`\`\n${'█'.repeat(Math.floor(completionRate / 10))}${'░'.repeat(
                        10 - Math.floor(completionRate / 10)
                    )} ${completionRate}%\n\`\`\``
                )
                .addSeparator()
                .addSection('カテゴリーを選択', { prefix: '## ' });

            // カテゴリーボタン(2行に分割)
            container.addButtons([
                { id: 'config_general', label: '一般設定', style: ButtonStyle.Primary, emoji: '👥' },
                { id: 'config_logging', label: 'ログ設定', style: ButtonStyle.Secondary, emoji: '📜' },
                { id: 'config_leveling', label: 'レベリング', style: ButtonStyle.Success, emoji: '🏆' },
            ]);

            container.addButtons([
                { id: 'config_automod', label: 'オートモッド', style: ButtonStyle.Danger, emoji: '🛡️' },
                { id: 'config_ai', label: 'AI設定', style: ButtonStyle.Primary, emoji: '🤖' },
                { id: 'config_status', label: '設定状況', style: ButtonStyle.Secondary, emoji: '📊' },
            ]);

            return {
                content: `📋 **${guild.name}の設定センター**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- 一般設定 ---
        const generateGeneralMenu = async () => {
            const settings = await getSettings(db, guild.id);

            const container = new SettingBuilder()
                .addText(`# ${CONFIG_CATEGORIES.general.emoji} ${CONFIG_CATEGORIES.general.name}`)
                .addSeparator()
                .addText(
                    '```\n' +
                        '新規メンバーの歓迎メッセージやBot用の自動ロールなど\n' +
                        'サーバーの基本的な機能に関する設定を行います\n' +
                        '```'
                )
                .addSeparator()
                .addSection('🏠 ウェルカムチャンネル', { prefix: '### ' })
                .addText(
                    settings.welcomeChannelId
                        ? `現在: <#${settings.welcomeChannelId}>\n> 新規メンバーが参加した際に歓迎メッセージを送信します`
                        : '`未設定`\n> 設定すると新規メンバーに歓迎メッセージを自動送信できます'
                );

            container.addChannelSelect(
                'config_set_welcomeChannelId',
                '🏠 ウェルカムメッセージを送信するチャンネルを選択',
                settings.welcomeChannelId ? [settings.welcomeChannelId] : []
            );

            container
                .addSeparator()
                .addSection('👋 お別れチャンネル', { prefix: '### ' })
                .addText(
                    settings.goodbyeChannelId
                        ? `現在: <#${settings.goodbyeChannelId}>\n> メンバーが退出した際にお別れメッセージを送信します`
                        : '`未設定`\n> 設定するとメンバー退出時にお別れメッセージを自動送信できます'
                );

            container.addChannelSelect(
                'config_set_goodbyeChannelId',
                '👋 お別れメッセージを送信するチャンネルを選択',
                settings.goodbyeChannelId ? [settings.goodbyeChannelId] : []
            );

            container
                .addSeparator()
                .addSection('🤖 Bot自動ロール', { prefix: '### ' })
                .addText(
                    settings.botAutoroleId
                        ? `現在: <@&${settings.botAutoroleId}>\n> Botが参加した際に自動でこのロールを付与します`
                        : '`未設定`\n> 設定するとBot参加時に自動でロールを付与できます'
                );

            container.addRoleSelect(
                'config_set_botAutoroleId',
                '🤖 Bot参加時に付与するロールを選択',
                settings.botAutoroleId ? [settings.botAutoroleId] : []
            );

            container
                .addSeparator()
                .addSection('📢 お知らせチャンネル', { prefix: '### ' })
                .addText(
                    settings.announcementChannelId
                        ? `現在: <#${settings.announcementChannelId}>\n> Botからの重要なお知らせを受信します`
                        : '`未設定`\n> 設定するとBotからのお知らせを受信できます'
                );

            container.addChannelSelect(
                'config_set_announcementChannelId',
                '📢 Botからのお知らせを受信するチャンネルを選択',
                settings.announcementChannelId ? [settings.announcementChannelId] : []
            );

            container.addSeparator().addButtons([
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
                { id: 'config_clear_general', label: '全てクリア', style: ButtonStyle.Danger, emoji: '🗑️' },
            ]);

            return {
                content: `${CONFIG_CATEGORIES.general.emoji} **${CONFIG_CATEGORIES.general.name}**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- ログ設定 ---
        const generateLoggingMenu = async () => {
            const settings = await getSettings(db, guild.id);

            const container = new SettingBuilder()
                .addText(`# ${CONFIG_CATEGORIES.logging.emoji} ${CONFIG_CATEGORIES.logging.name}`)
                .addSeparator()
                .addText(
                    '```\n' +
                        'サーバー内の重要な操作を記録する監査ログの\n' +
                        '送信先チャンネルを設定します\n' +
                        '```'
                )
                .addSeparator()
                .addSection('📋 監査ログチャンネル', { prefix: '### ' })
                .addText(
                    settings.auditLogChannel
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
                              '```'
                );

            container.addChannelSelect(
                'config_set_auditLogChannel',
                '📋 監査ログを送信するチャンネルを選択',
                settings.auditLogChannel ? [settings.auditLogChannel] : []
            );

            container.addSeparator().addButtons([
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
            ]);

            return {
                content: `${CONFIG_CATEGORIES.logging.emoji} **${CONFIG_CATEGORIES.logging.name}**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- レベリング設定 ---
        const generateLevelingMenu = async () => {
            const settings = await getSettings(db, guild.id);

            const container = new SettingBuilder()
                .addText(`# ${CONFIG_CATEGORIES.leveling.emoji} ${CONFIG_CATEGORIES.leveling.name}`)
                .addSeparator()
                .addText(
                    '```\n' +
                        'メンバーの活動レベルを追跡し、レベルアップ時に\n' +
                        '通知メッセージを送信する設定を行います\n' +
                        '```'
                )
                .addSeparator()
                .addSection('🎉 レベルアップ通知チャンネル', { prefix: '### ' })
                .addText(
                    settings.levelUpChannel
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
                              '```'
                );

            container.addChannelSelect(
                'config_set_levelUpChannel',
                '🎉 レベルアップ通知を送信するチャンネルを選択',
                settings.levelUpChannel ? [settings.levelUpChannel] : []
            );

            container.addSeparator().addButtons([
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
            ]);

            return {
                content: `${CONFIG_CATEGORIES.leveling.emoji} **${CONFIG_CATEGORIES.leveling.name}**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- オートモッド設定 ---
        const generateAutoModMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const blockInvites = settings.automod?.blockInvites !== false;
            const ngWordsCount = settings.automod?.ngWords?.length || 0;

            const container = new SettingBuilder()
                .addText(`# ${CONFIG_CATEGORIES.automod.emoji} ${CONFIG_CATEGORIES.automod.name}`)
                .addSeparator()
                .addText(
                    '```\n' +
                        '不適切な投稿を自動的に管理する機能です\n' +
                        'サーバーの安全性とコミュニティの質を向上させます\n' +
                        '```'
                )
                .addSeparator()
                .addSection('🚫 招待リンクブロック', { prefix: '### ' });

            container.addToggle(
                'config_automod_invites',
                blockInvites
                    ? '```diff\n+ 有効\n```\n> 他サーバーへの招待リンクを自動削除します\n> ⚠️ 管理者権限を持つメンバーは除外されます'
                    : '```diff\n- 無効\n```\n> 招待リンクの投稿が許可されています\n> 🔓 全てのメンバーが招待リンクを投稿できます',
                blockInvites
            );

            container.addSeparator().addSection('📝 NGワード設定', { prefix: '### ' });

            container.addToggle(
                'config_automod_ngword_view',
                ngWordsCount > 0
                    ? `\`\`\`\n${ngWordsCount}件のNGワードが設定済み\n\`\`\`\n> 設定されたワードを含む投稿を自動削除\n> 🛡️ サーバーの雰囲気を守ります`
                    : '```\n未設定\n```\n> NGワードによる自動削除は無効です\n> 📝 ワードを設定して自動管理を開始できます',
                ngWordsCount > 0
            );

            container.addSeparator().addButtons([
                {
                    id: 'config_automod_ngword',
                    label: 'NGワード編集',
                    style: ButtonStyle.Primary,
                    emoji: '📝',
                },
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
            ]);

            return {
                content: `${CONFIG_CATEGORIES.automod.emoji} **${CONFIG_CATEGORIES.automod.name}**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- AI設定 ---
        const generateAiMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const mentionReply = settings.ai?.mentionReplyEnabled !== false;
            const hasPersonality = !!settings.ai?.aiPersonalityPrompt;

            const container = new SettingBuilder()
                .addText(`# ${CONFIG_CATEGORIES.ai.emoji} ${CONFIG_CATEGORIES.ai.name}`)
                .addSeparator()
                .addText(
                    '```\n' +
                        'Botにメンションした際にAIが自動で応答する\n' +
                        '機能の設定を行います\n' +
                        '```'
                )
                .addSeparator()
                .addSection('💬 メンション自動応答', { prefix: '### ' });

            container.addToggle(
                'config_ai_mention',
                mentionReply
                    ? '```diff\n+ 有効\n```\n> Botへのメンションに自動でAIが応答します\n> 🤖 自然な会話が可能です'
                    : '```diff\n- 無効\n```\n> メンションへの自動応答は停止中です\n> 💤 手動でコマンドを使用する必要があります',
                mentionReply
            );

            container.addSeparator().addSection('🎭 AI性格設定', { prefix: '### ' });

            container.addToggle(
                'config_ai_personality_view',
                hasPersonality
                    ? '```diff\n+ 設定済み\n```\n> カスタム性格が適用されています\n> ✨ 独自のキャラクターで応答します'
                    : '```diff\n- 未設定\n```\n> デフォルトの性格で応答します\n> 🎨 性格を設定してカスタマイズできます',
                hasPersonality
            );

            container
                .addSeparator()
                .addSection('ℹ️ 使用方法', { prefix: '### ' })
                .addText(
                    '```\n' +
                        `1. Botをメンション (@${client.user.username})\n` +
                        '2. 質問やメッセージを送信\n' +
                        '3. AIが自動で応答します\n' +
                        '```'
                )
                .addSeparator();

            container.addButtons([
                {
                    id: 'config_ai_personality',
                    label: 'AI性格を編集',
                    style: ButtonStyle.Primary,
                    emoji: '🎭',
                },
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
            ]);

            return {
                content: `${CONFIG_CATEGORIES.ai.emoji} **${CONFIG_CATEGORIES.ai.name}**`,
                components: container.toComponents(),
                ephemeral: true,
            };
        };

        // --- 設定状況表示 ---
        const generateStatusMenu = async () => {
            const settings = await getSettings(db, guild.id);
            const getStatusIcon = (value) => (value ? '✅' : '❌');
            const getChannelDisplay = (channelId) => (channelId ? `<#${channelId}>` : '`未設定`');
            const getRoleDisplay = (roleId) => (roleId ? `<@&${roleId}>` : '`未設定`');
            const completionRate = calculateCompletionRate(settings);

            const container = new SettingBuilder()
                .addText('# 📊 現在の設定状況')
                .addSeparator()
                .addText(
                    '```\n' +
                        'サーバーの全設定項目の現在の状況を確認できます\n' +
                        '未設定の項目がある場合は各設定画面から設定してください\n' +
                        '```'
                )
                .addSeparator()
                .addSection('📊 設定完了率', { prefix: '## ' })
                .addText(
                    `\`\`\`\n${'█'.repeat(Math.floor(completionRate / 10))}${'░'.repeat(
                        10 - Math.floor(completionRate / 10)
                    )} ${completionRate}%\n\`\`\``
                )
                .addSeparator()
                .addSection('👥 一般設定', { prefix: '## ' })
                .addText(
                    `${getStatusIcon(settings.welcomeChannelId)} **ウェルカムCH:** ${getChannelDisplay(
                        settings.welcomeChannelId
                    )}\n` +
                        `${getStatusIcon(settings.goodbyeChannelId)} **お別れCH:** ${getChannelDisplay(
                            settings.goodbyeChannelId
                        )}\n` +
                        `${getStatusIcon(settings.botAutoroleId)} **Bot自動ロール:** ${getRoleDisplay(
                            settings.botAutoroleId
                        )}\n` +
                        `${getStatusIcon(settings.announcementChannelId)} **お知らせCH:** ${getChannelDisplay(
                            settings.announcementChannelId
                        )}`
                )
                .addSeparator()
                .addSection('📜 ログ設定', { prefix: '## ' })
                .addText(
                    `${getStatusIcon(settings.auditLogChannel)} **監査ログCH:** ${getChannelDisplay(
                        settings.auditLogChannel
                    )}`
                )
                .addSeparator()
                .addSection('🏆 レベリング', { prefix: '## ' })
                .addText(
                    `${getStatusIcon(settings.levelUpChannel)} **レベルアップCH:** ${getChannelDisplay(
                        settings.levelUpChannel
                    )}`
                )
                .addSeparator()
                .addSection('🛡️ オートモッド', { prefix: '## ' })
                .addText(
                    `${getStatusIcon(settings.automod?.blockInvites !== false)} **招待ブロック:** ${
                        settings.automod?.blockInvites !== false ? '`✅ 有効`' : '`❌ 無効`'
                    }\n` +
                        `${getStatusIcon(settings.automod?.ngWords?.length)} **NGワード:** ${
                            settings.automod?.ngWords?.length ? `\`${settings.automod.ngWords.length}件\`` : '`未設定`'
                        }`
                )
                .addSeparator()
                .addSection('🤖 AI設定', { prefix: '## ' })
                .addText(
                    `${getStatusIcon(settings.ai?.mentionReplyEnabled !== false)} **メンション応答:** ${
                        settings.ai?.mentionReplyEnabled !== false ? '`✅ 有効`' : '`❌ 無効`'
                    }\n` +
                        `${getStatusIcon(settings.ai?.aiPersonalityPrompt)} **AI性格:** ${
                            settings.ai?.aiPersonalityPrompt ? '`✅ 設定済み`' : '`未設定`'
                        }`
                )
                .addSeparator();

            container.addButtons([
                { id: 'config_back_main', label: 'メインメニューに戻る', style: ButtonStyle.Secondary, emoji: '🔙' },
                { id: 'config_export_settings', label: '設定をエクスポート', style: ButtonStyle.Primary, emoji: '📤' },
            ]);

            return {
                content: `📊 **設定状況確認** - 最終更新: ${new Date().toLocaleString('ja-JP')}`,
                components: container.toComponents(),
                ephemeral: true,
            };
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
                                content: `✅ **${i.component.data.placeholder}** を設定しました。`,
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));
                        } else {
                            await interaction.followUp({
                                content: '❌ 設定の保存に失敗しました。もう一度お試しください。',
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));
                        }

                        // 親メニューを再生成
                        const parentMenuAction = i.message.content.includes('一般設定')
                            ? 'general'
                            : i.message.content.includes('ログ設定')
                            ? 'logging'
                            : i.message.content.includes('レベリング')
                            ? 'leveling'
                            : null;

                        if (parentMenuAction && pageGenerators[parentMenuAction]) {
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
                            content: '🗑️ 一般設定を全てクリアしました。',
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
                    if (i.customId.startsWith('config_automod_invites:') || i.customId.startsWith('config_ai_mention:')) {
                        await i.deferUpdate();
                        const settings = await getSettings(db, guild.id);

                        if (i.customId.startsWith('config_automod_invites:')) {
                            const currentVal = settings.automod?.blockInvites !== false;
                            await updateSettings(db, guild.id, {
                                automod: { ...settings.automod, blockInvites: !currentVal },
                            });

                            await interaction.followUp({
                                content: `${!currentVal ? '✅' : '❌'} 招待ブロックを${!currentVal ? '有効' : '無効'}にしました。`,
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));

                            await interaction.editReply(await generateAutoModMenu());
                        } else if (i.customId.startsWith('config_ai_mention:')) {
                            const currentVal = settings.ai?.mentionReplyEnabled !== false;
                            await updateSettings(db, guild.id, {
                                ai: { ...settings.ai, mentionReplyEnabled: !currentVal },
                            });

                            await interaction.followUp({
                                content: `${!currentVal ? '✅' : '❌'} メンション応答を${!currentVal ? '有効' : '無効'}にしました。`,
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 3000));

                            await interaction.editReply(await generateAiMenu());
                        }
                        return;
                    }

                    // モーダル表示(NGワード設定)
                    if (i.customId === 'config_automod_ngword') {
                        const settings = await getSettings(db, guild.id);
                        const modal = new ModalBuilder()
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
                        await i.showModal(modal);

                        // モーダルの応答を待つ
                        try {
                            const submitted = await i.awaitModalSubmit({
                                time: 180000,
                                filter: (m) => m.user.id === user.id && m.customId === 'config_modal_ngword',
                            });

                            await submitted.deferUpdate();

                            const ngwordsText = submitted.fields.getTextInputValue('ngwords');
                            const ngwords = ngwordsText
                                .split(/[,\n]/)
                                .map((w) => w.trim())
                                .filter(Boolean);

                            await updateSettings(db, guild.id, {
                                automod: { ...settings.automod, ngWords: ngwords },
                            });

                            await interaction.followUp({
                                content: `✅ NGワードを${ngwords.length}件設定しました。`,
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));

                            await interaction.editReply(await generateAutoModMenu());
                        } catch (modalError) {
                            if (modalError.code !== 'InteractionCollectorError') {
                                console.error('⚠️ モーダル応答エラー:', modalError);
                            }
                        }
                        return;
                    }

                    // モーダル表示(AI性格設定)
                    if (i.customId === 'config_ai_personality') {
                        const settings = await getSettings(db, guild.id);
                        const modal = new ModalBuilder()
                            .setCustomId('config_modal_personality')
                            .setTitle('🎭 AI性格設定');

                        const personalityInput = new TextInputBuilder()
                            .setCustomId('personality')
                            .setLabel('AIへの指示(プロンプト)を入力してください')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder(
                                '例: あなたは猫のAIです。語尾に「にゃん」をつけて、優しく丁寧に答えてください。'
                            )
                            .setRequired(false)
                            .setMaxLength(1000)
                            .setValue(settings.ai?.aiPersonalityPrompt || '');

                        modal.addComponents(new ActionRowBuilder().addComponents(personalityInput));
                        await i.showModal(modal);

                        // モーダルの応答を待つ
                        try {
                            const submitted = await i.awaitModalSubmit({
                                time: 180000,
                                filter: (m) => m.user.id === user.id && m.customId === 'config_modal_personality',
                            });

                            await submitted.deferUpdate();

                            const personality = submitted.fields.getTextInputValue('personality');
                            await updateSettings(db, guild.id, {
                                ai: { ...settings.ai, aiPersonalityPrompt: personality },
                            });

                            await interaction.followUp({
                                content: personality
                                    ? '✅ AIの性格を設定しました。次回のメンションから反映されます。'
                                    : '✅ AIの性格をデフォルトにリセットしました。',
                                ephemeral: true,
                            }).then((msg) => setTimeout(() => msg.delete().catch(() => {}), 5000));

                            await interaction.editReply(await generateAiMenu());
                        } catch (modalError) {
                            if (modalError.code !== 'InteractionCollectorError') {
                                console.error('⚠️ モーダル応答エラー:', modalError);
                            }
                        }
                        return;
                    }
                } catch (error) {
                    console.error('❌ インタラクション処理エラー:', error);
                    try {
                        const errorMsg = '❌ エラーが発生しました。設定の処理中に問題が発生しました。もう一度お試しください。';

                        if (!i.replied && !i.deferred) {
                            await i.reply({
                                content: errorMsg,
                                ephemeral: true,
                            });
                        } else {
                            await interaction.followUp({
                                content: errorMsg,
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
                    const container = new SettingBuilder()
                        .addText('# ⏰ 設定パネル終了')
                        .addSeparator()
                        .addText(
                            reason === 'time'
                                ? '```\n' +
                                      '操作がなかったため、設定パネルを終了しました\n' +
                                      '再度設定を行う場合は /config コマンドを実行してください\n' +
                                      '```'
                                : '```\n設定パネルを終了しました\n```'
                        )
                        .addSeparator()
                        .addSection('ℹ️ 設定について', { prefix: '### ' })
                        .addText(
                            '• 設定した内容は自動保存されています\n' +
                                '• いつでも `/config` で再設定可能です\n' +
                                '• 不明な点があれば管理者にお尋ねください'
                        )
                        .addSeparator()
                        .addSection('📊 統計情報', { prefix: '### ' })
                        .addText(
                            `• インタラクション数: ${collected.size}回\n` +
                                `• セッション時間: ${Math.floor((Date.now() - interaction.createdTimestamp) / 1000)}秒`
                        );

                    await interaction.editReply({
                        content: '✅ **セッション終了** - ご利用ありがとうございました',
                        components: container.toComponents(),
                    });
                } catch (error) {
                    if (error.code !== 10008 && error.code !== 10062) {
                        console.error('❌ 設定パネル終了時エラー:', error);
                    }
                }
            });
        } catch (error) {
            console.error('❌ 設定パネル初期化エラー:', error);

            const container = new SettingBuilder()
                .addText('# ❌ 初期化エラー')
                .addSeparator()
                .addText('設定パネルの初期化中にエラーが発生しました。')
                .addSeparator()
                .addSection('考えられる原因', { prefix: '### ' })
                .addText('• データベース接続の問題\n' + '• 権限の不足\n' + '• 一時的なサーバーエラー')
                .addSeparator()
                .addSection('対処方法', { prefix: '### ' })
                .addText(
                    '• 少し時間をおいて再実行してください\n' + '• 問題が続く場合は管理者にご連絡ください'
                );

            if (!interaction.replied) {
                await interaction.reply({
                    content: '❌ **エラー発生** - エラーコード: INIT_FAILED',
                    components: container.toComponents(),
                    ephemeral: true,
                });
            }
        }
    },
};