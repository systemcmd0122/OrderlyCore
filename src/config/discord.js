const { Client, GatewayIntentBits, Partials, Collection, REST, Routes } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { db, rtdb } = require('./firebase');
const fs = require('node:fs');
const path = require('node:path');
const chalk = require('chalk');

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

client.db = db;
client.rtdb = rtdb;
client.commands = new Collection();
client.geminiModel = geminiModel;

function loadCommands() {
    console.log(chalk.blue('[INFO] Loading commands...'));
    const commandsPath = path.join(__dirname, '../../commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    const commands = [];

    for (const file of commandFiles) {
        try {
            const filePath = path.join(commandsPath, file);
            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);
            if ('data' in command && 'execute' in command) {
                client.commands.set(command.data.name, command);
                commands.push(command.data.toJSON());
            } else {
                console.warn(chalk.yellow(`[WARN] Warning: Command at ${filePath} is missing required properties.`));
            }
        } catch (error) {
            console.error(chalk.red(`[ERROR] Error loading command ${file}:`), error);
        }
    }
    return commands;
}

function loadEvents() {
    console.log(chalk.blue('[INFO] Loading events...'));
    const eventsPath = path.join(__dirname, '../../events');
    if (fs.existsSync(eventsPath)) {
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
        for (const file of eventFiles) {
            try {
                const filePath = path.join(eventsPath, file);
                delete require.cache[require.resolve(filePath)];
                const eventHandler = require(filePath);

                if (eventHandler.name && typeof eventHandler.execute === 'function') {
                    if (eventHandler.once) {
                        client.once(eventHandler.name, (...args) => eventHandler.execute(...args, client));
                    } else {
                        client.on(eventHandler.name, (...args) => eventHandler.execute(...args, client));
                    }
                    console.log(chalk.blueBright(`[Event] Loaded: ${eventHandler.name} (${file})`));
                } else if (typeof eventHandler === 'function') {
                    eventHandler(client);
                    console.log(chalk.blueBright(`[Event] Loaded modular handler: ${file}`));
                }
            } catch (error) {
                console.error(chalk.red(`[ERROR] Error loading event ${file}:`), error);
            }
        }
    }
}

async function deployCommands(commands) {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
        console.log(chalk.blue(`[INFO] Registering ${commands.length} commands...`));
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log(chalk.green(`[OK] Successfully registered ${data.length} commands.`));
    } catch (error) {
        console.error(chalk.red(`[ERROR] Error registering commands:`), error);
    }
}

module.exports = {
    client,
    loadCommands,
    loadEvents,
    deployCommands
};
