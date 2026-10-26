# shiphappens
GenAI AI Agent Hackathon https://hackathon.genai.works/

Technologies planned to be used 

https://cloud.enterprise.zetaris.com/dashboard
https://meterless.ai/engines.html
https://cursor.com/agents
https://brightdata.com/


1. Component architecture
Existing TypeScript frontend — Grid Avid

Overview · workflow runs · evidence · CO₂ estimates · audit trail

HTTP / JSON

Python API — FastAPI
Validates input, starts runs, returns results and agent traces.

LangGraph orchestrator

Shared state · parallel tasks · conditional routing · bounded revision loop

Planner agent

Defines the task and constraints


Evidence agent

Checks source, freshness, units and conflicts


Optimization agent

Evaluates feasible workload windows and carbon impact


Critic / validator

Independently checks constraints and challenges the plan



Reporter + human approval gate

Recommendation · evidence citations · limitations · decision history


Tools and provider adapters

Zetaris

Federated structured-data access and cross-source queries.


Bright Data

External web evidence, extraction and source provenance.


Meterless Nightshift

Primary AI provider for agent reasoning and reconciliation.


Deterministic engine

Carbon calculations, feasibility checks and invariant tests.



NVIDIA — supporting technology

Explain a credible role in accelerated forecasting or simulation if used. Keep it an optional extension if you do not integrate NVIDIA technology in the MVP.

<img width="1656" height="1988" alt="mermaid-diagram" src="https://github.com/user-attachments/assets/f9adfc67-f28c-419b-bfa3-aadefb4f6502" />
