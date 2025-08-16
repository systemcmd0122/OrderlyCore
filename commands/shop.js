// commands/shop.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getFirestore, collection, getDocs, orderBy } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('サーバーのShopで販売中のアイテムを表示します。'),

    async execute(interaction) {
        await interaction.deferReply();

        const itemsRef = collection(interaction.client.db, `shop_items/${interaction.guild.id}/items`);
        const q = query(itemsRef, orderBy('price', 'asc'));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return interaction.editReply('現在、Shopに商品はありません。');
        }

        const embed = new EmbedBuilder()
            .setColor(0x00BFFF)
            .setTitle(`ようこそ、${interaction.guild.name}のShopへ！`)
            .setDescription('欲しいアイテムの購入ボタンを押してください。');
        
        const rows = [];
        let currentRow = new ActionRowBuilder();

        snapshot.forEach(doc => {
            const item = doc.data();
            const role = interaction.guild.roles.cache.get(item.roleId);
            if (!role) return; // 削除されたロールは表示しない

            embed.addFields({
                name: `${role.name}`,
                value: `**🪙 ${item.price.toLocaleString()}** コイン`,
                inline: true
            });
            
            if (currentRow.components.length === 5) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
            }
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy_item_${item.id}`)
                    .setLabel(item.name)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🛒')
            );
        });
        if(currentRow.components.length > 0) rows.push(currentRow);

        await interaction.editReply({ embeds: [embed], components: rows });
    },
};