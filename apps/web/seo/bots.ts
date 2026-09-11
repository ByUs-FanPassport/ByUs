// Next 16.3.4's documented htmlLimitedBots override replaces the defaults.
// Preserve its default list and add Kakao/Telegram/search crawlers that need
// complete metadata in <head> instead of streamed tags after the body.
export const htmlLimitedBots = /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|kakao|TelegramBot|OAI-SearchBot/i;
