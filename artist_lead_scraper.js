const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Helper to pause
const sleep = ms => new Promise(res => setTimeout(res, ms));

// Helper to decode SoundCloud's gate.sc URLs
function decodeGateSc(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'gate.sc' && u.searchParams.has('url')) {
      return decodeURIComponent(u.searchParams.get('url'));
    }
  } catch (e) {}
  return url;
}

// Extract producer channel names from YouTube search
async function getTopProducersFromYouTube(searchTerm, numResults = 5) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
  
  const page = await browser.newPage();
  await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm + ' type beat')}`);
  await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });
  const producers = await page.evaluate((numResults) => {
    const results = [];
    const videos = Array.from(document.querySelectorAll('ytd-video-renderer'));
    for (let i = 0; i < Math.min(numResults, videos.length); i++) {
      const channel = videos[i].querySelector('ytd-channel-name a');
      if (channel) {
        let name = channel.textContent.trim();
        // Remove common suffixes
        name = name.replace(/\s*(type\s*)?beats?\s*$/i, '');
        results.push(name);
      }
    }
    return results;
  }, numResults);
  await browser.close();
  return producers;
}

// Scrape SoundCloud for artists using a producer's beats
async function getArtistsFromSoundCloud(producerName, maxArtists = 5) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
  
  const page = await browser.newPage();
  const searchUrl = `https://soundcloud.com/search?q=prod.%20${encodeURIComponent(producerName)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  // Get artist profile links from search results
  const artistLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a.soundTitle__username'));
    return links.map(a => a.href);
  });
  const uniqueLinks = [...new Set(artistLinks)].slice(0, maxArtists);
  const artists = [];
  for (const link of uniqueLinks) {
    const info = await scrapeArtistProfile(link, browser);
    if (info) artists.push(info);
    await sleep(2000);
  }
  await browser.close();
  return artists;
}

// Scrape a SoundCloud artist profile for contact info
async function scrapeArtistProfile(artistUrl, browser) {
  const page = await browser.newPage();
  await page.goto(artistUrl, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  let artistInfo = {
    url: artistUrl,
    name: '',
    email: '',
    instagram: '',
    twitter: '',
    youtube: '',
    website: '',
    bio: ''
  };
  try {
    // Name
    await page.waitForSelector('h2.profileHeaderInfo__userName', { timeout: 10000 });
    artistInfo.name = await page.$eval('h2.profileHeaderInfo__userName', el => el.textContent.trim());
    // Bio as HTML and text
    let bioHtml = '';
    try {
      bioHtml = await page.$eval('div.profileHeaderInfo__bio', el => el.innerHTML);
      artistInfo.bio = await page.$eval('div.profileHeaderInfo__bio', el => el.textContent.trim());
    } catch {}
    // Extract all emails from mailto links in bio HTML
    const emailsFromMailto = await page.$$eval('div.profileHeaderInfo__bio a[href^="mailto:"]', links =>
      links.map(a => a.href.replace(/^mailto:/, '').trim())
    );
    // Extract all emails from text (in case there are more)
    const emailsFromText = (artistInfo.bio.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map(e => e.trim());
    // Combine and deduplicate emails
    const allEmails = Array.from(new Set([...emailsFromMailto, ...emailsFromText]));
    if (allEmails.length > 0) {
      artistInfo.email = allEmails.join(', ');
    }
    // Social links from buttons (e.g. IG, YT)
    const socialLinks = await page.$$eval('a.sc-social-logo-interactive', links =>
      links.map(a => ({
        href: a.href,
        label: a.textContent.trim().toLowerCase()
      }))
    );
    for (const { href, label } of socialLinks) {
      const realUrl = href.includes('gate.sc') ? (new URL(href)).searchParams.get('url') ? decodeURIComponent((new URL(href)).searchParams.get('url')) : href : href;
      if (realUrl.includes('instagram.com') && !artistInfo.instagram) artistInfo.instagram = realUrl;
      if (realUrl.includes('youtube.com') && !artistInfo.youtube) artistInfo.youtube = realUrl;
      if (realUrl.includes('twitter.com') && !artistInfo.twitter) artistInfo.twitter = realUrl;
      if (!artistInfo.website && label === 'website') artistInfo.website = realUrl;
    }
    // Extract Instagram from patterns like 'Insta: username', 'IG: username', 'Instagram: username'
    if (!artistInfo.instagram) {
      const instaPattern = /(?:Insta|IG|Instagram)[:\s]+([a-zA-Z0-9._-]+)/i;
      const instaMatch = artistInfo.bio.match(instaPattern);
      if (instaMatch) {
        artistInfo.instagram = `https://instagram.com/${instaMatch[1]}`;
      }
    }
    // Also keep @username pattern as fallback (but avoid emails)
    if (!artistInfo.instagram) {
      const atUserMatches = artistInfo.bio.match(/@[a-zA-Z0-9._-]+/g);
      if (atUserMatches && atUserMatches.length > 0) {
        // Filter out @ signs that are part of emails
        const igHandle = atUserMatches.find(u => !allEmails.some(e => e.includes(u)));
        if (igHandle) {
          artistInfo.instagram = `https://instagram.com/${igHandle.replace('@', '')}`;
        }
      }
    }
    // Twitter from bio if not found
    if (!artistInfo.twitter) {
      const twPatterns = [
        /twitter\.com\/([\w.-]+)/i,
        /@([\w.-]+)\s*(?:on\s*)?(?:tw|twitter)/i,
        /(?:tw|twitter):\s*@?([\w.-]+)/i,
        /(?:tw|twitter)\s*@?([\w.-]+)/i
      ];
      for (const pattern of twPatterns) {
        const match = artistInfo.bio.match(pattern);
        if (match) {
          artistInfo.twitter = `https://twitter.com/${match[1]}`;
          break;
        }
      }
    }
    // Website from bio if not found
    if (!artistInfo.website) {
      const webPatterns = [
        /(https?:\/\/[^\s]+)/i,
        /(?:website|site|web):\s*(https?:\/\/[^\s]+)/i,
        /(?:website|site|web)\s*(https?:\/\/[^\s]+)/i
      ];
      for (const pattern of webPatterns) {
        const match = artistInfo.bio.match(pattern);
        if (match) {
          artistInfo.website = match[1];
          break;
        }
      }
    }
  } catch (e) {
    console.error(`Error scraping ${artistUrl}:`, e.message);
    await page.close();
    return null;
  }
  await page.close();
  return artistInfo;
}

// Export the functions for use in server.js
module.exports = {
    getTopProducersFromYouTube,
    getArtistsFromSoundCloud
};