# Ship Happens Starter

This project provides a minimal FastAPI starter for a GenAI orchestration workflow.

## Features

- FastAPI app with health and agent endpoints
- Agent registry stub for planner/researcher/executor
- Sample input and output files
- Docker support
- Validation script

## Run locally

```bash
cd starter-repo
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn run:app --reload
```

Visit `http://localhost:8000/docs` for the Swagger UI.
