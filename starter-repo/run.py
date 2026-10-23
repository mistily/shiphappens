from fastapi import FastAPI
from app.orchestrator import create_app

app = create_app()
