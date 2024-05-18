require("dotenv").config();
const { Client, Intents, MessageEmbed } = require("discord.js");
const axios = require("axios");
const mongoose = require("mongoose");

mongoose.set('strictQuery', false);

const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES],
});

const statusChannelId = "1241147564603084838"; // Your status channel ID
const statusGuildId = "1233081457954783386"; // Your server ID

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('Error connecting to MongoDB:', err);
});

const ProductSchema = new mongoose.Schema({
    title: String,
    uniqid: String,
    price: Number,
    currency: String,
});

const ProductModel = mongoose.model('Product', ProductSchema);

const BotConfigSchema = new mongoose.Schema({
    guildId: String,
    logChannelId: String,
    updateLogChannelId: String,
    sellixStoreURL: String,
    sellixAPIKey: String, // Add Sellix API key to the schema
    tempSetupChannelId: String,
    lastUpdate: Date,
});

const BotConfigModel = mongoose.model('BotConfig', BotConfigSchema);

let productMessageInfo = {};

async function storeProductsInDB(products) {
    try {
        console.log('Products to be stored:', products);
        await ProductModel.deleteMany({});
        await ProductModel.insertMany(products);
        console.log('Products stored in MongoDB');
    } catch (error) {
        console.error('Error storing products in MongoDB:', error);
    }
}

async function saveBotConfig(guildId, logChannelId, updateLogChannelId, sellixStoreURL, sellixAPIKey, tempSetupChannelId, lastUpdate) {
    try {
        const config = await BotConfigModel.findOneAndUpdate({ guildId }, {
            guildId,
            logChannelId,
            updateLogChannelId,
            sellixStoreURL,
            sellixAPIKey,
            tempSetupChannelId,
            lastUpdate,
        }, { upsert: true });
        console.log('Bot configuration saved:', config);
    } catch (error) {
        console.error('Error saving bot configuration:', error);
    }
}

async function getBotConfig(guildId) {
    try {
        const config = await BotConfigModel.findOne({ guildId });
        return config;
    } catch (error) {
        console.error('Error getting bot configuration:', error);
        return null;
    }
}

async function sendStatusMessage(messageContent) {
    try {
        const statusGuild = await client.guilds.fetch(statusGuildId);
        const statusChannel = statusGuild.channels.cache.get(statusChannelId);
        if (statusChannel.isText()) {
            await statusChannel.send(messageContent);
            console.log("Status message sent successfully.");
        } else {
            console.error("Error: Status channel is not a text channel.");
        }
    } catch (error) {
        console.error("Error sending status message:", error);
    }
}

async function convertToUSD(price, currency) {
    try {
        let exchangeRate;
        if (currency === "CAD") {
            exchangeRate = 1;
        } else {
            const response = await axios.get(
                `https://freecurrencyapi.com/api/v1/rates?base_currency=${currency}&apikey=${process.env.FREE_CURRENCY_API_KEY}`
            );
            exchangeRate = response.data.data.USD;
        }
        return (price * exchangeRate).toFixed(2);
    } catch (error) {
        console.error("Error fetching exchange rate:", error);
        return (price * 0.8).toFixed(2);
    }
}

client.once("ready", async () => {
    console.log("Bot is online! If you need Fallout 76 junk, visit junk4less.xyz");
    client.user.setActivity("junk4less.xyz", { type: "WATCHING" });

    sendStatusMessage("Bot is now online!");
});

client.on("error", (error) => {
    console.error("Bot encountered an error:", error);
    sendStatusMessage(`Bot encountered an error: ${error}`);
});

client.on("disconnect", () => {
    sendStatusMessage("Bot has disconnected.");
});

client.on("reconnecting", () => {
    sendStatusMessage("Bot is reconnecting...");
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (message.content === "!setup" && message.member.permissions.has("ADMINISTRATOR")) {
        try {
            const filter = m => m.author.id === message.author.id;
            const tempSetupChannel = await message.guild.channels.create('setup-temp', {
                type: 'text',
                permissionOverwrites: [
                    {
                        id: message.guild.id,
                        deny: ['VIEW_CHANNEL'],
                    },
                    {
                        id: client.user.id,
                        allow: ['VIEW_CHANNEL', 'SEND_MESSAGES'],
                    },
                    {
                        id: message.author.id,
                        allow: ['VIEW_CHANNEL', 'SEND_MESSAGES'],
                    },
                ],
            });

            await message.author.send(`Please continue setting up the bot in the temporary channel created: ${tempSetupChannel}`);

            const logChannelQuestion = "Please mention the channel where you want bot logs to be sent (e.g., #log-channel):";
            tempSetupChannel.send(logChannelQuestion);
            const logChannelResponse = await tempSetupChannel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const logChannel = logChannelResponse.first().mentions.channels.first();

            if (!logChannel) {
                tempSetupChannel.send("Invalid channel mentioned. You will need to run the !setup command again.");
                return;
            }

            const updateLogChannelQuestion = "Please mention the channel where you want update logs to be sent (e.g., #update-log-channel):";
            tempSetupChannel.send(updateLogChannelQuestion);
            const updateLogChannelResponse = await tempSetupChannel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const updateLogChannel = updateLogChannelResponse.first().mentions.channels.first();

            if (!updateLogChannel) {
                tempSetupChannel.send("Invalid channel mentioned. You will need to run the !setup command again.");
                return;
            }

            const sellixStoreURLQuestion = "Please provide your Sellix store URL (e.g., yourstore.mysellix.io):";
            tempSetupChannel.send(sellixStoreURLQuestion);
            const sellixStoreURLResponse = await tempSetupChannel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const sellixStoreURL = sellixStoreURLResponse.first().content;

            if (!sellixStoreURL) {
                tempSetupChannel.send("Invalid Sellix store URL provided. You will need to run the !setup command again.");
                return;
            }

            const sellixAPIKeyQuestion = "Please obtain your Sellix API key by going to https://dashboard.sellix.io/settings/security and clicking re-generate. Then copy it and paste it here:";
            tempSetupChannel.send(sellixAPIKeyQuestion);
            const sellixAPIKeyResponse = await tempSetupChannel.awaitMessages({ filter, max: 1, time: 60000, errors: ['time'] });
            const sellixAPIKey = sellixAPIKeyResponse.first().content.trim();

            if (!sellixAPIKey) {
                tempSetupChannel.send("Invalid Sellix API key provided. You will need to run the !setup command again.");
                return;
            }

            // Save bot configuration to MongoDB
            await saveBotConfig(
                message.guild.id,
                logChannel.id,
                updateLogChannel.id,
                sellixStoreURL.startsWith("https://") ? sellixStoreURL : `https://${sellixStoreURL}`,
                sellixAPIKey,
                tempSetupChannel.id,
                new Date()
            );

            tempSetupChannel.send("Bot setup completed successfully. This channel will be deleted shortly.");

            setTimeout(async () => {
                await tempSetupChannel.delete();
            }, 10000);
        } catch (error) {
            console.error("Error during setup:", error);
            message.channel.send("An error occurred during setup. Please try again later.");
        }
    }

    if (message.content === "!help") {
        const helpEmbed = new MessageEmbed()
            .setTitle("Bot Help")
            .setDescription("Here are the available commands:")
            .addFields(
                { name: "!setup", value: "Setup bot configuration (Server Admins only)" },
                { name: "!products", value: "List all products" },
                { name: "!ping", value: "Show the bot's latency and stats" },
                { name: "!help", value: "Show this help message" }
            )
            .setColor("BLUE")
            .setFooter(process.env.GLOBAL_FOOTER);

        const sentMessage = await message.channel.send({ embeds: [helpEmbed] });
        // Automatically delete user command message after 10 seconds
        setTimeout(() => {
            message.delete().catch(console.error);
        }, 10000);
    }

    if (message.content === "!ping") {
        const sent = await message.channel.send("Pinging...");
        const latency = sent.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);

        const embed = new MessageEmbed()
            .setTitle("Bot Latency")
            .addFields(
                { name: "Latency", value: `${latency}ms` },
                { name: "API Latency", value: `${apiLatency}ms` },
            )
            .setColor("BLUE");

        sent.edit({ content: "Pong!", embeds: [embed] });
        // Automatically delete user command message after 10 seconds
        setTimeout(() => {
            message.delete().catch(console.error);
        }, 10000);
    }

    if (message.content === "!products") {
        try {
            let storedProducts = await ProductModel.find();
            const config = await getBotConfig(message.guild.id);
            const sellixStoreURL = config.sellixStoreURL;

            if (storedProducts.length === 0) {
                const response = await axios.get(`${sellixStoreURL}/v1/products`, {
                    headers: {
                        Authorization: `Bearer ${config.sellixAPIKey}`,
                    },
                });

                const products = response.data.data.products;
                await storeProductsInDB(products);
                storedProducts = products;
            }

            if (storedProducts.length === 0) {
                throw new Error('No products found.');
            }

            let productList = "";
            const productsChunks = [];

            for (const product of storedProducts) {
                const priceInUSD = await convertToUSD(product.price, product.currency);
                const productLine = `[${product.title}](${sellixStoreURL}/product/${product.uniqid}) - $${priceInUSD} USD`;
                if ((productList + productLine).length > 2000) {
                    productsChunks.push(productList);
                    productList = "";
                }
                productList += `${productLine}\n\n`;
            }
            productsChunks.push(productList);

            const embeds = productsChunks.map((chunk, index) => new MessageEmbed()
                .setTitle(index === 0 ? "Available Products" : "Continuation of Available Products")
                .setDescription(chunk)
                .setColor("GREEN")
                .setFooter(process.env.GLOBAL_FOOTER));

            let sentMessage;
            if (productMessageInfo[message.guild.id]) {
                sentMessage = await message.channel.messages.fetch(productMessageInfo[message.guild.id]);
                for (const embed of embeds) {
                    await sentMessage.edit({ embeds: [embed] });
                }
            } else {
                sentMessage = await message.channel.send({ embeds: [embeds[0]] });
                productMessageInfo[message.guild.id] = sentMessage.id;
            }

            // Automatically delete user command message after 10 seconds
            setTimeout(() => {
                message.delete().catch(console.error);
            }, 10000);
        } catch (error) {
            console.error("Error fetching or displaying products:", error);
            message.channel.send("Sorry, there was an error fetching or displaying the products.");
        }
    }
});

setInterval(async () => {
    try {
        const botConfig = await getBotConfig(statusGuildId);
        if (!botConfig) {
            console.error("Bot configuration not found for the status guild.");
            return;
        }

        const response = await axios.get(`${botConfig.sellixStoreURL}/v1/products`, {
            headers: {
                Authorization: `Bearer ${botConfig.sellixAPIKey}`,
            },
        });

        const products = response.data.data.products;
        await storeProductsInDB(products);

        const lastUpdate = new Date();
        await BotConfigModel.updateOne({ guildId: statusGuildId }, { lastUpdate });

        const updateLogChannel = await client.channels.fetch(botConfig.updateLogChannelId);
        if (!updateLogChannel || !updateLogChannel.isText()) {
            console.error("Error: Update log channel not found or is not a text channel.");
            return;
        }

        const updateLogEmbed = new MessageEmbed()
            .setTitle("Products Updated")
            .setDescription(`The products list has been updated. Last updated: ${lastUpdate.toLocaleString()}`)
            .setColor("BLUE")
            .setFooter(process.env.GLOBAL_FOOTER);

        await updateLogChannel.send({ embeds: [updateLogEmbed] });
    } catch (error) {
        console.error("Error fetching or updating products:", error);
    }
}, 2 * 60 * 1000);

client.login(process.env.DISCORD_TOKEN);

