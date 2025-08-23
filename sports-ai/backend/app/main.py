from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from .agents.collector import CollectorAgentV2

app = FastAPI(title="Sports Collector HM", version="0.1.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (for dev; restrict in prod)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = CollectorAgentV2()

@app.post("/collect")
def collect(request: dict = Body(...)):
    """Single entrypoint: pass {"intent":..., "args":{...}}"""
    return agent.handle(request)

@app.get("/health")
def health():
    return {"ok": True}