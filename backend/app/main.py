
import os
import re
import json
import uuid
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import psycopg
from psycopg.rows import dict_row
from psycopg.errors import UniqueViolation

from dotenv import load_dotenv
from jose import jwt, JWTError
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from app.services.ai import generate_response

load_dotenv()

app = FastAPI(title="AI Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("AUTH_SECRET_KEY")
ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)


def get_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is missing.")

    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row
    )


def init_database():
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id)
                    ON DELETE CASCADE,
                title TEXT NOT NULL,
                messages TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id)
                    ON DELETE CASCADE,
                chat_id TEXT NOT NULL REFERENCES chats(id)
                    ON DELETE CASCADE,
                message_index INTEGER NOT NULL,
                rating TEXT NOT NULL CHECK(rating IN ('good', 'bad')),
                created_at TEXT NOT NULL,
                UNIQUE(user_id, chat_id, message_index)
            )
        """)


@app.on_event("startup")
def startup():
    init_database()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode(),
        salt.encode(),
        310000
    ).hex()
    return f"{salt}${hashed}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, expected_hash = stored_hash.split("$")
        actual_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode(),
            salt.encode(),
            310000
        ).hex()
        return secrets.compare_digest(actual_hash, expected_hash)
    except ValueError:
        return False


def create_token(username: str) -> str:
    if not SECRET_KEY:
        raise HTTPException(
            status_code=500,
            detail="AUTH_SECRET_KEY is missing."
        )

    expiry = datetime.now(timezone.utc) + timedelta(days=7)

    return jwt.encode(
        {"sub": username, "exp": expiry},
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if not credentials or not SECRET_KEY:
        raise HTTPException(status_code=401, detail="Please log in.")

    try:
        payload = jwt.decode(
            credentials.credentials,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )
        username = payload.get("sub")

        if not username:
            raise HTTPException(status_code=401, detail="Invalid login.")

        return username

    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Login expired. Please log in again."
        )


def get_current_user_id(username: str) -> int:
    with get_db() as db:
        user = db.execute(
            "SELECT id FROM users WHERE username = %s",
            (username,)
        ).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    return user["id"]


class SignupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class ChatRequest(BaseModel):
    message: str


class MessageItem(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=50000)


class SaveChatRequest(BaseModel):
    id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    messages: list[MessageItem] = Field(max_length=500)


class FeedbackRequest(BaseModel):
    message_index: int = Field(ge=0)
    rating: Literal["good", "bad"]


@app.get("/")
def home():
    return {"message": "AI Assistant is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/signup")
def signup(request: SignupRequest):
    username = request.username.strip().lower()

    if not re.fullmatch(r"[a-z0-9_]+", username):
        raise HTTPException(
            status_code=400,
            detail="Username can only contain letters, numbers and underscores."
        )

    try:
        with get_db() as db:
            db.execute(
                """
                INSERT INTO users (username, password_hash, created_at)
                VALUES (%s, %s, %s)
                """,
                (
                    username,
                    hash_password(request.password),
                    datetime.now(timezone.utc).isoformat()
                )
            )
    except UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail="Username already exists."
        )

    return {
        "token": create_token(username),
        "username": username
    }


@app.post("/auth/login")
def login(request: LoginRequest):
    username = request.username.strip().lower()

    with get_db() as db:
        user = db.execute(
            "SELECT * FROM users WHERE username = %s",
            (username,)
        ).fetchone()

    if not user or not verify_password(
        request.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password."
        )

    return {
        "token": create_token(username),
        "username": username
    }


@app.get("/auth/me")
def me(username: str = Depends(get_current_user)):
    return {"username": username}


# PRIVATE CHAT HISTORY

@app.get("/chats")
def get_chats(username: str = Depends(get_current_user)):
    user_id = get_current_user_id(username)

    with get_db() as db:
        chats = db.execute(
            """
            SELECT id, title, messages, created_at, updated_at
            FROM chats
            WHERE user_id = %s
            ORDER BY updated_at DESC
            """,
            (user_id,)
        ).fetchall()

    return [
        {
            "id": chat["id"],
            "title": chat["title"],
            "messages": json.loads(chat["messages"]),
            "created_at": chat["created_at"],
            "updated_at": chat["updated_at"]
        }
        for chat in chats
    ]


@app.post("/chats")
def save_chat(
    request: SaveChatRequest,
    username: str = Depends(get_current_user)
):
    user_id = get_current_user_id(username)
    chat_id = request.id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    messages_json = json.dumps(
        [message.model_dump() for message in request.messages]
    )

    with get_db() as db:
        existing = db.execute(
            "SELECT user_id FROM chats WHERE id = %s",
            (chat_id,)
        ).fetchone()

        if existing and existing["user_id"] != user_id:
            raise HTTPException(status_code=404, detail="Chat not found.")

        if existing:
            db.execute(
                """
                UPDATE chats
                SET title = %s, messages = %s, updated_at = %s
                WHERE id = %s AND user_id = %s
                """,
                (
                    request.title,
                    messages_json,
                    now,
                    chat_id,
                    user_id
                )
            )
        else:
            db.execute(
                """
                INSERT INTO chats
                (id, user_id, title, messages, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    chat_id,
                    user_id,
                    request.title,
                    messages_json,
                    now,
                    now
                )
            )

    return {"id": chat_id, "message": "Chat saved."}


@app.delete("/chats/{chat_id}")
def delete_chat(
    chat_id: str,
    username: str = Depends(get_current_user)
):
    user_id = get_current_user_id(username)

    with get_db() as db:
        result = db.execute(
            "DELETE FROM chats WHERE id = %s AND user_id = %s",
            (chat_id, user_id)
        )

        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Chat not found.")

    return {"message": "Chat deleted."}


# RESPONSE FEEDBACK

@app.post("/chats/{chat_id}/feedback")
def save_feedback(
    chat_id: str,
    request: FeedbackRequest,
    username: str = Depends(get_current_user)
):
    user_id = get_current_user_id(username)

    with get_db() as db:
        chat = db.execute(
            "SELECT messages FROM chats WHERE id = %s AND user_id = %s",
            (chat_id, user_id)
        ).fetchone()

        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")

        messages = json.loads(chat["messages"])

        if request.message_index >= len(messages):
            raise HTTPException(status_code=400, detail="Invalid message index.")

        if messages[request.message_index]["role"] != "assistant":
            raise HTTPException(
                status_code=400,
                detail="Feedback can only be given to AI responses."
            )

        db.execute(
            """
            INSERT INTO feedback
            (user_id, chat_id, message_index, rating, created_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(user_id, chat_id, message_index)
            DO UPDATE SET
                rating = EXCLUDED.rating,
                created_at = EXCLUDED.created_at
            """,
            (
                user_id,
                chat_id,
                request.message_index,
                request.rating,
                datetime.now(timezone.utc).isoformat()
            )
        )

    return {"message": "Feedback saved.", "rating": request.rating}


# AI CHAT

@app.post("/chat")
def chat(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(
            status_code=400,
            detail="Message cannot be empty."
        )

    try:
        reply = generate_response(request.message)
        return {"reply": reply}

    except Exception as error:
        print("GEMINI ERROR:", repr(error))
        raise HTTPException(
            status_code=502,
            detail="AI service is temporarily unavailable."
        )
