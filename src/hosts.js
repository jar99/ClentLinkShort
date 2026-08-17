/**
 * Host dictionary. A host found here costs 8 bits instead of its full text.
 *
 * APPEND-ONLY. An entry's position IS its wire encoding, so reordering or
 * removing one silently repoints every link already shared. Add to the end,
 * never anywhere else, and never past 256 entries.
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
  "dribbble.com","codepen.io","jsfiddle.net","codesandbox.io","observablehq.com"
]);

/** @type {ReadonlyMap<string, number>} */
export const HOST_INDEX = new Map(HOSTS.map((h, i) => [h, i]));
