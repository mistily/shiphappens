from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.orchestrator import create_app

app = create_app()
