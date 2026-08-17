/**
 * Host dictionary. A host found here costs an escape-coded index (bits.js)
 * instead of its full text — 3 bits for the most-shared handful, 11 for the
 * rest of the table, open-ended past it.
 *
 * ORDERED BY MEASURED USE, then APPEND-ONLY. An entry's position IS its
 * wire encoding, so reordering or removing one silently repoints every link
 * already shared. Add to the end, never anywhere else; the escape-coded
 * index has no cap. (This order was set once, from the corpus, while the
 * format was still beta; from 1.0 on it never moves again.)
 *
 * @type {readonly string[]}
 */
export const HOSTS = Object.freeze([
  "commons.wikimedia.org","upload.wikimedia.org","github.com","youtube.com","en.wikipedia.org",
  "www.google.com","twitter.com","nytimes.com","reddit.com","arxiv.org",
  "theguardian.com","bbc.co.uk","reuters.com","medium.com","wsj.com",
  "imdb.com","bloomberg.com","arstechnica.com","bbc.com","ft.com",
  "old.reddit.com","nature.com","techcrunch.com","books.google.com","wired.com",
  "cnbc.com","cnn.com","theverge.com","economist.com","apnews.com",
  "lemmy.world","theatlantic.com","web.archive.org","huggingface.co","washingtonpost.com",
  "maps.google.com","apps.apple.com","npr.org","phys.org","gutenberg.org",
  "archive.org","macrumors.com","forbes.com","science.org","cbc.ca",
  "amazon.com","abc.net.au","news.ycombinator.com","businessinsider.com","newyorker.com",
  "facebook.com","x.com","theconversation.com","flickr.com","telegraph.co.uk",
  "gist.github.com","openai.com","engadget.com","scientificamerican.com","bsky.app",
  "sciencedirect.com","store.steampowered.com","microsoft.com","aljazeera.com","w3.org",
  "play.google.com","npmjs.com","newscientist.com","spiegel.de","anthropic.com",
  "independent.co.uk","scmp.com","substack.com","apple.com","lemonde.fr",
  "docs.google.com","youtu.be","goodreads.com","i.redd.it","aws.amazon.com",
  "dailymail.co.uk","pypi.org","jstor.org","dw.com","instagram.com",
  "france24.com","t.co","elpais.com","mastodon.social","patreon.com",
  "rte.ie","cloud.google.com","gitlab.com","drive.google.com","vercel.com",
  "developer.apple.com","asahi.com","researchgate.net","crates.io","claude.ai",
  "scholar.google.com","vimeo.com","doi.org","pubmed.ncbi.nlm.nih.gov","learn.microsoft.com",
  "chatgpt.com","twitch.tv","open.spotify.com","acm.org","corriere.it",
  "developer.mozilla.org","espn.com","stackoverflow.com","linkedin.com","imgur.com",
  "figma.com","discord.com","python.org","weather.com","tiktok.com",
  "tumblr.com","kaggle.com","docker.com","weibo.com","raw.githubusercontent.com",
  "stripe.com","i.imgur.com","nodejs.org","soundcloud.com","podcasts.apple.com",
  "quora.com","mail.google.com","notion.so","ieee.org","cloudflare.com",
  "dailymotion.com","vk.com","digitalocean.com","itch.io","m.youtube.com",
  "paypal.com","discord.gg","walmart.com","colab.research.google.com","replit.com",
  "netlify.com","fly.io","steamcommunity.com","codepen.io","straitstimes.com",
  "standard.co.uk","itv.com","netflix.com","chess.com","render.com",
  "go.dev","developer.android.com","sky.com","dropbox.com","slack.com",
  "etsy.com","bestbuy.com","springer.com","kubernetes.io","newegg.com",
  "postimg.cc","bitbucket.org","t.me","ebay.com","tripadvisor.com",
  "coursera.org","udemy.com","khanacademy.org","zillow.com","kickstarter.com",
  "observablehq.com","homedepot.com","rakuten.co.jp","spotify.com","zoom.us",
  "calendar.google.com","wordpress.com","blogspot.com","pinterest.com","heroku.com",
  "indeed.com","glassdoor.com","behance.net","taobao.com","costco.com",
  "preview.redd.it","i.ibb.co","music.apple.com","azure.com","telegram.me",
  "whatsapp.com","outlook.com","office.com","target.com","booking.com",
  "airbnb.com","expedia.com","hulu.com","disneyplus.com","primevideo.com",
  "edx.org","duolingo.com","hub.docker.com","golang.org","rust-lang.org",
  "yelp.com","strava.com","gofundme.com","unsplash.com","dribbble.com",
  "jsfiddle.net","codesandbox.io","aliexpress.com","temu.com","shein.com",
  "wayfair.com","ikea.com","lowes.com","argos.co.uk","johnlewis.com",
  "asos.com","zalando.co.uk","mercadolibre.com","jd.com","alibaba.com",
  "chewy.com","sephora.com","nordstrom.com","macys.com","tesco.com",
  "carrefour.fr","otto.de","threads.net","snapchat.com","ok.ru",
  "xiaohongshu.com","line.me","wa.me","pbs.twimg.com","ytimg.com",
  "console.aws.amazon.com","meet.google.com","cdn.discordapp.com","media.giphy.com","live.staticflickr.com",
  "images.unsplash.com","i.pinimg.com","media.tenor.com"
]);

/** @type {ReadonlyMap<string, number>} */
export const HOST_INDEX = new Map(HOSTS.map((h, i) => [h, i]));
