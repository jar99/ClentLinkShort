/**
 * Host dictionary. A host found here costs 8 bits instead of its full text.
 *
 * APPEND-ONLY. An entry's position IS its wire encoding, so reordering or
 * removing one silently repoints every link already shared. Add to the end,
 * never anywhere else, and never past 256 entries — the index is 8 bits.
 *
 * @type {readonly string[]}
 */
export const HOSTS = Object.freeze([
  "github.com","www.google.com","youtube.com","en.wikipedia.org","x.com",
  "twitter.com","reddit.com","stackoverflow.com","amazon.com","linkedin.com",
  "medium.com","docs.google.com","drive.google.com","maps.google.com","news.ycombinator.com",
  "gist.github.com","raw.githubusercontent.com","gitlab.com","bitbucket.org","npmjs.com",
  "pypi.org","crates.io","developer.mozilla.org","w3.org","archive.org",
  "web.archive.org","imgur.com","instagram.com","facebook.com","tiktok.com",
  "twitch.tv","spotify.com","open.spotify.com","soundcloud.com","apple.com",
  "music.apple.com","podcasts.apple.com","microsoft.com","learn.microsoft.com","azure.com",
  "aws.amazon.com","console.aws.amazon.com","cloud.google.com","stripe.com","paypal.com",
  "dropbox.com","notion.so","figma.com","slack.com","discord.com",
  "discord.gg","telegram.me","t.me","whatsapp.com","zoom.us",
  "meet.google.com","calendar.google.com","mail.google.com","outlook.com","office.com",
  "nytimes.com","bbc.co.uk","bbc.com","theguardian.com","cnn.com",
  "reuters.com","bloomberg.com","wsj.com","ft.com","economist.com",
  "washingtonpost.com","npr.org","arstechnica.com","theverge.com","techcrunch.com",
  "wired.com","engadget.com","substack.com","wordpress.com","blogspot.com",
  "tumblr.com","quora.com","pinterest.com","etsy.com","ebay.com",
  "walmart.com","target.com","bestbuy.com","booking.com","airbnb.com",
  "tripadvisor.com","expedia.com","imdb.com","netflix.com","hulu.com",
  "disneyplus.com","primevideo.com","goodreads.com","scholar.google.com","arxiv.org",
  "doi.org","pubmed.ncbi.nlm.nih.gov","nature.com","sciencedirect.com","springer.com",
  "ieee.org","acm.org","jstor.org","researchgate.net","coursera.org",
  "udemy.com","edx.org","khanacademy.org","duolingo.com","chess.com",
  "anthropic.com","claude.ai","openai.com","chatgpt.com","huggingface.co",
  "kaggle.com","colab.research.google.com","replit.com","vercel.com","netlify.com",
  "cloudflare.com","digitalocean.com","heroku.com","render.com","fly.io",
  "docker.com","hub.docker.com","kubernetes.io","golang.org","go.dev",
  "rust-lang.org","python.org","nodejs.org","developer.apple.com","developer.android.com",
  "play.google.com","apps.apple.com","zillow.com","indeed.com","glassdoor.com",
  "yelp.com","weather.com","espn.com","strava.com","steamcommunity.com",
  "store.steampowered.com","itch.io","patreon.com","kickstarter.com","gofundme.com",
  "vimeo.com","dailymotion.com","flickr.com","unsplash.com","behance.net",
  "dribbble.com","codepen.io","jsfiddle.net","codesandbox.io","observablehq.com",

  // ---- appended: shopping, news, social and image hosts ------------------
  //
  // Curated rather than mined. Frequency in the corpus is the wrong signal
  // here: it measures what Wikipedia cites and what my sources happened to
  // return, which is how "catalogueoflife.org" and "wikisky.org" end up
  // outscoring every retailer on the web. No dataset available here measures
  // what people actually put through a shortener, so these are chosen by
  // category instead, and the reasoning is written down instead of implied.
  "aliexpress.com","temu.com","shein.com","wayfair.com","ikea.com",
  "homedepot.com","lowes.com","argos.co.uk","johnlewis.com","asos.com",
  "zalando.co.uk","mercadolibre.com","rakuten.co.jp","taobao.com","jd.com",
  "alibaba.com","newegg.com","chewy.com","sephora.com","nordstrom.com",
  "macys.com","costco.com","tesco.com","carrefour.fr","otto.de",
  "bsky.app","threads.net","mastodon.social","lemmy.world","vk.com",
  "weibo.com","snapchat.com","ok.ru","xiaohongshu.com","line.me",
  "wa.me","t.co","m.youtube.com","youtu.be","old.reddit.com",
  "i.imgur.com","upload.wikimedia.org","commons.wikimedia.org","i.redd.it",
  "preview.redd.it","pbs.twimg.com","cdn.discordapp.com","media.giphy.com",
  "live.staticflickr.com","images.unsplash.com","i.ibb.co","postimg.cc",
  "ytimg.com","i.pinimg.com","media.tenor.com",
  "apnews.com","cnbc.com","forbes.com","businessinsider.com","theatlantic.com",
  "newyorker.com","aljazeera.com","dw.com","france24.com","lemonde.fr",
  "spiegel.de","elpais.com","corriere.it","asahi.com","scmp.com",
  "straitstimes.com","abc.net.au","cbc.ca","telegraph.co.uk","independent.co.uk",
  "dailymail.co.uk","standard.co.uk","sky.com","itv.com","rte.ie",
  "phys.org","science.org","scientificamerican.com","newscientist.com",
  "theconversation.com","gutenberg.org","books.google.com","macrumors.com"
]);

/** @type {ReadonlyMap<string, number>} */
export const HOST_INDEX = new Map(HOSTS.map((h, i) => [h, i]));
