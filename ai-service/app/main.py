import os

from fastapi import FastAPI

app = FastAPI(title="Smart Attendance AI Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}


def server_config() -> tuple[str, int]:
    host = os.getenv("HOST", "127.0.0.1")
    raw_port = os.getenv("PORT", "8000")

    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError("PORT must be an integer") from error

    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")

    return host, port


if __name__ == "__main__":
    import uvicorn

    host, port = server_config()
    uvicorn.run(app, host=host, port=port)
