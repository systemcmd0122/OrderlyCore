const { EmbedBuilder } = require('discord.js');

/**
 * Creates a standard embed with a consistent theme.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.description]
 * @param {number|string} [options.color]
 * @param {Object} [options.author]
 * @param {Array} [options.fields]
 * @param {string} [options.thumbnail]
 * @param {string} [options.image]
 * @param {Object} [options.footer]
 * @param {boolean} [options.timestamp=true]
 * @returns {EmbedBuilder}
 */
function createStandardEmbed(options) {
    const embed = new EmbedBuilder()
        .setTitle(options.title || null)
        .setDescription(options.description || null)
        .setColor(options.color || 0x5865F2); // Discord Blurple as default

    if (options.author) {
        embed.setAuthor(options.author);
    }

    if (options.fields && options.fields.length > 0) {
        embed.addFields(options.fields);
    }

    if (options.thumbnail) {
        embed.setThumbnail(options.thumbnail);
    }

    if (options.image) {
        embed.setImage(options.image);
    }

    if (options.footer) {
        embed.setFooter(options.footer);
    }

    if (options.timestamp !== false) {
        embed.setTimestamp();
    }

    return embed;
}

module.exports = {
    createStandardEmbed
};
