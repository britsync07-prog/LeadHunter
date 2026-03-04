import time
import random
import json
import os
import re
import sys
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# ── Country phone config ───────────────────────────────────────────────────────
COUNTRY_PHONE_CONFIG = {
    "United Kingdom":  {"prefixes": ["07", "+44"], "regex": r'(?:\+44\s?|0)(?:7\d{9}|\d{2,4}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4})'},
    "United States":   {"prefixes": ["+1", "tel:"],  "regex": r'(?:\+1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}'},
    "Canada":          {"prefixes": ["+1", "tel:"],  "regex": r'(?:\+1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}'},
    "Australia":       {"prefixes": ["04", "+61"],   "regex": r'(?:\+61\s?|0)(?:4\d{8}|\d{1,4}[\s.\-]?\d{3,4}[\s.\-]?\d{3,4})'},
    "Germany":         {"prefixes": ["+49", "015", "016", "017"], "regex": r'(?:\+49\s?|0)1[567]\d{7,10}'},
    "France":          {"prefixes": ["+33", "06", "07"], "regex": r'(?:\+33\s?|0)[67]\d{8}'},
    "India":           {"prefixes": ["+91", "9", "8", "7"], "regex": r'(?:\+91[\s.\-]?)?[6-9]\d{9}'},
    "Pakistan":        {"prefixes": ["+92", "03"], "regex": r'(?:\+92[\s.\-]?|0)3\d{9}'},
    "UAE":             {"prefixes": ["+971", "05"], "regex": r'(?:\+971[\s.\-]?|0)5\d{8}'},
    "Saudi Arabia":    {"prefixes": ["+966", "05"], "regex": r'(?:\+966[\s.\-]?|0)5\d{8}'},
}
GENERIC_PHONE_REGEX = r'(?:\+\d{1,3}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,5}[\s.\-]?\d{3,5}'

def build_phone_query_term(country):
    cfg = COUNTRY_PHONE_CONFIG.get(country)
    if not cfg:
        return '(WhatsApp OR phone OR mobile OR call)'
    terms = ' OR '.join(f'"{p}"' for p in cfg['prefixes'])
    return f'({terms})'

def extract_phones(text, country):
    cfg = COUNTRY_PHONE_CONFIG.get(country)
    pattern = cfg['regex'] if cfg else GENERIC_PHONE_REGEX
    raw = re.findall(pattern, text)
    cleaned = set()
    for r in raw:
        d = re.sub(r'[^\d+]', '', r)
        if 10 <= len(d) <= 15:
            cleaned.add(d)
    return list(cleaned)

def emit(event):
    """Print a JSON event to stdout for the Node.js parent process."""
    print(json.dumps(event), flush=True)

class DDGMultiNicheScraper:
    def __init__(self, payload=None):
        self.driver = None
        self.payload = payload or {}
        self.country = self.payload.get('country', 'United Kingdom')
        output_dir = self.payload.get('outputDir', '.')
        country_safe = re.sub(r'[^a-zA-Z0-9]', '_', self.country)
        self.leads_file   = os.path.join(output_dir, f"{country_safe}_leads.txt")
        self.numbers_file = os.path.join(output_dir, f"{country_safe}_phones.txt")
        self.all_phones_file = os.path.join(output_dir, "all_phones.txt")
        self.progress_file = os.path.join(output_dir, "search_progress.json")
        self.sites = self.payload.get('sites', ["linkedin.com/in", "facebook.com", "instagram.com"])

        # Dedup sets
        self.saved_phones = set()
        for fpath in [self.numbers_file, self.all_phones_file]:
            if os.path.exists(fpath):
                with open(fpath, "r", encoding="utf-8") as f:
                    for line in f:
                        self.saved_phones.add(line.strip())

        # Use niches/cities from payload or fallback defaults
        self.niche_keywords = self.payload.get('niches', ["Fitness Trainer"])
        self.cities         = self.payload.get('cities', ["London"])

        # Phone query term e.g. ("07" OR "+44")
        self.phone_query_term = build_phone_query_term(self.country)
        emit({"type": "log", "message": f"[Python] Phone search term: {self.phone_query_term}"})

    def setup_driver(self):
        print("   [System] Launching Browser in New Headless Mode...")
        options = uc.ChromeOptions()
        options.add_argument("--headless=new") 
        options.add_argument("--window-size=1920,1080")
        options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        self.driver = uc.Chrome(options=options)

    # --- PROGRESS SAVING FUNCTIONS ---
    def load_progress(self):
        if os.path.exists(self.progress_file):
            try:
                with open(self.progress_file, "r") as f:
                    return json.load(f)
            except:
                return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}
        return {"city_idx": 0, "niche_idx": 0, "site_idx": 0}

    def save_progress(self, city_idx, niche_idx, site_idx):
        data = {
            "city_idx": city_idx,
            "niche_idx": niche_idx,
            "site_idx": site_idx,
            "timestamp": time.strftime('%Y-%m-%d %H:%M:%S')
        }
        with open(self.progress_file, "w") as f:
            json.dump(data, f)
        print(f"   [System] Progress Saved: City {city_idx}, Niche {niche_idx}, Site {site_idx}")

    # --- SAVING FUNCTIONS ---
    def process_result(self, city, niche, title, details, link, found_phones):
        """Saves full lead details to the leads file."""
        try:
            with open(self.leads_file, "a", encoding="utf-8") as f:
                f.write(f"[RESULT] [{niche.upper()}] - {city}\n")
                f.write(f"Title:      {title}\n")
                f.write(f"Details:    {details}\n")
                f.write(f"Link:       {link}\n")
                if found_phones:
                    f.write(f"Phones:     {', '.join(found_phones)}\n")
                f.write("-" * 50 + "\n")
        except Exception as e:
            emit({"type": "log", "message": f"Error saving lead file: {e}"})

    def save_phone(self, phone, city, niche, site, title):
        """Saves a clean phone number to both file and emits a phone-saved event."""
        if phone and phone not in self.saved_phones:
            self.saved_phones.add(phone)
            try:
                with open(self.numbers_file, "a", encoding="utf-8") as f:
                    f.write(f"{phone}\n")
                with open(self.all_phones_file, "a", encoding="utf-8") as f:
                    f.write(f"{phone}\n")
                emit({
                    "type": "phone-saved",
                    "phone": phone,
                    "city": city,
                    "niche": niche,
                    "site": site,
                    "title": title,
                    "phoneFileName": os.path.basename(self.numbers_file),
                    "allPhonesFileName": "all_phones.txt",
                    "message": f"[Phone] Saved: {phone}"
                })
            except Exception as e:
                emit({"type": "log", "message": f"Error saving phone: {e}"})

    def load_more_results(self):
        try:
            last_height = self.driver.execute_script("return document.body.scrollHeight")
            
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(3) 
            
            try:
                more_btn = self.driver.find_element(By.ID, "more-results")
                if more_btn.is_displayed():
                    self.driver.execute_script("arguments[0].click();", more_btn)
                    time.sleep(3) 
            except:
                pass 
            
            new_height = self.driver.execute_script("return document.body.scrollHeight")
            if new_height == last_height:
                time.sleep(2)
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2)
                final_height = self.driver.execute_script("return document.body.scrollHeight")
                if final_height == last_height:
                    return False 
            
            return True 
        except:
            return False

    def scrape_single_query(self, query, city, niche, site):
        emit({"type": "search-query", "query": query, "message": f"[Python] Searching: {query}"})
        try:
            self.driver.get("https://duckduckgo.com/")
            search_box = WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.NAME, "q"))
            )
            search_box.clear()
            search_box.send_keys(query)
            search_box.send_keys(Keys.RETURN)

            try:
                WebDriverWait(self.driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "article, li[data-layout='organic']"))
                )
                time.sleep(2)
            except:
                emit({"type": "log", "message": "[Python] Timeout: No results."})
                return 0

            scraped_links = set()
            total_saved = 0
            page_exhausted = False
            consecutive_no_new = 0

            while not page_exhausted:
                results = self.driver.find_elements(By.CSS_SELECTOR, "li[data-layout='organic']")
                if not results:
                    results = self.driver.find_elements(By.CSS_SELECTOR, "article")

                new_items = False
                for result in results:
                    try:
                        link_el = result.find_element(By.CSS_SELECTOR, "a[data-testid='result-title-a']")
                        title_text = link_el.text
                        link = link_el.get_attribute("href")
                        if link in scraped_links: continue
                        scraped_links.add(link)

                        full_text = result.text
                        details = full_text.replace(title_text, "").replace("\n", " ").strip()

                        # --- Extract phones using country-aware regex ---
                        found_phones = extract_phones(full_text, self.country)
                        valid_phones = []
                        for phone in found_phones:
                            self.save_phone(phone, city, niche, site, title_text)
                            valid_phones.append(phone)

                        # --- Save full lead ---
                        self.process_result(city, niche, title_text, details, link, valid_phones)

                        leads_file_name = os.path.basename(self.leads_file)
                        emit({
                            "type": "lead-saved",
                            "title": title_text,
                            "city": city,
                            "niche": niche,
                            "site": site,
                            "fileName": leads_file_name,
                            "emailFileName": None,
                            "allEmailsFileName": "all_emails.txt",
                            "phoneFileName": os.path.basename(self.numbers_file),
                            "allPhonesFileName": "all_phones.txt",
                            "totalSavedForFile": total_saved + 1,
                            "message": f"Saved: {title_text[:40]}..."
                        })
                        total_saved += 1
                        new_items = True
                    except:
                        continue

                consecutive_no_new = 0 if new_items else consecutive_no_new + 1
                emit({"type": "log", "message": f"Total found: {total_saved}. Loading more..."})
                more = self.load_more_results()
                if not more:
                    page_exhausted = True
                if consecutive_no_new >= 5:
                    break

            return total_saved
        except Exception as e:
            emit({"type": "log", "message": f"[Python] Error on query: {e}"})
            return 0

    def run_batch(self):
        emit({"type": "job-start", "message": "Starting Python (DuckDuckGo) Scraper phase"})
        self.setup_driver()

        for city in self.cities:
            emit({"type": "log", "message": f"[Python] Processing city: {city}"})
            for niche in self.niche_keywords:
                for site in self.sites:
                    # Build country-aware phone query
                    query = f'site:{site} "{niche}" "{city}" {self.phone_query_term}'
                    self.scrape_single_query(query, city, niche, site)
                    sleep_time = random.uniform(3, 6)
                    time.sleep(sleep_time)

        emit({"type": "job-complete", "message": "Python scraper completed."})
        self.driver.quit()

if __name__ == "__main__":
    payload = {}
    if len(sys.argv) > 1:
        try:
            payload = json.loads(sys.argv[1])
        except:
            # Maybe it's not JSON, or arg list is empty
            pass
    
    if not payload:
        # Try reading from stdin if no valid arg provided
        try:
            if not sys.stdin.isatty():
                payload = json.load(sys.stdin)
        except:
            pass
            
    scraper = DDGMultiNicheScraper(payload=payload)
    scraper.run_batch()
