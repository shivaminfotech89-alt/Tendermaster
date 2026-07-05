const { GoogleGenAI } = require("@google/genai");

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const systemInstruction = "You are Tender MasterAI.";
  const prompt = "Please draft a covering letter.";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: 'user', parts: [{ text: prompt || " " }] }],
      config: {
        systemInstruction,
      }
    });
    console.log(response.text);
  } catch (err) {
    console.error("Error:", err);
  }
}
test();
