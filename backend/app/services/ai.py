
import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise RuntimeError("GEMINI_API_KEY is missing from .env")

client = genai.Client(api_key=api_key)

def generate_response(message: str) -> str:
    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=message
    )
    return response.text or ""
