from youtubesearchpython import VideosSearch
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import time
import re
import json
from typing import List, Dict
from urllib.parse import unquote, urlparse, parse_qs

class ArtistLeadScraper:
    def __init__(self):
        self.setup_driver()
        
    def setup_driver(self):
        """Set up the Chrome WebDriver with appropriate options."""
        chrome_options = Options()
        chrome_options.add_argument("--headless")  # Run in headless mode
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        
    def search_youtube_producers(self, search_term: str, num_results: int = 3) -> List[str]:
        """Search YouTube for beat producers and extract their names from channel names."""
        videos_search = VideosSearch(f"{search_term} type beat", limit=num_results)
        results = videos_search.result()['result']
        
        producers = []
        for video in results:
            # Extract producer name from channel name
            channel_name = video['channel']['name']
            # Remove common suffixes like "type beats" or "beats"
            producer_name = re.sub(r'\s*(type\s*)?beats?\s*$', '', channel_name, flags=re.IGNORECASE)
            producers.append(producer_name.strip())
        
        return producers
    
    def search_soundcloud_artists(self, producer_name: str) -> List[Dict]:
        """Search SoundCloud for artists using beats from the producer."""
        search_url = f"https://soundcloud.com/search?q=prod.%20{producer_name}"
        self.driver.get(search_url)
        
        # Wait for results to load
        time.sleep(5)  # Basic wait, could be improved with explicit waits
        
        # Get the page source and parse with BeautifulSoup
        soup = BeautifulSoup(self.driver.page_source, 'html.parser')
        
        artists = []
        # Find artist links in the search results
        artist_links = soup.find_all('a', {'class': 'soundTitle__username'})
        
        for link in artist_links:
            artist_url = f"https://soundcloud.com{link['href']}"
            artist_info = self.scrape_artist_info(artist_url)
            if artist_info:
                artists.append(artist_info)
        
        return artists
    
    def scrape_artist_info(self, artist_url: str) -> Dict:
        """Scrape contact information from an artist's SoundCloud profile."""
        self.driver.get(artist_url)
        time.sleep(3)  # Wait for profile to load
        
        artist_info = {
            'url': artist_url,
            'name': '',
            'email': '',
            'instagram': '',
            'twitter': '',
            'website': '',
            'youtube': '',
            'bio': ''  # Store the full bio for reference
        }
        
        try:
            # Get artist name
            name_element = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, 'h1.profileHeaderInfo__title'))
            )
            artist_info['name'] = name_element.text
            
            # Get description which might contain contact info
            description = self.driver.find_element(By.CSS_SELECTOR, 'div.profileHeaderInfo__bio').text
            artist_info['bio'] = description
            
            # Extract email
            email_match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', description)
            if email_match:
                artist_info['email'] = email_match.group(0)
            
            # Extract social media links from social buttons
            social_links = self.driver.find_elements(By.CSS_SELECTOR, 'a.sc-social-logo-interactive')
            for link in social_links:
                href = link.get_attribute('href')
                label = link.text.strip().lower()
                # Decode gate.sc redirect if present
                if 'gate.sc' in href:
                    parsed = urlparse(href)
                    qs = parse_qs(parsed.query)
                    if 'url' in qs:
                        real_url = unquote(qs['url'][0])
                    else:
                        real_url = href
                else:
                    real_url = href
                if 'instagram.com' in real_url and not artist_info['instagram']:
                    artist_info['instagram'] = real_url
                if 'youtube.com' in real_url and not artist_info['youtube']:
                    artist_info['youtube'] = real_url
            
            # Extract social media links and mentions from bio (as before)
            instagram_patterns = [
                r'instagram\.com/([\w\.-]+)',
                r'@([\w\.-]+)\s*(?:on\s*)?(?:ig|insta|instagram)',
                r'(?:ig|insta|instagram):\s*@?([\w\.-]+)',
                r'(?:ig|insta|instagram)\s*@?([\w\.-]+)'
            ]
            for pattern in instagram_patterns:
                if artist_info['instagram']:
                    break
                instagram_match = re.search(pattern, description, re.IGNORECASE)
                if instagram_match:
                    username = instagram_match.group(1)
                    artist_info['instagram'] = f"https://instagram.com/{username}"
                    break
            twitter_patterns = [
                r'twitter\.com/([\w\.-]+)',
                r'@([\w\.-]+)\s*(?:on\s*)?(?:tw|twitter)',
                r'(?:tw|twitter):\s*@?([\w\.-]+)',
                r'(?:tw|twitter)\s*@?([\w\.-]+)'
            ]
            for pattern in twitter_patterns:
                if artist_info['twitter']:
                    break
                twitter_match = re.search(pattern, description, re.IGNORECASE)
                if twitter_match:
                    username = twitter_match.group(1)
                    artist_info['twitter'] = f"https://twitter.com/{username}"
                    break
            website_patterns = [
                r'https?://[^\s]+',
                r'(?:website|site|web):\s*(https?://[^\s]+)',
                r'(?:website|site|web)\s*(https?://[^\s]+)'
            ]
            for pattern in website_patterns:
                if artist_info['website']:
                    break
                website_match = re.search(pattern, description, re.IGNORECASE)
                if website_match:
                    artist_info['website'] = website_match.group(0)
                    break
        except Exception as e:
            print(f"Error scraping artist info: {str(e)}")
            return None
        return artist_info
    
    def close(self):
        """Close the WebDriver."""
        self.driver.quit()

def main():
    scraper = ArtistLeadScraper()
    try:
        # Search for Drake type beat producers
        producers = scraper.search_youtube_producers("Drake")
        print(f"Found producers: {producers}")
        
        all_artists = []
        for producer in producers:
            print(f"\nSearching for artists using beats from {producer}...")
            artists = scraper.search_soundcloud_artists(producer)
            all_artists.extend(artists)
        
        # Save results to a JSON file
        with open('artist_leads.json', 'w') as f:
            json.dump(all_artists, f, indent=2)
            
        print(f"\nFound {len(all_artists)} artists. Results saved to artist_leads.json")
        
    finally:
        scraper.close()

if __name__ == "__main__":
    main() 