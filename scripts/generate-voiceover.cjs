const fs = require('fs');
const path = require('path');
const https = require('https');

const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');

// Ensure directory exists
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

const SCENE_TEXTS = [
  "Welcome to TenderMaster AI. The complete, AI-powered bidding assistant built specifically for Indian government contractors, supporting GeM, CPPP, and local e-procurement portals.",
  "Get a comprehensive view of all your bidding projects. Monitor high-compatibility matches, see upcoming submission dates, and track your total bidding values in one unified command center.",
  "No more reading 200-page tender documents. Our AI scanner reads the entire document, checks compatibility against your profile, extracts critical dates, and lists hidden risks instantly.",
  "Parse Bill of Quantity schedules instantly. The financial engine detects Percentage, Item Rate, or Lump Sum contracts, letting you adjust markups and calculate bid rates live.",
  "TenderMaster doesn't just create summaries. It replicates the actual blank annexures and forms issued by the tender authority, filling in your statutory profile details with absolute precision.",
  "Clarify turnover clauses, experience criteria, or EMD rules instantly. Chat with the tender document in your preferred language and get answers cited with exact page numbers.",
  "Never lose track of your Earnest Money Deposits again. Follow each transaction through the stages of payment, refund pending, and successful return to your bank account.",
  "No credit card required. Claim your free credit, upload your tender, and generate submission-ready annexures today. Start winning more bids with TenderMaster AI!"
];

function downloadTTS(text, index) {
  return new Promise((resolve, reject) => {
    const filename = `scene_${index}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    const encodedText = encodeURIComponent(text);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodedText}`;

    console.log(`Downloading voiceover for Scene ${index + 1}...`);

    const file = fs.createWriteStream(filepath);
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download Scene ${index}: HTTP Status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`  Saved: ${filename} ✅`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log("==================================================================");
  console.log("           TENDERMASTER AI - VOICEOVER GENERATOR (TTS)           ");
  console.log("==================================================================");
  console.log(`Target Directory: ${AUDIO_DIR}`);
  console.log("------------------------------------------------------------------");

  for (let i = 0; i < SCENE_TEXTS.length; i++) {
    try {
      await downloadTTS(SCENE_TEXTS[i], i);
      // Throttle requests to avoid rate limits
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`  [Error] Failed to generate Scene ${i + 1}:`, err.message);
    }
  }

  console.log("------------------------------------------------------------------");
  console.log("Voiceover audio files generation completed successfully!");
  console.log("==================================================================");
}

run();
