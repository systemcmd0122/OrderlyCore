const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
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
        // ephemeralの代わりにflagsを使用する最新の書き方に修正
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const theme = interaction.options.getString('theme');
        const price = interaction.options.getInteger('price');

        try {
            // --- 1. Gemini AIへのプロンプトを強化 ---
            const prompt = `あなたはDiscordのロール名を考えるプロです。テーマ「${theme}」に沿った、ユニークでかっこいいロール名と、それに合う16進数のカラーコードを生成してください。
制約:
- 回答は必ずJSONオブジェクトのみとします。
- JSON以外のテキスト（例: "はい、こちらがJSONです"など）は一切含めないでください。
- JSONの形式は {"name": "生成したロール名", "color": "#RRGGBB"} とします。`;
            
            const geminiModel = interaction.client.geminiModel; 
            if (!geminiModel) {
                 throw new Error('AIモデルが初期化されていません。Botの管理者に連絡してください。');
            }

            const result = await geminiModel.generateContent(prompt);
            const text = result.response.text();

            // --- 2. JSON抽出ロジックを強化 ---
            const jsonMatch = text.match(/{[\s\S]*}/);
            if (!jsonMatch) {
                console.error('AIからの応答にJSONが含まれていませんでした:', text);
                throw new Error('AIからの応答を解析できませんでした。テーマが複雑すぎる可能性があります。');
            }
            
            let aiResponse;
            try {
                aiResponse = JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.error('AIからのJSONパースエラー:', jsonMatch[0]);
                throw new Error('AIが不正な形式で応答しました。テーマを変えて再度お試しください。');
            }

            const roleName = aiResponse.name;
            const roleColor = aiResponse.color;

            // 生成されたデータの検証
            if (!roleName || typeof roleName !== 'string' || !/^#[0-9A-F]{6}$/i.test(roleColor)) {
                 throw new Error('AIが有効なロール名またはカラーコードを生成しませんでした。');
            }

            // --- 3. Discordサーバーにロールを作成 ---
            const newRole = await interaction.guild.roles.create({
                name: roleName,
                color: roleColor,
                reason: `AIによって生成されたShopアイテム (${interaction.user.tag})`
            });

            // --- 4. FirestoreのShopにアイテムを保存 ---
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
            
            // ephemeralフラグはdeferReplyで設定済みのため、ここでは不要
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('AIロール追加エラー:', error);
            await interaction.editReply({ content: `❌ エラーが発生しました: ${error.message}` });
        }
    },
};