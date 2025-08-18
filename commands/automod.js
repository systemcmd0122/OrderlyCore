const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('オートモデレーターの設定を管理します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommandGroup(group =>
            group
                .setName('ng-word')
                .setDescription('NGワードフィルターの設定')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('add')
                        .setDescription('NGワードリストに単語を追加します。')
                        .addStringOption(option =>
                            option.setName('word').setDescription('追加する単語').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('remove')
                        .setDescription('NGワードリストから単語を削除します。')
                        .addStringOption(option =>
                            option.setName('word').setDescription('削除する単語').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('list')
                        .setDescription('現在のNGワードリストを表示します。'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite-links')
                .setDescription('招待リンクの投稿を許可するか設定します。')
                .addBooleanOption(option =>
                    option.setName('allow').setDescription('許可する場合は true').setRequired(true))
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const group = interaction.options.getSubcommandGroup();
        const subcommand = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const db = interaction.client.db;
        const settingsRef = doc(db, 'guild_settings', guildId);

        try {
            const docSnap = await getDoc(settingsRef);
            const settings = docSnap.exists() ? docSnap.data() : {};
            const automodConfig = settings.automod || { ngWords: [], blockInvites: true };

            if (group === 'ng-word') {
                const word = interaction.options.getString('word');
                if (subcommand === 'add') {
                    if (automodConfig.ngWords.includes(word)) {
                        return interaction.editReply({ content: 'その単語は既に登録されています。' });
                    }
                    automodConfig.ngWords.push(word);
                    await setDoc(settingsRef, { automod: automodConfig }, { merge: true });
                    await interaction.editReply({ content: `✅ NGワード「${word}」を追加しました。` });
                } else if (subcommand === 'remove') {
                    automodConfig.ngWords = automodConfig.ngWords.filter(w => w !== word);
                    await setDoc(settingsRef, { automod: automodConfig }, { merge: true });
                    await interaction.editReply({ content: `🗑️ NGワード「${word}」を削除しました。` });
                } else if (subcommand === 'list') {
                    const embed = new EmbedBuilder()
                        .setTitle('🚫 NGワードリスト')
                        .setDescription(automodConfig.ngWords.length > 0 ? automodConfig.ngWords.join(', ') : 'NGワードは登録されていません。');
                    await interaction.editReply({ embeds: [embed] });
                }
            } else if (subcommand === 'invite-links') {
                const allow = interaction.options.getBoolean('allow');
                automodConfig.blockInvites = !allow;
                await setDoc(settingsRef, { automod: automodConfig }, { merge: true });
                await interaction.editReply({ content: `✅ 招待リンクの投稿を ${allow ? '許可' : 'ブロック'} するように設定しました。` });
            }
        } catch (error) {
            console.error('automod コマンドエラー:', error);
            await interaction.editReply({ content: '❌ 設定中にエラーが発生しました。' });
        }
    }
};