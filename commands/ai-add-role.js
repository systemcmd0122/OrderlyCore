// commands/ai-add-role.js
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getFirestore, doc, setDoc } = require('firebase/firestore');
const { v4: uuidv4 } = require('uuid');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ai-add-role')
        .setDescription('AIが生成したユニークなロールをShopに追加します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option => option.setName('theme').setDescription('ロール名のテーマ (例: 「深海の支配者」, 「サイバーパンク」)').setRequired(true))
        .addIntegerOption(option => option.setName('price').setDescription('ロールの価格').setRequired(true).setMinValue(1)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const theme = interaction.options.getString('theme');
        const price = interaction.options.getInteger('price');

        try {
            // --- 1. Gemini AIにロール名と色を生成させる ---
            const prompt = `あなたはDiscordのロール名を考えるプロです。テーマ「${theme}」に沿った、ユニークでかっこいいロール名と、それに合う16進数のカラーコードを生成してください。必ず以下のJSON形式のみで回答してください:
{"name": "ロール名", "color": "#RRGGBB"}`;
            
            // index.jsでclientオブジェクトに格納されたgeminiModelを正しく参照
            const geminiModel = interaction.client.geminiModel; 
            if (!geminiModel) {
                 throw new Error('AIモデルが初期化されていません。');
            }

            const result = await geminiModel.generateContent(prompt);
            const text = result.response.text();
            const cleanedJson = text.replace(/```json|```/g, '').trim();
            
            let aiResponse;
            try {
                aiResponse = JSON.parse(cleanedJson);
            } catch (parseError) {
                console.error('AIからのJSONパースエラー:', cleanedJson);
                throw new Error('AIが不正な形式で応答しました。テーマを変えて再度お試しください。');
            }

            const roleName = aiResponse.name;
            const roleColor = aiResponse.color;

            if (!roleName || !/^#[0-9A-F]{6}$/i.test(roleColor)) {
                 throw new Error('AIが有効なロール名またはカラーコードを生成しませんでした。');
            }

            // --- 2. Discordサーバーにロールを作成 ---
            const newRole = await interaction.guild.roles.create({
                name: roleName,
                color: roleColor,
                reason: `AIによって生成されたShopアイテム (${interaction.user.tag})`
            });

            // --- 3. FirestoreのShopにアイテムを保存 ---
            const itemId = uuidv4();
            const itemRef = doc(interaction.client.db, `shop_items/${interaction.guild.id}/items`, itemId);
            await setDoc(itemRef, {
                id: itemId,
                name: roleName,
                price: price,
                roleId: newRole.id,
                createdAt: new Date(),
            });
            
            const embed = new EmbedBuilder()
                .setColor(roleColor)
                .setTitle('✅ AIロール追加完了')
                .setDescription(`AIがロール **${newRole.name}** を作成し、Shopに追加しました！`)
                .addFields(
                    { name: '価格', value: `🪙 ${price.toLocaleString()} コイン`, inline: true },
                    { name: 'ロールカラー', value: `\`${roleColor}\``, inline: true }
                );

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('AIロール追加エラー:', error);
            await interaction.editReply({ content: `❌ エラーが発生しました: ${error.message}` });
        }
    },
};