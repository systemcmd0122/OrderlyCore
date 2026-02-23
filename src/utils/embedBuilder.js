const { EmbedBuilder } = require('discord.js');

/**
 * Modern Design System Colors
 */
const COLORS = {
    PRIMARY: 0x00f2ff,    // Cyan
    SUCCESS: 0x00ff9d,    // Green
    ERROR: 0xff4d4d,      // Red
    WARNING: 0xffcc00,    // Yellow
    INFO: 0x7000ff,       // Purple
    NEUTRAL: 0x1a1a1a     // Dark Slate
};

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
        .setColor(options.color || COLORS.PRIMARY);

    if (options.author) {
        embed.setAuthor({
            name: options.author.name,
            iconURL: options.author.iconURL,
            url: options.author.url
        });
    }

    if (options.fields && options.fields.length > 0) {
        // Ensure fields are clean
        const cleanFields = options.fields.filter(f => f.name && f.value).map(f => ({
            name: String(f.name),
            value: String(f.value),
            inline: !!f.inline
        }));
        if (cleanFields.length > 0) {
            embed.addFields(cleanFields);
        }
    }

    if (options.thumbnail) {
        embed.setThumbnail(options.thumbnail);
    }

    if (options.image) {
        embed.setImage(options.image);
    }

    if (options.footer) {
        embed.setFooter({
            text: options.footer.text,
            iconURL: options.footer.iconURL
        });
    } else {
        embed.setFooter({ text: 'OrderlyCore Premium System' });
    }

    if (options.timestamp !== false) {
        embed.setTimestamp();
    }

    return embed;
}

/**
 * Helper for Success Embeds
 */
function createSuccessEmbed(title, description) {
    return createStandardEmbed({
        title: `[OK] ${title}`,
        description,
        color: COLORS.SUCCESS
    });
}

/**
 * Helper for Error Embeds
 */
function createErrorEmbed(title, description) {
    return createStandardEmbed({
        title: `[ERROR] ${title}`,
        description,
        color: COLORS.ERROR
    });
}

/**
 * Helper for Info Embeds
 */
function createInfoEmbed(title, description) {
    return createStandardEmbed({
        title: `[INFO] ${title}`,
        description,
        color: COLORS.INFO
    });
}

module.exports = {
    createStandardEmbed,
    createSuccessEmbed,
    createErrorEmbed,
    createInfoEmbed,
    COLORS
};
