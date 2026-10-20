"""Jan Awaaz AI service. Scaffold only (I-01): health endpoint, no models loaded."""

from fastapi import FastAPI

app = FastAPI(title="janawaaz-ai")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai"}
